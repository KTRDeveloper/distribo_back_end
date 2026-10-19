import type { Prisma, Product, ProductVariant } from '@prisma/client';
import { imageUrl } from '../../lib/image-keys.js';
import { simplifyText, variantLabel } from '../../shared/variant.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { assertOrganizationActive, getActiveCollaboration } from '../../middleware/load-actor.js';
import {
  findOrganizationStatus,
  readPlanFields,
  runInTransaction,
} from '../organization/organization.repository.js';
import { newId } from '../../shared/ids.js';
import { atLeast } from '../../shared/access/roles.js';
import type { Actor } from '../../types/express.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  countProductsOnSale,
  countVariantNegotiatedPricesBefore,
  findLiveCustomerPriceId,
  findUsedVariantIds,
  findLiveTwin,
  findVariantAnyState,
  findLiveVariantByText,
  findSupplierRelationshipForPrice,
  getProductCopyableBy,
  getProductOfOrganization,
  insertActiveVariant,
  insertProduct,
  insertProductForVariants,
  listCatalogForCustomer,
  listCustomerPricesOfRelationship,
  listLiveVariantsOfProduct,
  listLiveCustomerPricesForCopy,
  listProductsOfOrganization,
  lockLiveVariantsOfProduct,
  lockProductOfOrganizationAnyState,
  patchVariant,
  softDeleteProduct,
  softDeleteVariants,
  softDeleteCustomerPrice,
  updateProduct,
  upsertCustomerPrice,
  type SupplierRelationshipForPrice,
} from './catalog.repository.js';
import type {
  BrowseQuery,
  CopyCustomerPricesInput,
  CopyProductInput,
  CopyCustomerPricesView,
  CatalogPage,
  CreateProductInput,
  CustomerPricePage,
  CustomerPriceView,
  EditProductInput,
  EditVariantInput,
  EditedVariantView,
  FlatProductView,
  ListCustomerPricesQuery,
  ListProductsQuery,
  ProductPage,
  ProductView,
  SetCustomerPriceInput,
  VariantInput,
  VariantView,
} from './catalog.schemas.js';

/** Builds the closed flat product view from an explicit field list. */
function toFlatProductView(product: Product): FlatProductView {
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

/** Tells whether the database refused a row as a duplicate (PostgreSQL 23505, Prisma P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

/** Composes the closed variant view; `label` and the photo addresses are built here. */
function toVariantView(productName: string, variant: ProductVariant): VariantView {
  return {
    id: variant.id,
    name: variant.name,
    unit: variant.unit,
    label: variantLabel(productName, variant.name, variant.unit),
    price: Number(variant.price),
    price_updated_at: variant.priceUpdatedAt.toISOString(),
    min_order_quantity: variant.minOrderQuantity?.toString() ?? null,
    image_urls: variant.imageKeys.map((key) => imageUrl(key)!),
    status: variant.status,
  };
}

/** Composes the closed product view with its variants; the photo addresses are built here. */
function toProductView(product: Product, variants: ProductVariant[]): ProductView {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    image_urls: product.imageKeys.map((key) => imageUrl(key)!),
    paused: product.pausedAt !== null,
    variants: variants.map((variant) => toVariantView(product.name, variant)),
  };
}

/**
 * Creates an ACTIVE product with its variants in the actor's organization.
 *
 * The role is decided by the route (`create Product` in the rules table, ASVS v5.0.0-8.2.1);
 * the organization comes from the loaded actor, never from the body. One transaction checks that
 * the organization is ACTIVE, refuses two variants of the body that share a simplified name and
 * unit (C-47), checks the plan's room for one more product (C-46), writes the product with an
 * empty unit (CAT-014: the code writes the variants) and then each variant, ACTIVE, in the order
 * sent. Status, photos, pause date and `price_updated_at` are set by the server (C-13). A twin
 * the database still refuses (a race, a different case folding) is mapped to the same 409.
 *
 * @param actor - Actor loaded from the path.
 * @param input - Validated body.
 * @throws 409 `ORGANIZATION_NOT_ACTIVE`, `VARIANT_EXISTS` or `PRODUCT_LIMIT_REACHED`; 404
 * `NOT_FOUND` when the organization vanished.
 */
