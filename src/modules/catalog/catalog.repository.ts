import type { Prisma, Product } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { httpError } from '../../lib/http-error.js';
import { imageKeySchema } from '../../lib/image-keys.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
import { visibleRelationsWhere } from '../relationship/relationship.visibility.js';

const notFound = () => httpError(404, 'NOT_FOUND', 'Not found');

/**
 * Price an order line freezes for a relationship and product (CM-11): the live
 * negotiated price when one exists, even above the product price, else the
 * product price. `changedAt` is the negotiated `set_at` or `price_updated_at`.
 *
 * Read inside the caller's transaction, from the database (v5.0.0-2.2.3). Only
 * the given relationship's price is read, never another customer's (AB-1). The
 * product must belong to the relationship's supplier organization; otherwise,
 * or when either is absent, it throws 404 NOT_FOUND (fail closed).
 *
 * @throws 404 NOT_FOUND when the relationship or product is unknown, or the
 * product is not the supplier's.
 */
export async function getReferencePrice(
  tx: Prisma.TransactionClient,
  relationshipId: string,
  productId: string
): Promise<{ price: bigint; negotiated: boolean; changedAt: Date }> {
  const relationship = await tx.customerRelationship.findUnique({
    where: { id: relationshipId },
    select: { supplierOrganizationId: true },
  });
  if (!relationship?.supplierOrganizationId) throw notFound();

  const product = await tx.product.findFirst({
    where: { id: productId, organizationId: relationship.supplierOrganizationId },
    select: { price: true, priceUpdatedAt: true },
  });
  if (!product) throw notFound();

  const negotiated = await tx.customerPrice.findFirst({
    where: { customerRelationshipId: relationshipId, productId, deletedAt: null },
    select: { price: true, setAt: true },
  });
  if (negotiated) {
    return { price: negotiated.price, negotiated: true, changedAt: negotiated.setAt };
  }
  return { price: product.price, negotiated: false, changedAt: product.priceUpdatedAt };
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
 * Updates the listed fields of a product already loaded for its organization. Never writes
 * `price_updated_at`: the database moves it only when the price really changes (C-13).
 *
 * @param data - Only the fields to change; `undefined` keys are left alone.
 */
export async function updateProduct(
  tx: Prisma.TransactionClient,
  productId: string,
  data: {
    name?: string;
    unit?: string;
    price?: bigint;
    minOrderQuantity?: string | null;
    description?: string;
    category?: string;
    status?: 'ACTIVE' | 'INACTIVE';
  }
): Promise<Product> {
  return tx.product.update({ where: { id: productId }, data });
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

/** Escapes `\`, `%` and `_` so a search text is matched literally by a LIKE pattern. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Lists the live products of one organization, newest first then by id, one page at a time.
 *
 * The organization filter is always applied (ASVS v5.0.0-8.2.2). Every filter value is a
 * bound parameter through the ORM; `q` matches the name case-insensitively, with `%` and `_`
 * taken literally (ASVS v5.0.0-1.2.4).
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
): Promise<{ rows: Product[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const found = await prisma.product.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.q ? { name: { contains: escapeLike(query.q), mode: 'insensitive' as const } } : {}),
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
  const rows = found.slice(0, query.limit);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

/**
 * Lists the ACTIVE, not deleted products of one organization with the prices of the customer's
 * own live relationship, newest first then by id, one page at a time.
 *
 * The customer is either the caller person (no `asOrganizationId`) or that organization, never
 * both; the relationship is selected by supplier and customer together, so another customer's
 * negotiated prices are never read (ASVS v5.0.0-8.2.2). Only live rows count: not deleted, not
 * merged, and `visibleRelationsWhere` gives that definition. Deleted negotiated prices are ignored.
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
  rows: Array<{ product: Product; negotiatedPrice: bigint | null }>;
  nextCursor: string | null;
}> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const found = await prisma.product.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: 'ACTIVE',
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
    relationship && products.length > 0
      ? await prisma.customerPrice.findMany({
          where: {
            customerRelationshipId: relationship.id,
            productId: { in: products.map((product) => product.id) },
            deletedAt: null,
          },
          select: { productId: true, price: true },
        })
      : [];
  const priceByProduct = new Map(negotiated.map((row) => [row.productId, row.price]));

  const last = products[products.length - 1];
  return {
    rows: products.map((product) => ({
      product,
      negotiatedPrice: priceByProduct.get(product.id) ?? null,
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
 * the variant, arbitrates a race, so no second live row can appear. `set_at` is the server
 * time.
 *
 * The variant is the one that has the id of the product (CAT-013), which the database fills
 * in at insert. A product that has no variant yet leaves it empty, and the index cannot see
 * such rows: for them the live row of the pair is replaced first, under a lock on the pair,
 * until a later story creates every variant with its product and drops `product_id`.
 *
 * @param data - Row id for a creation (kept row id on a replace), relationship, product,
 * price and author, all validated by the service.
 */
export async function upsertCustomerPrice(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    relationshipId: string;
    productId: string;
    price: bigint;
    setById: string;
  }
): Promise<{ productId: string; price: bigint; setById: string; setAt: Date }> {
  type Returned = Array<{ product_id: string; price: bigint; set_by_id: string; set_at: Date }>;
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${data.relationshipId} || ':' || ${data.productId}, 0))`;
  const legacy = await tx.$queryRaw<Returned>`
    UPDATE "customer_prices"
    SET "price" = ${data.price}::bigint, "set_by_id" = ${data.setById}::uuid, "set_at" = clock_timestamp()
    WHERE "customer_relationship_id" = ${data.relationshipId}::uuid
      AND "product_id" = ${data.productId}::uuid
      AND "product_variant_id" IS NULL AND "deleted_at" IS NULL
    RETURNING "product_id", "price", "set_by_id", "set_at"`;
  const rows =
    legacy.length > 0
      ? legacy
      : await tx.$queryRaw<Returned>`
    INSERT INTO "customer_prices" ("id", "customer_relationship_id", "product_id", "price", "set_by_id", "set_at")
    VALUES (${data.id}::uuid, ${data.relationshipId}::uuid, ${data.productId}::uuid, ${data.price}::bigint, ${data.setById}::uuid, clock_timestamp())
    ON CONFLICT ("customer_relationship_id", "product_variant_id") WHERE "deleted_at" IS NULL
    DO UPDATE SET "price" = EXCLUDED."price", "set_by_id" = EXCLUDED."set_by_id", "set_at" = clock_timestamp()
    RETURNING "product_id", "price", "set_by_id", "set_at"`;
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
 * Reads the live negotiated prices of one relationship, ordered by product, for a copy. The
 * caller has already selected the relationship through the actor's organization.
 */
export async function listLiveCustomerPricesForCopy(
  tx: Prisma.TransactionClient,
  relationshipId: string
): Promise<Array<{ productId: string; price: bigint }>> {
  return tx.customerPrice.findMany({
    where: { customerRelationshipId: relationshipId, deletedAt: null },
    orderBy: { productId: 'asc' },
    select: { productId: true, price: true },
  });
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
