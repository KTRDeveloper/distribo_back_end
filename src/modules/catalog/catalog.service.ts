import type { Prisma, Product } from '@prisma/client';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { assertOrganizationActive, getActiveCollaboration } from '../../middleware/load-actor.js';
import {
  findOrganizationStatus,
  runInTransaction,
} from '../organization/organization.repository.js';
import { atLeast } from '../../shared/access/roles.js';
import type { Actor } from '../../types/express.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  countNegotiatedPricesBefore,
  findLiveCustomerPriceId,
  findSupplierRelationshipForPrice,
  getProductOfOrganization,
  insertProduct,
  listCatalogForCustomer,
  listCustomerPricesOfRelationship,
  listProductsOfOrganization,
  softDeleteCustomerPrice,
  updateProduct,
  upsertCustomerPrice,
  type SupplierRelationshipForPrice,
} from './catalog.repository.js';
import type {
  BrowseQuery,
  CatalogPage,
  CreateProductInput,
  CustomerPricePage,
  CustomerPriceView,
  EditProductInput,
  ListCustomerPricesQuery,
  ListProductsQuery,
  ProductPage,
  ProductView,
  SetCustomerPriceInput,
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

const PRICE_CHANGED_CONTENT = {
  FR: (article: string) => `Votre prix negocie pour ${article} a change.`,
  EN: (article: string) => `Your negotiated price for ${article} has changed.`,
};

/**
 * Refuses a gesture on the caller's own record (403 `OWN_RECORD`): the caller is the customer
 * person, or manages the customer organization, owner included. Logged as a security event.
 */
async function refuseOwnRecord(
  actor: Actor,
  relationship: SupplierRelationshipForPrice,
  action: 'create' | 'delete'
): Promise<void> {
  const customerOrganization = relationship.customerOrganizationId;
  const managesCustomer =
    customerOrganization !== null &&
    ['MANAGER', 'OWNER'].includes(
      (await getActiveCollaboration(actor.personId, customerOrganization))?.role ?? ''
    );
  if (relationship.customerPersonId !== actor.personId && !managesCustomer) return;
  logger.warn(
    {
      event: 'own_record_refused',
      personId: actor.personId,
      action,
      subjectType: 'CustomerPrice',
    },
    'Permission refused'
  );
  throw httpError(403, 'OWN_RECORD', 'Not allowed on your own record');
}

/** Notifies a registered customer person `price.negotiated_changed`, in the gesture's transaction. */
async function notifyPriceChanged(
  actor: Actor,
  relationship: SupplierRelationshipForPrice,
  article: string,
  tx: Prisma.TransactionClient
): Promise<void> {
  if (relationship.customerPersonId === null || !relationship.customerPersonRegistered) return;
  const language = await recipientLanguage(relationship.customerPersonId, tx);
  await notify(
    {
      recipientId: relationship.customerPersonId,
      organizationId: actor.organizationId,
      sourceEvent: 'price.negotiated_changed',
      content:
        language === 'EN' ? PRICE_CHANGED_CONTENT.EN(article) : PRICE_CHANGED_CONTENT.FR(article),
      related: { type: 'customer_relationship', id: relationship.id },
    },
    tx
  );
}

/**
 * An owner, or a manager online, sets the negotiated price of one customer for one article.
 *
 * The role is decided by the route (`create CustomerPrice`, ASVS v5.0.0-8.2.1). One transaction
 * then selects the relationship through the visibility predicate and the actor's organization
 * (404 outside it) and the product through the same organization (404 when it is another
 * business's, any status; v5.0.0-8.2.2), and refuses, in order: the caller's own record (403
 * `OWN_RECORD`: the caller is the customer person, or manages the customer organization, owner
 * included) and a relationship that is not ACTIVE (409 `RELATIONSHIP_NOT_ACTIVE`). A live price
 * for the pair is replaced, else one is created (C-11); the author is the caller (C-04) and the
 * time is the server's. A registered customer person is notified `price.negotiated_changed` in
 * the same transaction. A price above the article's price is stored as is.
 *
 * @param actor - Actor loaded from the path.
 * @param relationshipId - Validated relationship id from the path.
 * @param productId - Validated product id from the path.
 * @param input - Validated body: gesture id and the price in XAF.
 * @throws 403 `OWN_RECORD`; 404 `NOT_FOUND`; 409 `RELATIONSHIP_NOT_ACTIVE` or
 * `ORGANIZATION_NOT_ACTIVE`.
 */
export async function setCustomerPrice(
  actor: Actor,
  relationshipId: string,
  productId: string,
  input: SetCustomerPriceInput
): Promise<CustomerPriceView> {
  return runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    const relationship = await findSupplierRelationshipForPrice(
      tx,
      { personId: actor.personId, organizationId: actor.organizationId },
      relationshipId
    );
    if (!relationship) throw httpError(404, 'NOT_FOUND', 'Not found');
    const product = await getProductOfOrganization(tx, actor.organizationId, productId);

    await refuseOwnRecord(actor, relationship, 'create');
    if (relationship.status !== 'ACTIVE') {
      throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'The relationship is not active');
    }

    const saved = await upsertCustomerPrice(tx, {
      id: input.id,
      relationshipId: relationship.id,
      productId: product.id,
      price: BigInt(input.price),
      setById: actor.personId,
    });

    await notifyPriceChanged(actor, relationship, product.name, tx);

    return {
      product_id: saved.productId,
      price: Number(saved.price),
      set_by_id: saved.setById,
      set_at: saved.setAt.toISOString(),
    };
  });
}