export async function createProduct(actor: Actor, input: CreateProductInput): Promise<ProductView> {
  return runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    const seen = new Set<string>();
    for (const variant of input.variants) {
      const key = JSON.stringify([simplifyText(variant.name ?? null), simplifyText(variant.unit)]);
      if (seen.has(key)) throw httpError(409, 'VARIANT_EXISTS', 'Two variants are the same');
      seen.add(key);
    }
    await assertRoomForProduct(tx, actor.organizationId);
    const product = await insertProductForVariants(tx, {
      id: input.id,
      organizationId: actor.organizationId,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
    });
    const variants: VariantView[] = [];
    for (const variant of input.variants) {
      try {
        const row = await insertActiveVariant(tx, {
          id: variant.id,
          productId: product.id,
          organizationId: actor.organizationId,
          name: variant.name ?? null,
          unit: variant.unit,
          price: BigInt(variant.price),
          minOrderQuantity: variant.min_order_quantity ?? null,
        });
        variants.push(toVariantView(product.name, row));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw httpError(409, 'VARIANT_EXISTS', 'Two variants are the same');
        }
        throw error;
      }
    }
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      category: product.category,
      image_urls: product.imageKeys.map((key) => imageUrl(key)!),
      paused: product.pausedAt !== null,
      variants,
    };
  });
}

/**
 * Adds an ACTIVE variant to a product of the actor's organization.
 *
 * The role is decided by the route (`create ProductVariant`, ASVS v5.0.0-8.2.1); the product is
 * selected by id and organization together, so another business's or a deleted product is a 404
 * (v5.0.0-8.2.2). One transaction checks that the organization is ACTIVE, refuses a live variant
 * of the product with the same simplified name and unit (C-47) and, when the product is not
 * paused and has no ACTIVE variant yet, checks the plan's room because the new variant puts it
 * back on sale (C-46). A paused product accepts the variant and stays paused. Status and
 * `price_updated_at` are the server's (C-13). A twin the database still refuses (a race) is
 * mapped to the same 409.
 *
 * @param actor - Actor loaded from the path.
 * @param productId - Validated product id from the path.
 * @param input - Validated body.
 * @throws 404 `NOT_FOUND`; 409 `ORGANIZATION_NOT_ACTIVE`, `VARIANT_EXISTS` or
 * `PRODUCT_LIMIT_REACHED`.
 */
export async function addVariant(
  actor: Actor,
  productId: string,
  input: VariantInput
): Promise<VariantView> {
  return runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    const product = await getProductOfOrganization(tx, actor.organizationId, productId);
    if (await findLiveVariantByText(tx, product.id, input.name, input.unit)) {
      throw httpError(409, 'VARIANT_EXISTS', 'A variant with this name and unit exists');
    }
    if (product.pausedAt === null) {
      const variants = await listLiveVariantsOfProduct(tx, product.id);
      if (!variants.some((variant) => variant.status === 'ACTIVE')) {
        await assertRoomForProduct(tx, actor.organizationId);
      }
    }
    try {
      const row = await insertActiveVariant(tx, {
        id: input.id,
        productId: product.id,
        organizationId: actor.organizationId,
        name: input.name ?? null,
        unit: input.unit,
        price: BigInt(input.price),
        minOrderQuantity: input.min_order_quantity ?? null,
      });
      return toVariantView(product.name, row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw httpError(409, 'VARIANT_EXISTS', 'A variant with this name and unit exists');
      }
      throw error;
    }
  });
}

/**
 * Changes the name, unit, price, minimum quantity or status of a variant of the actor's business.
 *
 * The role is decided by the route (`update ProductVariant`, ASVS v5.0.0-8.2.1). The product is
 * selected by id and organization, then the variant is locked and must belong to that product and
 * organization and not be deleted, else 404 (v5.0.0-8.2.2). One transaction refuses a name and
 * unit that equal another live variant's (C-47, the unique index is the fallback for a race) and,
 * when an INACTIVE variant goes back to ACTIVE on an unpaused product with no other ACTIVE
 * variant, checks the plan's room (C-46). `price_updated_at` is moved by the database on a real
 * price change only (C-13); the count of live negotiated prices of this variant older than it
 * is then returned, else 0.
 *
 * @param actor - Actor loaded from the path.
 * @param productId - Validated product id from the path.
 * @param variantId - Validated variant id from the path.
 * @param input - Validated body, at least one field.
 * @throws 404 `NOT_FOUND`; 409 `ORGANIZATION_NOT_ACTIVE`, `VARIANT_EXISTS` or
 * `PRODUCT_LIMIT_REACHED`.
 */
