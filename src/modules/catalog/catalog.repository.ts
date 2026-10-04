import type { Prisma, Product } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { httpError } from '../../lib/http-error.js';
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
 * Creates the live negotiated price of a relationship and product, or replaces the one that
 * exists (the last writer wins), in a single statement. The partial unique index of C-11
 * arbitrates a race, so no second live row can appear. `set_at` is the server time.
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
  const rows = await tx.$queryRaw<
    Array<{ product_id: string; price: bigint; set_by_id: string; set_at: Date }>
  >`
    INSERT INTO "customer_prices" ("id", "customer_relationship_id", "product_id", "price", "set_by_id", "set_at")
    VALUES (${data.id}::uuid, ${data.relationshipId}::uuid, ${data.productId}::uuid, ${data.price}::bigint, ${data.setById}::uuid, clock_timestamp())
    ON CONFLICT ("customer_relationship_id", "product_id") WHERE "deleted_at" IS NULL
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
