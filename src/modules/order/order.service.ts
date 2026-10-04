import type { Prisma } from '@prisma/client';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { httpError } from '../../lib/http-error.js';
import { parseQuantity } from '../../shared/money.js';
import { getActiveProduct, getReferencePrice } from '../catalog/catalog.repository.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import { ensureCustomerRelationship } from '../relationship/relationship.repository.js';
import { lineAmountOf, orderTotal } from './order.calculations.js';
import {
  insertPendingOrder,
  listOrderTeamIds,
  runInTransaction,
  type NewOrderLine,
} from './order.repository.js';
import type { PlaceOrderInput } from './order.schemas.js';
import { projectOrderForCustomer, type CustomerOrderView } from './order.views.js';

const PLACED_CONTENT = {
  FR: 'Nouvelle commande reçue.',
  EN: 'New order received.',
} as const;

/**
 * Prices one requested line from the catalog (C-15): the product must be an ACTIVE product of the
 * supplier (404 otherwise), the quantity must reach its minimum (400), and the reference price is
 * read from the database, never from the request (ASVS v5.0.0-2.2.1). The applied price equals the
 * reference price: a customer never negotiates at order time.
 */
async function priceLine(
  tx: Prisma.TransactionClient,
  supplierOrganizationId: string,
  relationshipId: string,
  line: PlaceOrderInput['lines'][number]
): Promise<NewOrderLine & { quantityMilli: bigint }> {
  const product = await getActiveProduct(tx, supplierOrganizationId, line.product_id);
  const quantityMilli = parseQuantity(line.quantity);
  if (
    product.minOrderQuantity !== null &&
    quantityMilli < parseQuantity(product.minOrderQuantity.toFixed(3))
  ) {
    throw httpError(400, 'VALIDATION_ERROR', 'Quantity is below the minimum order quantity');
  }
  const { price } = await getReferencePrice(tx, relationshipId, product.id);
  return {
    id: line.id,
    productId: product.id,
    labelApplied: `${product.name} (${product.unit})`,
    quantity: line.quantity,
    quantityMilli,
    referencePrice: price,
    unitPriceApplied: price,
    amount: lineAmountOf({ quantityMilli, unitPriceApplied: price }),
  };
}

/** Tells the supplier's OWNER, MANAGERs and SELLERs, each in their language (`order.placed`). */
async function notifyTeam(
  tx: Prisma.TransactionClient,
  supplierOrganizationId: string,
  orderId: string
): Promise<void> {
  for (const recipientId of await listOrderTeamIds(tx, supplierOrganizationId)) {
    const language = await recipientLanguage(recipientId, tx);
    await notify(
      {
        recipientId,
        organizationId: supplierOrganizationId,
        sourceEvent: 'order.placed',
        content: language === 'EN' ? PLACED_CONTENT.EN : PLACED_CONTENT.FR,
        related: { type: 'order', id: orderId },
      },
      tx
    );
  }
}

/**
 * Shared body of the two place-order gestures. The customer side of the relationship is the
 * calling organization when `customer.organizationId` is set, else the calling person; the
 * person who enters the order is always `customer.personId`.
 */
function placeOrderFor(
  customer: { personId: string; organizationId?: string },
  input: PlaceOrderInput
): Promise<CustomerOrderView> {
  return runInTransaction(async (tx) => {
    if (customer.organizationId !== undefined) {
      await assertOrganizationActive(customer.organizationId, tx);
    }
    await assertOrganizationActive(input.supplier_organization_id, tx);

    const { relationship } = await ensureCustomerRelationship(
      tx,
      customer.organizationId !== undefined
        ? {
            supplierOrganizationId: input.supplier_organization_id,
            customerOrganizationId: customer.organizationId,
            createdById: customer.personId,
          }
        : {
            supplierOrganizationId: input.supplier_organization_id,
            customerPersonId: customer.personId,
            createdById: customer.personId,
          }
    );
    if (relationship.status !== 'ACTIVE') {
      throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'Relationship is not active');
    }

    const priced: Awaited<ReturnType<typeof priceLine>>[] = [];
    for (const line of input.lines) {
      priced.push(await priceLine(tx, input.supplier_organization_id, relationship.id, line));
    }

    const order = await insertPendingOrder(tx, {
      id: input.id,
      customerRelationshipId: relationship.id,
      enteredById: customer.personId,
      deliveryAddressApplied: input.delivery_address ?? relationship.deliveryAddress,
      desiredDeliveryDate: input.desired_delivery_date
        ? new Date(`${input.desired_delivery_date}T00:00:00.000Z`)
        : null,
      customerNote: input.customer_note ?? null,
      totalAmount: orderTotal(
        priced.map((line) => line.amount),
        0n
      ),
      lines: priced.map(({ quantityMilli: _milli, ...line }) => line),
    });

    await notifyTeam(tx, input.supplier_organization_id, order.id);

    // Lines come back in the request order, so the answer mirrors what was sent.
    const position = new Map(input.lines.map((line, index) => [line.id, index]));
    order.lines.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
    return projectOrderForCustomer(order);
  });
}

/**
 * A customer places an order with a business (CM-11): a PENDING order whose prices, labels,
 * amounts and total are all computed on the server. Relationship, order, lines and notifications
 * are one transaction (ASVS v5.0.0-2.3.3); any refusal stores nothing.
 *
 * The customer is the caller, never a field of the body (v5.0.0-8.2.2). The relationship is found
 * or created ACTIVE with credit limit 0; it must be ACTIVE (C-14), as must the supplier
 * organization. Replays with the same `id` are answered by the `idempotent()` middleware.
 *
 * @param customer - The caller, from the session.
 * @param input - Validated body: ids, optional address, date and note, and 1 to 100 lines.
 * @throws 404 `NOT_FOUND` (business or product); 409 `ORGANIZATION_NOT_ACTIVE`;
 * 409 `RELATIONSHIP_NOT_ACTIVE`; 400 `VALIDATION_ERROR` (quantity below the minimum).
 */
export function placeOrder(
  customer: { personId: string },
  input: PlaceOrderInput
): Promise<CustomerOrderView> {
  return placeOrderFor({ personId: customer.personId }, input);
}

/**
 * A MANAGER or OWNER orders on behalf of their business (ORD-010): same rules, prices and
 * notifications as `placeOrder`, but the customer of the relationship is the calling organization,
 * never the manager's personal relationship. The route has already checked the
 * `order_from_supplier` rule. The organization comes from the loaded actor (v5.0.0-8.2.2); the
 * supplier must be another organization and the calling organization must be ACTIVE.
 *
 * @param actor - Person and organization from `loadActor`.
 * @param input - Same validated body as `placeOrder`.
 * @throws 400 `VALIDATION_ERROR` when the supplier is the calling organization; 409
 * `ORGANIZATION_NOT_ACTIVE` when the calling organization is not ACTIVE; otherwise the errors of
 * `placeOrder`.
 */
export function placePurchase(
  actor: { personId: string; organizationId: string },
  input: PlaceOrderInput
): Promise<CustomerOrderView> {
  if (input.supplier_organization_id === actor.organizationId) {
    return Promise.reject(
      httpError(400, 'VALIDATION_ERROR', 'An organization cannot order from itself')
    );
  }
  return placeOrderFor({ personId: actor.personId, organizationId: actor.organizationId }, input);
}