export async function editVariant(
  actor: Actor,
  productId: string,
  variantId: string,
  input: EditVariantInput
): Promise<EditedVariantView> {
  return runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    const product = await getProductOfOrganization(tx, actor.organizationId, productId);
    const before = await findVariantAnyState(tx, variantId);
    if (
      !before ||
      before.productId !== product.id ||
      before.organizationId !== actor.organizationId ||
      before.deletedAt !== null
    ) {
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }

    if (input.name !== undefined || input.unit !== undefined) {
      const name = input.name === undefined ? before.name : input.name;
      const unit = input.unit ?? before.unit;
      if (await findLiveTwin(tx, product.id, name, unit, before.id)) {
        throw httpError(409, 'VARIANT_EXISTS', 'A variant with this name and unit exists');
      }
    }

    if (input.status === 'ACTIVE' && before.status === 'INACTIVE' && product.pausedAt === null) {
      const variants = await listLiveVariantsOfProduct(tx, product.id);
      if (!variants.some((variant) => variant.id !== before.id && variant.status === 'ACTIVE')) {
        await assertRoomForProduct(tx, actor.organizationId);
      }
    }

    let row: ProductVariant;
    try {
      row = await patchVariant(tx, before.id, {
        name: input.name,
        unit: input.unit,
        price: input.price === undefined ? undefined : BigInt(input.price),
        minOrderQuantity: input.min_order_quantity,
        status: input.status,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw httpError(409, 'VARIANT_EXISTS', 'A variant with this name and unit exists');
      }
      throw error;
    }
    const priceChanged = row.price !== before.price;
    return {
      ...toVariantView(product.name, row),
      negotiated_prices_to_review: priceChanged
        ? await countVariantNegotiatedPricesBefore(tx, row.id, row.priceUpdatedAt)
        : 0,
    };
  });
}

/**
 * Deletes a variant of the actor's organization (soft delete), unless a sale cites it or it is the
 * product's last live variant.
 *
 * The role is decided by the route (`delete ProductVariant`, ASVS v5.0.0-8.2.1). One transaction
 * (v5.0.0-2.3.3) locks the variant and its product, selected by id and organization together (404
 * outside them; v5.0.0-8.2.2), so two deletions of one product's variants run one after the
 * other and cannot both take the last two. A variant already deleted answers success without a
 * change. A variant cited by an order line or a live negotiated price is refused (C-48): it can
 * only be taken off sale (CAT-025). The last live variant is refused too (C-45): delete the
 * product. The citation is judged first, as it is the stronger rule and the way out differs.
 *
 * @param actor - Actor loaded from the path.
 * @param productId - Validated product id from the path.
 * @param variantId - Validated variant id from the path.
 * @throws 404 `NOT_FOUND`; 409 `ORGANIZATION_NOT_ACTIVE`, `VARIANT_IN_USE` or `LAST_VARIANT`.
 */
export async function deleteVariant(
  actor: Actor,
  productId: string,
  variantId: string
): Promise<void> {
  await runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    const variant = await findVariantAnyState(tx, variantId);
    if (
      !variant ||
      variant.productId !== productId ||
      variant.organizationId !== actor.organizationId
    ) {
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }
    const product = await lockProductOfOrganizationAnyState(tx, actor.organizationId, productId);
    if (!product) throw httpError(404, 'NOT_FOUND', 'Not found');
    if (variant.deletedAt !== null) return;

    if ((await findUsedVariantIds(tx, [variant.id])).size > 0) {
      throw httpError(409, 'VARIANT_IN_USE', 'The variant is used by a sale or a negotiated price');
    }
    const siblings = await listLiveVariantsOfProduct(tx, product.id);
    if (!siblings.some((sibling) => sibling.id !== variant.id)) {
      throw httpError(409, 'LAST_VARIANT', 'A product keeps at least one variant');
    }
    await softDeleteVariants(tx, [variant.id], new Date());
  });
}

/**
 * Deletes a product of the actor's organization with all its live variants (soft delete), unless
 * a sale cites one of them.
 *
 * The role is decided by the route (`delete Product`, ASVS v5.0.0-8.2.1). One transaction
 * (v5.0.0-2.3.3) locks the variants then the product, selected by id and organization together
 * (404 outside them; v5.0.0-8.2.2). A product already deleted answers success without a change.
 * One variant cited by an order line or a live negotiated price refuses the whole product (409
 * `VARIANT_IN_USE`, C-48) and nothing is deleted: the sales history keeps its articles.
 *
 * @param actor - Actor loaded from the path.
 * @param productId - Validated product id from the path.
 * @throws 404 `NOT_FOUND`; 409 `ORGANIZATION_NOT_ACTIVE` or `VARIANT_IN_USE`.
 */
