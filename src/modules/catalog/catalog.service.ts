import type { Product } from '@prisma/client';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { assertOrganizationActive, getActiveCollaboration } from '../../middleware/load-actor.js';
import {
  findOrganizationStatus,
  runInTransaction,
} from '../organization/organization.repository.js';
import { atLeast } from '../../shared/access/roles.js';
import type { Actor } from '../../types/express.js';
import {
  countNegotiatedPricesBefore,
  getProductOfOrganization,
  insertProduct,
  listCatalogForCustomer,
  listProductsOfOrganization,
  updateProduct,
} from './catalog.repository.js';
import type {
  BrowseQuery,
  CatalogPage,
  CreateProductInput,
  EditProductInput,
  ListProductsQuery,
  ProductPage,
  ProductView,
} from './catalog.schemas.js';

/** Builds the closed product view from an explicit field list. */
function toProductView(product: Product): ProductView {
  return {
    id: product.id,
    name: product.name,
    unit: product.unit,
    price: Number(product.price),
    price_updated_at: product.priceUpdatedAt.toISOString(),
    min_order_quantity: product.minOrderQuantity?.toString() ?? null,
    description: product.description,
    category: product.category,
    status: product.status,
    created_at: product.createdAt.toISOString(),
  };
}

/**
 * Creates an ACTIVE product in the actor's organization.
 *
 * The role is decided by the route (`create Product` in the rules table, ASVS v5.0.0-8.2.1);
 * the organization comes from the loaded actor, never from the body. The organization must be
 * ACTIVE, checked in the same transaction as the insert (fail closed). Status and
 * `price_updated_at` are set by the server (C-13).
 *
 * @param actor - Actor loaded from the path.
 * @param input - Validated body.
 * @throws 409 `ORGANIZATION_NOT_ACTIVE`; 404 `NOT_FOUND` when the organization vanished.
 */
export async function createProduct(actor: Actor, input: CreateProductInput): Promise<ProductView> {
  return runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    const product = await insertProduct(tx, {
      id: input.id,
      organizationId: actor.organizationId,
      name: input.name,
      unit: input.unit,
      price: BigInt(input.price),
      minOrderQuantity: input.min_order_quantity ?? null,
      description: input.description ?? null,
      category: input.category ?? null,
    });
    return toProductView(product);
  });
}

/**
 * Edits a product of the actor's organization, including its price and its status.
 *
 * The role is decided by the route (`update Product`, ASVS v5.0.0-8.2.1); the product is
 * selected by id and organization together, so another business's product is a 404
 * (v5.0.0-8.2.2). `price_updated_at` moves in the database only when the price changes (C-13);
 * then `negotiated_prices_to_review` counts the live negotiated prices set before that moment,
 * else it is 0. INACTIVE removes the article from sale; frozen order lines are untouched.
 *
 * @param actor - Actor loaded from the path.
 * @param productId - Product from the path.
 * @param input - Validated body, at least one field.
 * @throws 404 `NOT_FOUND` when the product is absent, deleted or another organization's.
 */
export async function editProduct(
  actor: Actor,
  productId: string,
  input: EditProductInput
): Promise<ProductView & { negotiated_prices_to_review: number }> {
  return runInTransaction(async (tx) => {
    const before = await getProductOfOrganization(tx, actor.organizationId, productId);
    const updated = await updateProduct(tx, before.id, {
      name: input.name,
      unit: input.unit,
      price: input.price === undefined ? undefined : BigInt(input.price),
      minOrderQuantity: input.min_order_quantity,
      description: input.description,
      category: input.category,
      status: input.status,
    });
    const priceChanged = updated.price !== before.price;
    const toReview = priceChanged
      ? await countNegotiatedPricesBefore(tx, updated.id, updated.priceUpdatedAt)
      : 0;
    return { ...toProductView(updated), negotiated_prices_to_review: toReview };
  });
}

/**
 * Lists the actor's organization products, newest first: SELLER and above only.
 *
 * The organization comes from the loaded actor, never from the query (ASVS v5.0.0-8.2.2), and
 * the view is built from an explicit field list (v5.0.0-15.3.1). Deleted products are left out.
 *
 * @param actor - Actor loaded from the path.
 * @param query - Validated page size, cursor and filters.
 * @returns A page of product views and the next cursor.
 * @throws 403 `FORBIDDEN` for a DRIVER.
 */
export async function listProducts(actor: Actor, query: ListProductsQuery): Promise<ProductPage> {
  if (!atLeast(actor.role, 'SELLER')) {
    logger.warn(
      {
        event: 'permission_refused',
        personId: actor.personId,
        action: 'list',
        subjectType: 'Product',
      },
      'Permission refused'
    );
    throw httpError(403, 'FORBIDDEN', 'Permission denied');
  }
  const { rows, nextCursor } = await listProductsOfOrganization(actor.organizationId, query);
  return { items: rows.map(toProductView), next_cursor: nextCursor };
}

/**
 * A customer browses a business's catalog with their own prices (CM-11).
 *
 * Any signed-in person may browse an ACTIVE organization; a CLOSED, SUSPENDED or unknown one is
 * a 404. With `as_organization_id` the customer is that organization: the caller must be its
 * ACTIVE MANAGER or OWNER, else 404 so the organization is never confirmed (ASVS v5.0.0-8.2.2).
 * The negotiated prices come only from the caller's own live relationship with this supplier
 * (the organization's with `as_organization_id`); the view lists only customer-safe fields
 * (v5.0.0-8.2.3, v5.0.0-15.3.1).
 *
 * @param personId - Authenticated person, from the token.
 * @param organizationId - Supplier organization from the path.
 * @param query - Validated page size, cursor and optional customer organization.
 * @throws 404 `NOT_FOUND` for an inactive or unknown supplier, or an organization the caller
 * does not manage.
 */
export async function browseCatalog(
  personId: string,
  organizationId: string,
  query: BrowseQuery
): Promise<CatalogPage> {
  if ((await findOrganizationStatus(organizationId)) !== 'ACTIVE') {
    throw httpError(404, 'NOT_FOUND', 'Not found');
  }
  if (query.as_organization_id) {
    const collaboration = await getActiveCollaboration(personId, query.as_organization_id);
    if (collaboration?.role !== 'MANAGER' && collaboration?.role !== 'OWNER') {
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }
  }
  const { rows, nextCursor } = await listCatalogForCustomer(
    organizationId,
    { personId, asOrganizationId: query.as_organization_id },
    query
  );
  return {
    items: rows.map(({ product, negotiatedPrice }) => ({
      id: product.id,
      name: product.name,
      unit: product.unit,
      price: Number(negotiatedPrice ?? product.price),
      min_order_quantity: product.minOrderQuantity?.toString() ?? null,
      description: product.description,
      category: product.category,
      price_is_negotiated: negotiatedPrice !== null,
    })),
    next_cursor: nextCursor,
  };
}
