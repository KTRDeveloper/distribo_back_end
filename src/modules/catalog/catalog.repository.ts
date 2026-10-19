import type { Prisma, Product, ProductVariant } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { httpError } from '../../lib/http-error.js';
import { imageKeySchema } from '../../lib/image-keys.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
import { listOrderedVariantIds } from '../order/order.repository.js';
import { visibleRelationsWhere } from '../relationship/relationship.visibility.js';

const notFound = () => httpError(404, 'NOT_FOUND', 'Not found');

/**
 * Price an order line freezes for a relationship and a product variant (CM-11):
 * the live negotiated price of that relationship for that variant when one
 * exists, even above the variant price, else the variant price. `changedAt` is
 * the negotiated `set_at` or the variant's `price_updated_at`.
 *
 * Read inside the caller's transaction, from the database (v5.0.0-2.2.3). Only
 * the given relationship's price is read, never another customer's (AB-1), and
 * a price negotiated for another variant of the same product never applies.
 * The variant must belong to the relationship's supplier organization (any
 * state, as the product was; v5.0.0-8.2.2). A product written the old way has a
 * variant with its own id (CAT-013), so product ids still answer.
 *
 * @throws 404 NOT_FOUND when the relationship or variant is unknown, or the
 * variant is not the supplier's (fail closed, whatever the cause).
 */
export async function getReferencePrice(
  tx: Prisma.TransactionClient,
  relationshipId: string,
  variantId: string
): Promise<{ price: bigint; negotiated: boolean; changedAt: Date }> {
  const relationship = await tx.customerRelationship.findUnique({
    where: { id: relationshipId },
    select: { supplierOrganizationId: true },
  });
  if (!relationship?.supplierOrganizationId) throw notFound();

  const variant = await tx.productVariant.findFirst({
    where: { id: variantId, organizationId: relationship.supplierOrganizationId },
    select: { price: true, priceUpdatedAt: true },
  });
  if (!variant) throw notFound();

  const negotiated = await tx.customerPrice.findFirst({
    where: { customerRelationshipId: relationshipId, productVariantId: variantId, deletedAt: null },
    select: { price: true, setAt: true },
  });
  if (negotiated) {
    return { price: negotiated.price, negotiated: true, changedAt: negotiated.setAt };
  }
  return { price: variant.price, negotiated: false, changedAt: variant.priceUpdatedAt };
}

/**
 * Returns the product when it belongs to the organization, is ACTIVE and not
 * deleted (C-15).
 *
 * @throws 404 NOT_FOUND otherwise, without telling which condition failed.
 */
export async function getActiveProduct(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string
): Promise<Product> {
  const product = await tx.product.findFirst({
    where: { id: productId, organizationId, status: 'ACTIVE', deletedAt: null },
  });
  if (!product) throw notFound();
  return product;
}

/** A variant on sale with the facts an order line freezes (C-15). */
export type ActiveVariant = {
  id: string;
  productId: string;
  productName: string;
  variantName: string | null;
  unit: string;
  price: bigint;
  priceUpdatedAt: Date;
  minOrderQuantity: Prisma.Decimal | null;
};

/**
 * Returns a variant on sale with its product name, so that no order module reads the catalog
 * tables itself (ADR-004). On sale (C-15) means: the variant is ACTIVE, not deleted and belongs to
 * the organization, and its product is neither deleted nor paused. A product written the old way
 * has a variant with its own id, so product ids answer too.
 *
 * Read inside the caller's transaction, from the database (v5.0.0-2.2.3), and bound to the
 * organization id (v5.0.0-8.2.2).
 *
 * @param organizationId - The supplier business, from the session or server code, never a request.
 * @throws 404 NOT_FOUND otherwise, without telling which condition failed.
 */
export async function getActiveVariant(
  tx: Prisma.TransactionClient,
  organizationId: string,
  variantId: string
): Promise<ActiveVariant> {
  const variant = await tx.productVariant.findFirst({
    where: {
      id: variantId,
      organizationId,
      status: 'ACTIVE',
      deletedAt: null,
      product: { organizationId, deletedAt: null, pausedAt: null },
    },
    select: {
      id: true,
      productId: true,
      name: true,
      unit: true,
      price: true,
      priceUpdatedAt: true,
      minOrderQuantity: true,
      product: { select: { name: true } },
    },
  });
  if (!variant) throw notFound();
  return {
    id: variant.id,
    productId: variant.productId,
    productName: variant.product.name,
    variantName: variant.name,
    unit: variant.unit,
    price: variant.price,
    priceUpdatedAt: variant.priceUpdatedAt,
    minOrderQuantity: variant.minOrderQuantity,
  };
}

/**
 * Inserts a product of the organization. `price_updated_at` and `created_at` come from the
 * database defaults, never from the caller (C-13).
 *
 * @param tx - Transaction client of the gesture.
 * @param data - Values already validated by the service.
 */
export async function insertProduct(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    organizationId: string;
    name: string;
    unit: string;
    price: bigint;
    minOrderQuantity: string | null;
    description: string | null;
    category: string | null;
  }
): Promise<Product> {
  return tx.product.create({ data });
}

/**
 * Inserts a product that the code gives variants to: the unit stays empty, so the old-style mirror
 * of CAT-014 adds no variant of its own, and the price keeps its database default. `created_at`
 * comes from the database; the photos and the pause date stay empty (server-owned).
 *
 * Named apart from {@link insertProduct}, which writes an old-style product with its unit and price.
 */
export async function insertProductForVariants(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    organizationId: string;
    name: string;
    description: string | null;
    category: string | null;
  }
): Promise<Product> {
  return tx.product.create({ data: { ...data, unit: '' } });
}

/**
 * Inserts one ACTIVE variant under a product of the organization. The database sets
 * `price_updated_at`, so a value from the caller can never land (C-13); a live twin or a reused id
 * is refused by the database (23505), which the caller maps.
 */
export async function insertActiveVariant(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    productId: string;
    organizationId: string;
    name: string | null;
    unit: string;
    price: bigint;
    minOrderQuantity: string | null;
  }
): Promise<ProductVariant> {
  return tx.productVariant.create({ data: { ...data, status: 'ACTIVE' } });
}

