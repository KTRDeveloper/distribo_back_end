import type { Prisma, Product } from '@prisma/client';
import { httpError } from '../../lib/http-error.js';

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