export async function deleteProduct(actor: Actor, productId: string): Promise<void> {
  await runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    await lockLiveVariantsOfProduct(tx, actor.organizationId, productId);
    const product = await lockProductOfOrganizationAnyState(tx, actor.organizationId, productId);
    if (!product) throw httpError(404, 'NOT_FOUND', 'Not found');
    if (product.deletedAt !== null) return;

    const variantIds = (await listLiveVariantsOfProduct(tx, product.id)).map(({ id }) => id);
    if ((await findUsedVariantIds(tx, variantIds)).size > 0) {
      throw httpError(409, 'VARIANT_IN_USE', 'A variant is used by a sale or a negotiated price');
    }
    const now = new Date();
    await softDeleteVariants(tx, variantIds, now);
    await softDeleteProduct(tx, product.id, now);
  });
}

/**
 * Copies an article the actor's organization buys into its own catalog, at its own price.
 *
 * The role is decided by the route (`create Product`, ASVS v5.0.0-8.2.1). One transaction checks
 * that the organization is ACTIVE, then reads the source only through a live ACTIVE relationship
 * where the actor's organization is the customer (404 otherwise, so a competitor's article is
 * never confirmed; v5.0.0-8.2.2). The copy takes name, unit, description and category, keeps no
 * link to the source and does not take its minimum order quantity. Status and `price_updated_at`
 * are set by the server (C-13).
 *
 * @param actor - Actor loaded from the path.
 * @param input - Validated body: gesture id, source article, caller's price in XAF.
 * @throws 404 `NOT_FOUND`; 409 `ORGANIZATION_NOT_ACTIVE`.
 */
export async function copyProduct(actor: Actor, input: CopyProductInput): Promise<FlatProductView> {
  return runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    const source = await getProductCopyableBy(tx, actor.organizationId, input.source_product_id);
    const product = await insertProduct(tx, {
      id: input.id,
      organizationId: actor.organizationId,
      name: source.name,
      unit: source.unit,
      price: BigInt(input.price),
      minOrderQuantity: null,
      description: source.description,
      category: source.category,
    });
    return toFlatProductView(product);
  });
}

/**
 * Edits the name, description and category of a product of the actor's organization.
 *
 * The role is decided by the route (`update Product`, ASVS v5.0.0-8.2.1); the product is
 * selected by id and organization together, so another business's product is a 404
 * (v5.0.0-8.2.2). A paused product can be edited. Unit, price, minimum quantity and status are
 * not accepted: they belong to the variants (CAT-025). The answer is the product with its live
 * variants.
 *
 * @param actor - Actor loaded from the path.
 * @param productId - Product from the path.
 * @param input - Validated body, at least one field; `null` clears description or category.
 * @throws 404 `NOT_FOUND` when the product is absent, deleted or another organization's.
 */
export async function editProduct(
  actor: Actor,
  productId: string,
  input: EditProductInput
): Promise<ProductView> {
  return runInTransaction(async (tx) => {
    const before = await getProductOfOrganization(tx, actor.organizationId, productId);
    const product = await updateProduct(tx, before.id, {
      name: input.name,
      description: input.description,
      category: input.category,
    });
    const variants = await listLiveVariantsOfProduct(tx, product.id);
    return toProductView(product, variants);
  });
}