/**
 * Returns an ACTIVE, live product that the buyer organization may copy: it belongs to another
 * organization that supplies the buyer through a live, ACTIVE relationship where the buyer is
 * `customer_organization_id` (ASVS v5.0.0-8.2.2).
 *
 * @throws 404 NOT_FOUND otherwise, without telling which condition failed.
 */
export async function getProductCopyableBy(
  tx: Prisma.TransactionClient,
  buyerOrganizationId: string,
  productId: string
): Promise<Product> {
  const product = await tx.product.findFirst({
    where: {
      id: productId,
      status: 'ACTIVE',
      deletedAt: null,
      organizationId: { not: buyerOrganizationId },
      organization: {
        suppliedRelationships: {
          some: {
            customerOrganizationId: buyerOrganizationId,
            status: 'ACTIVE',
            deletedAt: null,
            mergedIntoId: null,
          },
        },
      },
    },
  });
  if (!product) throw notFound();
  return product;
}

/**
 * Returns the live product selected by id and organization together (ASVS v5.0.0-8.2.2).
 *
 * @throws 404 NOT_FOUND when the product is absent, deleted or another organization's.
 */
export async function getProductOfOrganization(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string
): Promise<Product> {
  const product = await tx.product.findFirst({
    where: { id: productId, organizationId, deletedAt: null },
  });
  if (!product) throw notFound();
  return product;
}

/**
 * Returns the live variant, with its product's name, selected by id and organization together
 * (ASVS v5.0.0-8.2.2). Any status answers: an INACTIVE variant can still carry a price.
 *
 * @throws 404 NOT_FOUND when the variant is absent, deleted or another organization's.
 */
export async function getVariantOfOrganization(
  tx: Prisma.TransactionClient,
  organizationId: string,
  variantId: string
): Promise<ProductVariant & { product: { name: string } }> {
  const variant = await tx.productVariant.findFirst({
    where: { id: variantId, organizationId, deletedAt: null },
    include: { product: { select: { name: true } } },
  });
  if (!variant) throw notFound();
  return variant;
}

/**
 * Updates the listed text fields of a product already loaded for its organization. Nothing else
 * is touched: the unit, price and status live on the variants.
 *
 * @param data - Only the fields to change; `undefined` keys are left alone, `null` clears.
 */
export async function updateProduct(
  tx: Prisma.TransactionClient,
  productId: string,
  data: { name?: string; description?: string | null; category?: string | null }
): Promise<Product> {
  return tx.product.update({ where: { id: productId }, data });
}