/**
 * Lists the live negotiated prices of one customer, flagged when the article price changed
 * since: SELLER and above only.
 *
 * The relationship is selected through the actor's organization, so another business's
 * relationship answers 404 (ASVS v5.0.0-8.2.2). `to_review` is true when the product's
 * `price_updated_at` is later than the price's `set_at`. The view is an explicit field list
 * (v5.0.0-15.3.1).
 *
 * @param actor - Actor loaded from the path.
 * @param relationshipId - Validated relationship id from the path.
 * @param query - Validated page size and cursor.
 * @throws 403 `FORBIDDEN` for a DRIVER; 404 `NOT_FOUND` outside the organization.
 */
export async function listCustomerPrices(
  actor: Actor,
  relationshipId: string,
  query: ListCustomerPricesQuery
): Promise<CustomerPricePage> {
  if (!atLeast(actor.role, 'SELLER')) {
    logger.warn(
      {
        event: 'permission_refused',
        personId: actor.personId,
        action: 'list',
        subjectType: 'CustomerPrice',
      },
      'Permission refused'
    );
    throw httpError(403, 'FORBIDDEN', 'Permission denied');
  }
  const page = await listCustomerPricesOfRelationship(
    { personId: actor.personId, organizationId: actor.organizationId },
    relationshipId,
    query
  );
  if (!page) throw httpError(404, 'NOT_FOUND', 'Not found');
  return {
    items: page.rows.map((row) => ({
      product_id: row.product.id,
      product_name: row.product.name,
      price: Number(row.price),
      product_price: Number(row.product.price),
      set_by_id: row.setById,
      set_at: row.setAt.toISOString(),
      to_review: row.product.priceUpdatedAt.getTime() > row.setAt.getTime(),
    })),
    next_cursor: page.nextCursor,
  };
}

/**
 * An owner, or a manager online, removes one customer's negotiated price for one article.
 *
 * The role is decided by the route (`delete CustomerPrice`, ASVS v5.0.0-8.2.1). One transaction
 * selects the relationship through the actor's organization and the product through the same
 * organization (404 outside it; v5.0.0-8.2.2), refuses the caller's own record (403
 * `OWN_RECORD`), then marks the live price deleted (404 when there is none, so a repeat answers
 * 404). The customer then pays the article price again (C-11). A registered customer person is
 * notified `price.negotiated_changed` in the same transaction. An ENDED relationship may still
 * lose a price: removal only restores the article price.
 *
 * @param actor - Actor loaded from the path.
 * @param relationshipId - Validated relationship id from the path.
 * @param productId - Validated product id from the path.
 * @throws 403 `OWN_RECORD`; 404 `NOT_FOUND`; 409 `ORGANIZATION_NOT_ACTIVE`.
 */
export async function removeCustomerPrice(
  actor: Actor,
  relationshipId: string,
  productId: string
): Promise<void> {
  await runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    const relationship = await findSupplierRelationshipForPrice(
      tx,
      { personId: actor.personId, organizationId: actor.organizationId },
      relationshipId
    );
    if (!relationship) throw httpError(404, 'NOT_FOUND', 'Not found');
    const product = await getProductOfOrganization(tx, actor.organizationId, productId);
    await refuseOwnRecord(actor, relationship, 'delete');

    const priceId = await findLiveCustomerPriceId(tx, relationship.id, product.id);
    if (!priceId || !(await softDeleteCustomerPrice(tx, priceId))) {
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }
    await notifyPriceChanged(actor, relationship, product.name, tx);
  });
}
