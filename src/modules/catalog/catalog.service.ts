import type { Product } from '@prisma/client';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { runInTransaction } from '../organization/organization.repository.js';
import type { Actor } from '../../types/express.js';
import { insertProduct } from './catalog.repository.js';
import type { CreateProductInput, ProductView } from './catalog.schemas.js';

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