/** Lists the live variants of a product, oldest first then by id (the order of creation). */
export async function listLiveVariantsOfProduct(
  tx: Prisma.TransactionClient,
  productId: string
): Promise<ProductVariant[]> {
  return tx.productVariant.findMany({
    where: { productId, deletedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** Counts the live negotiated prices of a product set before `since`. */
export async function countNegotiatedPricesBefore(
  tx: Prisma.TransactionClient,
  productId: string,
  since: Date
): Promise<number> {
  return tx.customerPrice.count({
    where: { productId, deletedAt: null, setAt: { lt: since } },
  });
}

/**
 * Counts the live negotiated prices of a variant set before `since` (the variant's new
 * `price_updated_at`): the ones the manager should review after a price change.
 */
export async function countVariantNegotiatedPricesBefore(
  tx: Prisma.TransactionClient,
  variantId: string,
  since: Date
): Promise<number> {
  return tx.customerPrice.count({
    where: { productVariantId: variantId, deletedAt: null, setAt: { lt: since } },
  });
}

/**
 * Writes the listed fields of a variant already loaded for its organization. `undefined` keys are
 * left alone, `null` clears the name and the minimum quantity. The database moves
 * `price_updated_at` only when the price really changes (C-13); the code never sets it.
 */
export async function patchVariant(
  tx: Prisma.TransactionClient,
  variantId: string,
  data: {
    name?: string | null;
    unit?: string;
    price?: bigint;
    minOrderQuantity?: string | null;
    status?: 'ACTIVE' | 'INACTIVE';
  }
): Promise<ProductVariant> {
  return tx.productVariant.update({ where: { id: variantId }, data });
}

/** Escapes `\`, `%` and `_` so a search text is matched literally by a LIKE pattern. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Lists the live products of one organization with their live variants, newest product first
 * then by id, one page at a time.
 *
 * The organization filter is always applied to products and variants (ASVS v5.0.0-8.2.2).
 * Every filter value is a bound parameter through the ORM. `status` looks at the live variants:
 * ACTIVE keeps the products with at least one ACTIVE variant, INACTIVE the others. `q` matches
 * the product name or the name of a live variant, case-insensitively, with `%` and `_` taken
 * literally (ASVS v5.0.0-1.2.4). The variants of the page come from one query on the page's
 * ids, oldest first then by id, withdrawn (INACTIVE) ones included.
 *
 * @throws 400 `VALIDATION_ERROR` when the cursor is malformed.
 */
export async function listProductsOfOrganization(
  organizationId: string,
  query: {
    limit: number;
    cursor?: string;
    status?: 'ACTIVE' | 'INACTIVE';
    category?: string;
    q?: string;
  }
): Promise<{
  rows: Array<{ product: Product; variants: ProductVariant[] }>;
  nextCursor: string | null;
}> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const liveActiveVariant = { deletedAt: null, status: 'ACTIVE' as const };
  const found = await prisma.product.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(query.status === 'ACTIVE' ? { variants: { some: liveActiveVariant } } : {}),
      ...(query.status === 'INACTIVE' ? { variants: { none: liveActiveVariant } } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: escapeLike(query.q), mode: 'insensitive' as const } },
              {
                variants: {
                  some: {
                    deletedAt: null,
                    name: { contains: escapeLike(query.q), mode: 'insensitive' as const },
                  },
                },
              },
            ],
          }
        : {}),
      ...(cursor
        ? {
            AND: [
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const products = found.slice(0, query.limit);
  const variants = products.length
    ? await prisma.productVariant.findMany({
        where: {
          organizationId,
          productId: { in: products.map((product) => product.id) },
          deletedAt: null,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : [];
  const last = products[products.length - 1];
  return {
    rows: products.map((product) => ({
      product,
      variants: variants.filter((variant) => variant.productId === product.id),
    })),
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

/**
 * Lists the products on sale of one organization with their ACTIVE variants and the prices of the
 * customer's own live relationship, newest product first then by id, one page at a time.
 *
 * On sale means: product not deleted and not paused, with at least one ACTIVE, not deleted
 * variant; only such variants are returned, oldest first then by id. The customer is either the
 * caller person (no `asOrganizationId`) or that organization, never both; the relationship is
 * selected by supplier and customer together, so another customer's negotiated prices are never
 * read (ASVS v5.0.0-8.2.2). Only live rows count: `visibleRelationsWhere` gives that definition,
 * and deleted negotiated prices are ignored. The variants and prices of the page each come from
 * one query on the page's ids.
 *
 * @param organizationId - Supplier organization, already checked ACTIVE.
 * @param viewer - The authenticated person, and the organization they were checked to manage.
 * @throws 400 `VALIDATION_ERROR` when the cursor is malformed.
 */
export async function listCatalogForCustomer(
  organizationId: string,
  viewer: { personId: string; asOrganizationId?: string },
  query: { limit: number; cursor?: string }
): Promise<{
  rows: Array<{
    product: Product;
    variants: Array<{ variant: ProductVariant; negotiatedPrice: bigint | null }>;
  }>;
  nextCursor: string | null;
}> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const onSaleVariant = { deletedAt: null, status: 'ACTIVE' as const };
  const found = await prisma.product.findMany({
    where: {
      organizationId,
      deletedAt: null,
      pausedAt: null,
      variants: { some: onSaleVariant },
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const products = found.slice(0, query.limit);

  const variants = products.length
    ? await prisma.productVariant.findMany({
        where: {
          organizationId,
          productId: { in: products.map((product) => product.id) },
          ...onSaleVariant,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : [];

  const relationship = await prisma.customerRelationship.findFirst({
    where: {
      AND: [
        visibleRelationsWhere({
          personId: viewer.personId,
          organizationIds: viewer.asOrganizationId ? [viewer.asOrganizationId] : [],
        }),
        { supplierOrganizationId: organizationId },
        viewer.asOrganizationId
          ? { customerOrganizationId: viewer.asOrganizationId }
          : { customerPersonId: viewer.personId },
      ],
    },
    select: { id: true },
  });
  const negotiated =
    relationship && variants.length > 0
      ? await prisma.customerPrice.findMany({
          where: {
            customerRelationshipId: relationship.id,
            productVariantId: { in: variants.map((variant) => variant.id) },
            deletedAt: null,
          },
          select: { productVariantId: true, price: true },
        })
      : [];
  const priceByVariant = new Map(negotiated.map((row) => [row.productVariantId, row.price]));

  const last = products[products.length - 1];
  return {
    rows: products.map((product) => ({
      product,
      variants: variants
        .filter((variant) => variant.productId === product.id)
        .map((variant) => ({ variant, negotiatedPrice: priceByVariant.get(variant.id) ?? null })),
    })),
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

/** A relationship of the supplier organization, as `setCustomerPrice` needs it. */
export type SupplierRelationshipForPrice = {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'ENDED';
  customerPersonId: string | null;
  customerOrganizationId: string | null;
  customerPersonRegistered: boolean;
};

/**
 * Selects and locks one relationship through the visibility predicate AND the supplier
 * organization together, so another business's relationship is never found (ASVS v5.0.0-8.2.2).
 * The row lock serializes two price writes on the same customer for the transaction's length.
 *
 * @returns The relationship, or null when it is absent or outside the organization.
 */
export async function findSupplierRelationshipForPrice(
  tx: Prisma.TransactionClient,
  viewer: { personId: string; organizationId: string },
  relationshipId: string
): Promise<SupplierRelationshipForPrice | null> {
  const found = await tx.customerRelationship.findFirst({
    where: {
      AND: [
        visibleRelationsWhere({
          personId: viewer.personId,
          organizationIds: [viewer.organizationId],
        }),
        { supplierOrganizationId: viewer.organizationId },
        { id: relationshipId },
      ],
    },
    select: {
      id: true,
      status: true,
      customerPersonId: true,
      customerOrganizationId: true,
      customerPerson: { select: { registeredAt: true } },
    },
  });
  if (!found) return null;
  await tx.$queryRaw`SELECT "id" FROM "customer_relationships" WHERE "id" = ${found.id}::uuid FOR UPDATE`;
  return {
    id: found.id,
    status: found.status,
    customerPersonId: found.customerPersonId,
    customerOrganizationId: found.customerOrganizationId,
    customerPersonRegistered: found.customerPerson?.registeredAt != null,
  };
}

/**
 * Creates the live negotiated price of a relationship and variant, or replaces the one that
 * exists (the last writer wins). The partial unique index of C-11, on the relationship and
 * the variant, arbitrates a race, so no second live row can appear. A pair is serialized by an
 * advisory lock for the transaction's length.
 *
 * The old `product_id` column is still required, so the caller passes the variant's product too
 * (until a later story drops it). `set_at` is `now` when given, else the database clock.
 *
 * Without `variantId` (the old-style call of CAT-015) the variant is the one that has the id of
 * the product, which the database fills in at insert. A product that has no variant yet leaves
 * it empty, and the index cannot see such rows: for them the live row of the pair is replaced
 * first, under a lock on the pair.
 *
 * @param data - Row id for a creation (kept row id on a replace), relationship, variant, its
 * product, price and author, all validated by the service.
 */
export async function upsertCustomerPrice(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    relationshipId: string;
    productId: string;
    variantId?: string;
    price: bigint | number;
    setById: string;
    now?: Date;
  }
): Promise<{ productId: string; price: bigint; setById: string; setAt: Date }> {
  type Returned = Array<{ product_id: string; price: bigint; set_by_id: string; set_at: Date }>;
  const price = BigInt(data.price);
  const setAt = data.now ?? new Date();
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${data.relationshipId} || ':' || ${data.variantId ?? data.productId}, 0))`;
  let rows: Returned;
  if (data.variantId !== undefined) {
    rows = await tx.$queryRaw<Returned>`
      INSERT INTO "customer_prices" ("id", "customer_relationship_id", "product_id", "product_variant_id", "price", "set_by_id", "set_at")
      VALUES (${data.id}::uuid, ${data.relationshipId}::uuid, ${data.productId}::uuid, ${data.variantId}::uuid, ${price}::bigint, ${data.setById}::uuid, ${setAt}::timestamptz)
      ON CONFLICT ("customer_relationship_id", "product_variant_id") WHERE "deleted_at" IS NULL
      DO UPDATE SET "price" = EXCLUDED."price", "set_by_id" = EXCLUDED."set_by_id", "set_at" = EXCLUDED."set_at"
      RETURNING "product_id", "price", "set_by_id", "set_at"`;
  } else {
    const legacy = await tx.$queryRaw<Returned>`
      UPDATE "customer_prices"
      SET "price" = ${price}::bigint, "set_by_id" = ${data.setById}::uuid, "set_at" = ${setAt}::timestamptz
      WHERE "customer_relationship_id" = ${data.relationshipId}::uuid
        AND "product_id" = ${data.productId}::uuid
        AND "product_variant_id" IS NULL AND "deleted_at" IS NULL
      RETURNING "product_id", "price", "set_by_id", "set_at"`;
    rows =
      legacy.length > 0
        ? legacy
        : await tx.$queryRaw<Returned>`
      INSERT INTO "customer_prices" ("id", "customer_relationship_id", "product_id", "price", "set_by_id", "set_at")
      VALUES (${data.id}::uuid, ${data.relationshipId}::uuid, ${data.productId}::uuid, ${price}::bigint, ${data.setById}::uuid, ${setAt}::timestamptz)
      ON CONFLICT ("customer_relationship_id", "product_variant_id") WHERE "deleted_at" IS NULL
      DO UPDATE SET "price" = EXCLUDED."price", "set_by_id" = EXCLUDED."set_by_id", "set_at" = EXCLUDED."set_at"
      RETURNING "product_id", "price", "set_by_id", "set_at"`;
  }
  const row = rows[0];
  if (!row) throw new Error('Customer price upsert returned no row');
  return { productId: row.product_id, price: row.price, setById: row.set_by_id, setAt: row.set_at };
}

/**
 * Lists the live negotiated prices of one relationship of the organization, newest `set_at`
 * first then by id, one page at a time. `set_at` is the ordering key because the table has no
 * `created_at`.
 *
 * The relationship is selected through the visibility predicate AND the supplier organization
 * together, so another business's prices are never read (ASVS v5.0.0-8.2.2). Deleted prices are
 * left out; the product comes with the row for its name, price and `price_updated_at`.
 *
 * @returns The page, or null when the relationship is absent or outside the organization.
 * @throws 400 `VALIDATION_ERROR` when the cursor is malformed.
 */
export async function listCustomerPricesOfRelationship(
  viewer: { personId: string; organizationId: string },
  relationshipId: string,
  query: { limit: number; cursor?: string }
): Promise<{
  rows: Array<{
    price: bigint;
    setById: string;
    setAt: Date;
    product: { id: string; name: string; price: bigint; priceUpdatedAt: Date };
    id: string;
  }>;
  nextCursor: string | null;
} | null> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const relationship = await prisma.customerRelationship.findFirst({
    where: {
      AND: [
        visibleRelationsWhere({
          personId: viewer.personId,
          organizationIds: [viewer.organizationId],
        }),
        { supplierOrganizationId: viewer.organizationId },
        { id: relationshipId },
      ],
    },
    select: { id: true },
  });
  if (!relationship) return null;
  const found = await prisma.customerPrice.findMany({
    where: {
      customerRelationshipId: relationship.id,
      deletedAt: null,
      ...(cursor
        ? {
            OR: [
              { setAt: { lt: cursor.createdAt } },
              { setAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ setAt: 'desc' }, { id: 'asc' }],
    take: query.limit + 1,
    select: {
      id: true,
      price: true,
      setById: true,
      setAt: true,
      product: { select: { id: true, name: true, price: true, priceUpdatedAt: true } },
    },
  });
  const rows = found.slice(0, query.limit);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.setAt, id: last.id })
        : null,
  };
}

/** Returns the id of the live negotiated price of a relationship and product, or null. */
export async function findLiveCustomerPriceId(
  tx: Prisma.TransactionClient,
  relationshipId: string,
  productId: string
): Promise<string | null> {
  const row = await tx.customerPrice.findFirst({
    where: { customerRelationshipId: relationshipId, productId, deletedAt: null },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Marks a negotiated price deleted (soft delete, C-11). Only a still-live row is touched, so a
 * concurrent second delete changes nothing.
 *
 * @returns True when this call deleted the row.
 */
export async function softDeleteCustomerPrice(
  tx: Prisma.TransactionClient,
  priceId: string
): Promise<boolean> {
  const result = await tx.customerPrice.updateMany({
    where: { id: priceId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return result.count === 1;
}

/**
 * Reads the live negotiated prices of one relationship that name a variant, ordered by variant,
 * for a copy. The caller has already selected the relationship through the actor's organization.
 */
export async function listLiveCustomerPricesForCopy(
  tx: Prisma.TransactionClient,
  relationshipId: string
): Promise<Array<{ productId: string; variantId: string; price: bigint }>> {
  const rows = await tx.customerPrice.findMany({
    where: {
      customerRelationshipId: relationshipId,
      deletedAt: null,
      productVariantId: { not: null },
    },
    orderBy: { productVariantId: 'asc' },
    select: { productId: true, productVariantId: true, price: true },
  });
  return rows.flatMap((row) =>
    row.productVariantId === null
      ? []
      : [{ productId: row.productId, variantId: row.productVariantId, price: row.price }]
  );
}

const MAX_IMAGE_KEYS = 5;

/**
 * Checks a photo key list before any write: canonical keys of the `products` folder, distinct,
 * five at most (C-49, ASVS v5.0.0-15.3.3). Nothing about the keys is echoed in the message.
 *
 * @throws {RangeError} when a key is not canonical, not in `products/`, repeated, or over five.
 */
function assertProductImageKeys(keys: string[]): void {
  if (keys.length > MAX_IMAGE_KEYS || new Set(keys).size !== keys.length) {
    throw new RangeError('Invalid image key list');
  }
  for (const key of keys) {
    if (!key.startsWith('products/') || !imageKeySchema.safeParse(key).success) {
      throw new RangeError('Invalid image key list');
    }
  }
}

/**
 * Replaces the photo keys of a live product of the organization and returns the previous keys, so
 * the images module can delete the old files after the commit. An empty list clears the photos.
 *
 * The only writer of `products.image_keys` (C-49, ASVS v5.0.0-15.3.3). The row is selected by id
 * and organization together (v5.0.0-8.2.2) and locked before the previous keys are read, so two
 * replacements at once each return what the other wrote (v5.0.0-2.2.3). The database moves
 * `server_updated_at` on the update (C-35).
 *
 * @throws {RangeError} on an invalid key list, before any query.
 * @throws 404 NOT_FOUND when the product is unknown, deleted or another organization's.
 */
export async function setProductImageKeys(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  keys: string[]
): Promise<string[]> {
  assertProductImageKeys(keys);
  const rows = await tx.$queryRaw<Array<{ image_keys: string[] }>>`
    SELECT "image_keys" FROM "products"
    WHERE "id" = ${productId}::uuid AND "organization_id" = ${organizationId}::uuid
      AND "deleted_at" IS NULL
    FOR UPDATE`;
  if (rows.length === 0) throw notFound();
  await tx.product.update({ where: { id: productId }, data: { imageKeys: { set: keys } } });
  return rows[0].image_keys;
}

/**
 * Replaces the photo keys of a live variant of the organization (ACTIVE or INACTIVE) and returns
 * the previous keys. Same rules as {@link setProductImageKeys}; the CAT-021 trigger also moves the
 * `server_updated_at` of the variant's product.
 *
 * @throws {RangeError} on an invalid key list, before any query.
 * @throws 404 NOT_FOUND when the variant is unknown, deleted or another organization's.
 */
export async function setVariantImageKeys(
  tx: Prisma.TransactionClient,
  organizationId: string,
  variantId: string,
  keys: string[]
): Promise<string[]> {
  assertProductImageKeys(keys);
  const rows = await tx.$queryRaw<Array<{ image_keys: string[] }>>`
    SELECT "image_keys" FROM "product_variants"
    WHERE "id" = ${variantId}::uuid AND "organization_id" = ${organizationId}::uuid
      AND "deleted_at" IS NULL
    FOR UPDATE`;
  if (rows.length === 0) throw notFound();
  await tx.productVariant.update({
    where: { id: variantId },
    data: { imageKeys: { set: keys } },
  });
  return rows[0].image_keys;
}

/**
 * Empties the photo keys of products and variants deleted before `deletedBefore` and returns every
 * key released, so the images module can delete the files (C-50). Takes up to `limit` products and
 * up to `limit` variants, oldest deletion first; a row that is live or deleted later keeps its keys
 * whatever the date. Each table is read, locked and emptied in one statement of the caller's
 * transaction (ASVS v5.0.0-2.3.3, CWE-362): a row locked by another transaction is skipped, so two
 * cleanups never release the same key twice. The `deleted_at IS NOT NULL` test is the guard against
 * wiping a live card, even with a date in the future.
 *
 * @returns the released keys; an empty list on a repeat.
 */
export async function releaseDeletedImageKeys(
  tx: Prisma.TransactionClient,
  deletedBefore: Date,
  limit: number
): Promise<string[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Invalid limit');
  const products = await tx.$queryRaw<Array<{ key: string }>>`
    WITH picked AS (
      SELECT "id", "image_keys" FROM "products"
      WHERE "deleted_at" IS NOT NULL AND "deleted_at" < ${deletedBefore}
        AND cardinality("image_keys") > 0
      ORDER BY "deleted_at", "id"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ), emptied AS (
      UPDATE "products" SET "image_keys" = '{}'
      FROM picked WHERE "products"."id" = picked."id"
      RETURNING picked."image_keys" AS "keys"
    )
    SELECT unnest("keys") AS "key" FROM emptied`;
  const variants = await tx.$queryRaw<Array<{ key: string }>>`
    WITH picked AS (
      SELECT "id", "image_keys" FROM "product_variants"
      WHERE "deleted_at" IS NOT NULL AND "deleted_at" < ${deletedBefore}
        AND cardinality("image_keys") > 0
      ORDER BY "deleted_at", "id"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ), emptied AS (
      UPDATE "product_variants" SET "image_keys" = '{}'
      FROM picked WHERE "product_variants"."id" = picked."id"
      RETURNING picked."image_keys" AS "keys"
    )
    SELECT unnest("keys") AS "key" FROM emptied`;
  return [...products, ...variants].map((row) => row.key);
}

/** The photo keys of a variant with the product it belongs to. */
export type VariantImageKeys = { productId: string; keys: string[] };

/**
 * Reads the photo keys of a live product of the organization, in display order, and locks the row
 * until the caller's transaction ends, so the read and the write that follows are one step
 * (ASVS v5.0.0-2.3.3, CWE-362). The row is selected by id and organization together (v5.0.0-8.2.2).
 * Keys never leave the server through a catalog route (C-49).
 *
 * @throws 404 NOT_FOUND when the product is unknown, deleted or another organization's.
 */
export async function lockProductImageKeys(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ image_keys: string[] }>>`
    SELECT "image_keys" FROM "products"
    WHERE "id" = ${productId}::uuid AND "organization_id" = ${organizationId}::uuid
      AND "deleted_at" IS NULL
    FOR UPDATE`;
  if (rows.length === 0) throw notFound();
  return rows[0].image_keys;
}

/**
 * Same read as {@link lockProductImageKeys} without the lock, for a card a photo is copied from.
 *
 * @throws 404 NOT_FOUND when the product is unknown, deleted or another organization's.
 */
export async function readProductImageKeys(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ image_keys: string[] }>>`
    SELECT "image_keys" FROM "products"
    WHERE "id" = ${productId}::uuid AND "organization_id" = ${organizationId}::uuid
      AND "deleted_at" IS NULL`;
  if (rows.length === 0) throw notFound();
  return rows[0].image_keys;
}

/**
 * Reads the photo keys and the product id of a live variant (ACTIVE or INACTIVE) of the
 * organization, and locks the row until the caller's transaction ends. Same rules as
 * {@link lockProductImageKeys}.
 *
 * @throws 404 NOT_FOUND when the variant is unknown, deleted or another organization's.
 */
export async function lockVariantImageKeys(
  tx: Prisma.TransactionClient,
  organizationId: string,
  variantId: string
): Promise<VariantImageKeys> {
  const rows = await tx.$queryRaw<Array<{ product_id: string; image_keys: string[] }>>`
    SELECT "product_id", "image_keys" FROM "product_variants"
    WHERE "id" = ${variantId}::uuid AND "organization_id" = ${organizationId}::uuid
      AND "deleted_at" IS NULL
    FOR UPDATE`;
  if (rows.length === 0) throw notFound();
  return { productId: rows[0].product_id, keys: rows[0].image_keys };
}

/**
 * Same read as {@link lockVariantImageKeys} without the lock, for a card a photo is copied from.
 *
 * @throws 404 NOT_FOUND when the variant is unknown, deleted or another organization's.
 */
export async function readVariantImageKeys(
  tx: Prisma.TransactionClient,
  organizationId: string,
  variantId: string
): Promise<VariantImageKeys> {
  const rows = await tx.$queryRaw<Array<{ product_id: string; image_keys: string[] }>>`
    SELECT "product_id", "image_keys" FROM "product_variants"
    WHERE "id" = ${variantId}::uuid AND "organization_id" = ${organizationId}::uuid
      AND "deleted_at" IS NULL`;
  if (rows.length === 0) throw notFound();
  return { productId: rows[0].product_id, keys: rows[0].image_keys };
}

/** A product row as the synchronization sees it, whoever owns it and whatever its state. */
export type ProductAnyState = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  category: string | null;
  deletedAt: Date | null;
};

/**
 * Reads a product by id alone, deleted or not, and locks the row for the transaction so two
 * pushes of the same product apply one after the other. The caller decides what to do with an
 * organization or a state that is not its own (the id is never trusted, v5.0.0-8.2.2).
 *
 * @returns The row, or null when no product has this id.
 */
export async function findProductAnyState(
  tx: Prisma.TransactionClient,
  productId: string
): Promise<ProductAnyState | null> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      organization_id: string;
      name: string;
      description: string | null;
      category: string | null;
      deleted_at: Date | null;
    }>
  >`
    SELECT "id", "organization_id", "name", "description", "category", "deleted_at"
    FROM "products" WHERE "id" = ${productId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    category: row.category,
    deletedAt: row.deleted_at,
  };
}

/**
 * Inserts a new-style product (empty unit, default price, no photo, not paused) written from a
 * synchronization push. Only the three text fields come from the phone (C-46). A row that
 * appeared since the read (a race on the same id) is left alone: no uniqueness error ever
 * reaches the synchronization (C-36).
 *
 * Named apart from {@link insertProduct}, which writes an old-style product with its unit and price.
 *
 * @returns True when this call created the row.
 */
export async function insertSyncedProduct(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    organizationId: string;
    name: string;
    description: string | null;
    category: string | null;
  }
): Promise<boolean> {
  const created = await tx.product.createMany({ data: [data], skipDuplicates: true });
  return created.count === 1;
}

/**
 * Rewrites the three text fields of a product. Nothing else is touched; the database moves
 * `server_updated_at` (C-35).
 */
export async function updateProductText(
  tx: Prisma.TransactionClient,
  productId: string,
  data: { name: string; description: string | null; category: string | null }
): Promise<void> {
  await tx.product.update({
    where: { id: productId },
    data: { name: data.name, description: data.description, category: data.category },
  });
}

/** A variant row as the synchronization sees it, whoever owns it and whatever its state. */
export type VariantAnyState = {
  id: string;
  productId: string;
  organizationId: string;
  name: string | null;
  unit: string;
  price: bigint;
  /** Canonical text of the `numeric(12,3)` column, such as "2.500", or null. */
  minOrderQuantity: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  deletedAt: Date | null;
  /** The live variant this one was folded into (CAT-035), or null. */
  mergedIntoId: string | null;
};

/**
 * Reads a variant by id alone, deleted or not, and locks the row for the transaction so two
 * pushes of the same variant apply one after the other. The caller judges the organization and
 * the state: the id is never trusted (v5.0.0-8.2.2).
 *
 * @returns The row, or null when no variant has this id.
 */
export async function findVariantAnyState(
  tx: Prisma.TransactionClient,
  variantId: string
): Promise<VariantAnyState | null> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      product_id: string;
      organization_id: string;
      name: string | null;
      unit: string;
      price: bigint;
      min_order_quantity: string | null;
      status: 'ACTIVE' | 'INACTIVE';
      deleted_at: Date | null;
      merged_into_id: string | null;
    }>
  >`
    SELECT "id", "product_id", "organization_id", "name", "unit", "price",
           "min_order_quantity"::text AS "min_order_quantity", "status"::text AS "status",
           "deleted_at", "merged_into_id"
    FROM "product_variants" WHERE "id" = ${variantId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    organizationId: row.organization_id,
    name: row.name,
    unit: row.unit,
    price: BigInt(row.price),
    minOrderQuantity: row.min_order_quantity,
    status: row.status,
    deletedAt: row.deleted_at,
    mergedIntoId: row.merged_into_id,
  };
}

/**
 * Finds the live variant of a product that has the same simplified name and unit as the given
 * ones (C-47). The comparison is the SQL expression of the unique index of CAT-018, so the answer
 * always agrees with what the index would refuse, whatever the collation.
 *
 * @param exceptId - A variant not to count, the one being edited.
 * @returns The id of the twin, or null.
 */
export async function findLiveTwin(
  tx: Prisma.TransactionClient,
  productId: string,
  name: string | null,
  unit: string,
  exceptId?: string
): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "product_variants"
    WHERE "product_id" = ${productId}::uuid
      AND "deleted_at" IS NULL
      AND (${exceptId ?? null}::uuid IS NULL OR "id" <> ${exceptId ?? null}::uuid)
      AND lower(btrim(regexp_replace(coalesce("name", ''), '[ \t\r\n]+', ' ', 'g')))
        = lower(btrim(regexp_replace(coalesce(${name}::text, ''), '[ \t\r\n]+', ' ', 'g')))
      AND lower(btrim(regexp_replace(coalesce("unit", ''), '[ \t\r\n]+', ' ', 'g')))
        = lower(btrim(regexp_replace(coalesce(${unit}::text, ''), '[ \t\r\n]+', ' ', 'g')))
    ORDER BY "created_at", "id"
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

/**
 * Finds the live variant of a product with the same simplified name and unit as the given ones
 * (C-47), whatever its status. Same SQL comparison as {@link findLiveTwin}, so the answer agrees
 * with the unique index of CAT-018.
 *
 * @param name - The new variant's name; `undefined` counts as empty text.
 * @returns The id and status of the twin, or null.
 */
export async function findLiveVariantByText(
  tx: Prisma.TransactionClient,
  productId: string,
  name: string | undefined,
  unit: string
): Promise<{ id: string; status: 'ACTIVE' | 'INACTIVE' } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; status: 'ACTIVE' | 'INACTIVE' }>>`
    SELECT "id", "status"::text AS "status" FROM "product_variants"
    WHERE "product_id" = ${productId}::uuid
      AND "deleted_at" IS NULL
      AND lower(btrim(regexp_replace(coalesce("name", ''), '[ \t\r\n]+', ' ', 'g')))
        = lower(btrim(regexp_replace(coalesce(${name ?? null}::text, ''), '[ \t\r\n]+', ' ', 'g')))
      AND lower(btrim(regexp_replace(coalesce("unit", ''), '[ \t\r\n]+', ' ', 'g')))
        = lower(btrim(regexp_replace(coalesce(${unit}::text, ''), '[ \t\r\n]+', ' ', 'g')))
    ORDER BY "created_at", "id"
    LIMIT 1`;
  return rows[0] ?? null;
}

/**
 * Inserts a variant written from a synchronization push: the five phone fields only; the price
 * date, the photos and the merge link keep their database defaults (C-13, C-47). A row that
 * conflicts (the same id, or a live twin created since the read) is left alone, so no uniqueness
 * error reaches the synchronization (C-36).
 *
 * @returns True when this call created the row.
 */
export async function insertVariant(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    productId: string;
    organizationId: string;
    name: string | null;
    unit: string;
    price: number;
    minOrderQuantity: string | null;
    status: 'ACTIVE' | 'INACTIVE';
  }
): Promise<boolean> {
  const created = await tx.productVariant.createMany({
    data: [{ ...data, price: BigInt(data.price) }],
    skipDuplicates: true,
  });
  return created.count === 1;
}

/**
 * Stores a duplicate variant already folded into its live twin: a deleted row (`deleted_at` set)
 * whose `merged_into_id` is the twin, so it never meets the unique index of live variants
 * (C-47, C-36). The link is the server's own search result, never a value of the phone
 * (v5.0.0-15.3.3); the other fields are the phone's five, and the twin is left untouched. A row
 * with the same id already there is left alone, and the caller judges what is stored.
 *
 * @param twinId - The live twin found inside the organization's product (v5.0.0-8.2.2).
 * @param now - Deletion date of the folded row.
 */
export async function insertMergedVariant(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    productId: string;
    name: string | null;
    unit: string;
    price: number;
    minOrderQuantity: string | null;
    status: 'ACTIVE' | 'INACTIVE';
  },
  organizationId: string,
  twinId: string,
  now: Date
): Promise<void> {
  await tx.productVariant.createMany({
    data: [
      {
        id: input.id,
        productId: input.productId,
        organizationId,
        name: input.name,
        unit: input.unit,
        price: BigInt(input.price),
        minOrderQuantity: input.minOrderQuantity,
        status: input.status,
        deletedAt: now,
        mergedIntoId: twinId,
      },
    ],
    skipDuplicates: true,
  });
}

/**
 * Rewrites the five phone fields of a variant. The product, the photos, the merge link and the
 * deletion date are never touched; the database moves `price_updated_at` only when the price
 * changes (C-13) and the product's date (CAT-021).
 */
export async function updateVariant(
  tx: Prisma.TransactionClient,
  variantId: string,
  data: {
    name: string | null;
    unit: string;
    price: number;
    minOrderQuantity: string | null;
    status: 'ACTIVE' | 'INACTIVE';
  }
): Promise<void> {
  await tx.productVariant.update({
    where: { id: variantId },
    data: {
      name: data.name,
      unit: data.unit,
      price: BigInt(data.price),
      minOrderQuantity: data.minOrderQuantity,
      status: data.status,
    },
  });
}

/**
 * Counts the products a business has on sale: not deleted, not paused, with at least one variant
 * that is ACTIVE and not deleted (C-46). A product counts once however many variants it has. The
 * count is bound to the organization id (ASVS v5.0.0-8.2.2).
 *
 * @param tx - The caller's transaction.
 * @param organizationId - The business, taken from the session or server code, never a request.
 */
export async function countProductsOnSale(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<number> {
  return tx.product.count({
    where: {
      organizationId,
      deletedAt: null,
      pausedAt: null,
      variants: { some: { status: 'ACTIVE', deletedAt: null } },
    },
  });
}

/** A product on sale or paused, with every not deleted variant it holds. */
export type SaleProduct = { productId: string; createdAt: Date; variantIds: string[] };

async function listSaleProducts(
  tx: Prisma.TransactionClient,
  organizationId: string,
  paused: boolean
): Promise<SaleProduct[]> {
  const rows = await tx.product.findMany({
    where: {
      organizationId,
      deletedAt: null,
      pausedAt: paused ? { not: null } : null,
      variants: { some: { status: 'ACTIVE', deletedAt: null } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      createdAt: true,
      variants: {
        where: { deletedAt: null },
        select: { id: true },
        orderBy: { id: 'asc' },
      },
    },
  });
  return rows.map((row) => ({
    productId: row.id,
    createdAt: row.createdAt,
    variantIds: row.variants.map((variant) => variant.id),
  }));
}

/**
 * Lists the products a business has on sale (the same rule as `countProductsOnSale`, C-46), newest
 * first, each with the ids of all its not deleted variants. Bound to the organization id
 * (ASVS v5.0.0-8.2.2) so billing can read it without touching catalog tables (ADR-004).
 *
 * @param tx - The caller's transaction.
 * @param organizationId - The business, given by server code, never a request.
 */
export async function listProductsOnSale(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<SaleProduct[]> {
  return listSaleProducts(tx, organizationId, false);
}

/**
 * Lists the products of a business that are paused but would otherwise be on sale (not deleted,
 * at least one ACTIVE, not deleted variant), newest first. Billing resumes from this list.
 *
 * @param tx - The caller's transaction.
 * @param organizationId - The business, given by server code, never a request.
 */
export async function listPausedProducts(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<SaleProduct[]> {
  return listSaleProducts(tx, organizationId, true);
}

/**
 * Pauses or resumes products of one business (C-46: `paused_at` is written by the server only).
 * Only ids that belong to the organization, are not deleted and are not already in the requested
 * state are changed, so an id of another business is silently left alone (ASVS v5.0.0-8.2.2) and
 * the first `paused_at` of a paused product is kept. `server_updated_at` is also sent so the phones
 * receive the change; the database trigger sets it to the server time anyway (C-35).
 *
 * @param tx - The caller's transaction, so the change commits or rolls back with the caller's work
 *   (ASVS v5.0.0-2.3.3).
 * @param organizationId - The business, given by server code, never a request.
 * @param productIds - The products to change.
 * @param paused - True to pause, false to resume.
 * @param now - The instant written as `paused_at` when pausing.
 * @returns The ids it changed.
 */
export async function setProductsPaused(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productIds: string[],
  paused: boolean,
  now: Date
): Promise<string[]> {
  if (productIds.length === 0) return [];
  const rows = await tx.product.updateManyAndReturn({
    where: {
      id: { in: productIds },
      organizationId,
      deletedAt: null,
      pausedAt: paused ? null : { not: null },
    },
    data: { pausedAt: paused ? now : null, serverUpdatedAt: now },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Tells which of the given variants an order line or a live negotiated price cites (C-48): those
 * are never deleted, only taken off sale. Order lines count whatever their own or their order's
 * state (through the order module's `listOrderedVariantIds`); negotiated prices count only while
 * live, so a price deleted earlier does not keep a variant alive. The ids come from server code
 * that has already checked the organization (ASVS v5.0.0-8.2.2).
 *
 * @param tx - The caller's transaction, so the check and the deletion that follows are one step.
 * @param variantIds - Variant ids to check; an empty list answers an empty set.
 * @returns The subset of `variantIds` that is cited.
 */
export async function findUsedVariantIds(
  tx: Prisma.TransactionClient,
  variantIds: string[]
): Promise<Set<string>> {
  if (variantIds.length === 0) return new Set();
  const used = await listOrderedVariantIds(tx, variantIds);
  const prices = await tx.customerPrice.findMany({
    where: { productVariantId: { in: variantIds }, deletedAt: null },
    select: { productVariantId: true },
  });
  for (const price of prices) {
    if (price.productVariantId !== null) used.add(price.productVariantId);
  }
  return used;
}

/**
 * Reads a product of the organization, deleted or not, selected by id and organization together
 * (ASVS v5.0.0-8.2.2), and locks the row until the caller's transaction ends so two deletions of
 * one product's variants run one after the other (CWE-362).
 *
 * @returns The id and deletion date, or null when the product is absent or another business's.
 */
export async function lockProductOfOrganizationAnyState(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string
): Promise<{ id: string; deletedAt: Date | null } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; deleted_at: Date | null }>>`
    SELECT "id", "deleted_at" FROM "products"
    WHERE "id" = ${productId}::uuid AND "organization_id" = ${organizationId}::uuid
    FOR UPDATE`;
  const row = rows[0];
  return row ? { id: row.id, deletedAt: row.deleted_at } : null;
}

/**
 * Locks the live variants of a product, in id order, until the caller's transaction ends. Taking
 * the variant locks before the product lock keeps the same order as an edit (variant, then the
 * product its trigger touches), so the two cannot deadlock.
 */
export async function lockLiveVariantsOfProduct(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string
): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "product_variants"
    WHERE "product_id" = ${productId}::uuid AND "organization_id" = ${organizationId}::uuid
      AND "deleted_at" IS NULL
    ORDER BY "id" FOR UPDATE`;
}

/** Marks the given variants deleted (soft delete); a variant already deleted keeps its date. */
export async function softDeleteVariants(
  tx: Prisma.TransactionClient,
  variantIds: string[],
  now: Date
): Promise<void> {
  await tx.productVariant.updateMany({
    where: { id: { in: variantIds }, deletedAt: null },
    data: { deletedAt: now },
  });
}

/** Marks a product deleted (soft delete); one already deleted keeps its date. */
export async function softDeleteProduct(
  tx: Prisma.TransactionClient,
  productId: string,
  now: Date
): Promise<void> {
  await tx.product.updateMany({
    where: { id: productId, deletedAt: null },
    data: { deletedAt: now },
  });
}

/**
 * Takes variants off sale (`INACTIVE`), the only change a retired variant gets (C-48,
 * v5.0.0-15.3.3). The ids come from server code that has already checked the organization
 * (v5.0.0-8.2.2); a deleted variant is left alone. The database moves the product's
 * `server_updated_at` (CAT-021).
 */
export async function retireVariants(
  tx: Prisma.TransactionClient,
  variantIds: string[]
): Promise<void> {
  if (variantIds.length === 0) return;
  await tx.productVariant.updateMany({
    where: { id: { in: variantIds }, deletedAt: null, status: 'ACTIVE' },
    data: { status: 'INACTIVE' },
  });
}

/**
 * Brings a deleted variant back off sale: `deleted_at` emptied, `status` `INACTIVE`, and the merge
 * link emptied too (a link only exists on a deleted row, C-47). The ids come from server code that
 * has already checked the organization (v5.0.0-8.2.2). The database moves the variant's and the
 * product's `server_updated_at`.
 */
export async function restoreVariantOffSale(
  tx: Prisma.TransactionClient,
  variantId: string
): Promise<void> {
  await tx.productVariant.updateMany({
    where: { id: variantId, deletedAt: { not: null } },
    data: { deletedAt: null, status: 'INACTIVE', mergedIntoId: null },
  });
}

/** Brings a deleted product back (`deleted_at` emptied); a live product is left alone. */
export async function restoreProduct(
  tx: Prisma.TransactionClient,
  productId: string
): Promise<void> {
  await tx.product.updateMany({
    where: { id: productId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
}