/**
 * Lists the actor's organization products with their variants, newest first: SELLER and above
 * only.
 *
 * The organization comes from the loaded actor, never from the query (ASVS v5.0.0-8.2.2), and
 * the view is built from an explicit field list (v5.0.0-15.3.1). Deleted products and variants are
 * left out; withdrawn (INACTIVE) variants are kept so the seller sees every size.
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
  return {
    items: rows.map(({ product, variants }) => toProductView(product, variants)),
    next_cursor: nextCursor,
  };
}

/**
 * A customer browses a business's catalog by product and variant, with their own prices (CM-11).
 *
 * Lists the products not deleted and not paused that have at least one ACTIVE, not deleted
 * variant, newest first, each with those variants only, oldest first; pages are of products.
 * Any signed-in person may browse an ACTIVE organization; a CLOSED, SUSPENDED or unknown one is
 * a 404. With `as_organization_id` the customer is that organization: the caller must be its
 * ACTIVE MANAGER or OWNER, else 404 so the organization is never confirmed (ASVS v5.0.0-8.2.2).
 * The negotiated price of a variant comes only from the caller's own live relationship with this
 * supplier (the organization's with `as_organization_id`); the view lists only customer-safe fields
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
    items: rows.map(({ product, variants }) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      category: product.category,
      image_urls: product.imageKeys.map((key) => imageUrl(key)!),
      variants: variants.map(({ variant, negotiatedPrice }) => ({
        id: variant.id,
        name: variant.name,
        unit: variant.unit,
        label: variantLabel(product.name, variant.name, variant.unit),
        price: Number(negotiatedPrice ?? variant.price),
        min_order_quantity: variant.minOrderQuantity?.toString() ?? null,
        price_is_negotiated: negotiatedPrice !== null,
        image_urls: variant.imageKeys.map((key) => imageUrl(key)!),
      })),
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
  action: 'create' | 'delete' | 'copy'
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

/**
 * An owner, or a manager online, copies one customer's negotiated prices onto another.
 *
 * The role is decided by the route (`create CustomerPrice`, ASVS v5.0.0-8.2.1). One transaction
 * (v5.0.0-2.3.3) selects both relationships through the actor's organization (404 outside it,
 * or for a PENDING one; v5.0.0-8.2.2), refuses the same relationship twice (400) and the
 * caller's own record as target (403 `OWN_RECORD`), then upserts each live source price onto
 * the target: an existing live target price is replaced (C-11) and the author is the caller
 * (C-04). The source is read only. Any failing row aborts the whole copy. The relationships
 * are locked in id order so two opposite copies cannot deadlock.
 *
 * @param actor - Actor loaded from the path.
 * @param targetRelationshipId - Validated relationship id from the path.
 * @param input - Validated body: gesture id and the source relationship.
 * @returns The number of prices copied.
 * @throws 400 `VALIDATION_ERROR`; 403 `OWN_RECORD`; 404 `NOT_FOUND`; 409
 * `ORGANIZATION_NOT_ACTIVE`.
 */
export async function copyCustomerPrices(
  actor: Actor,
  targetRelationshipId: string,
  input: CopyCustomerPricesInput
): Promise<CopyCustomerPricesView> {
  if (input.from_relationship_id === targetRelationshipId) {
    throw httpError(400, 'VALIDATION_ERROR', 'Source and target must differ');
  }
  return runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    const viewer = { personId: actor.personId, organizationId: actor.organizationId };
    const [firstId, secondId] = [input.from_relationship_id, targetRelationshipId].sort();
    const first = await findSupplierRelationshipForPrice(tx, viewer, firstId);
    const second = await findSupplierRelationshipForPrice(tx, viewer, secondId);
    const source = firstId === input.from_relationship_id ? first : second;
    const target = firstId === input.from_relationship_id ? second : first;
    if (!source || !target || source.status === 'PENDING' || target.status === 'PENDING') {
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }
    await refuseOwnRecord(actor, target, 'copy');

    const prices = await listLiveCustomerPricesForCopy(tx, source.id);
    for (const price of prices) {
      await upsertCustomerPrice(tx, {
        id: newId(),
        relationshipId: target.id,
        productId: price.productId,
        price: price.price,
        setById: actor.personId,
      });
    }
    return { copied: prices.length };
  });
}

/**
 * Refuses a new product on sale when the plan's product limit is reached (C-46). Online routes
 * that add a product to the sale (create, add a variant, put back on sale, copy) call it in their
 * transaction; what arrives by synchronization is never refused here, it is paused afterwards.
 *
 * The limit is read from the plan on the server, never from the request (ASVS v5.0.0-2.3.2); a
 * `max_products` of null means no limit.
 *
 * @param tx - The caller's transaction.
 * @param organizationId - The business, from the loaded actor.
 * @throws 409 `PRODUCT_LIMIT_REACHED` when the count has reached the limit; 404 `NOT_FOUND` when
 *   the business is absent or deleted (fail closed).
 */
export async function assertRoomForProduct(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<void> {
  const plan = await readPlanFields(tx, organizationId);
  if (plan === null) throw httpError(404, 'NOT_FOUND', 'Not found');
  if (plan.maxProducts === null) return;
  const onSale = await countProductsOnSale(tx, organizationId);
  if (onSale >= plan.maxProducts) {
    throw httpError(409, 'PRODUCT_LIMIT_REACHED', 'The product limit of the plan is reached');
  }
}
