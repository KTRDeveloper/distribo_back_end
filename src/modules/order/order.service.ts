import type { Prisma } from '@prisma/client';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { httpError } from '../../lib/http-error.js';
import { parseQuantity } from '../../shared/money.js';
import { getActiveProduct, getReferencePrice } from '../catalog/catalog.repository.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  ensureCustomerRelationship,
  findSupplierRelationshipLocked,
} from '../relationship/relationship.repository.js';
import { lineAmountOf, orderTotal } from './order.calculations.js';
import type { Actor } from '../../types/express.js';
import {
  findExistingLineIds,
  findOrderToAccept,
  insertConfirmedOrder,
  insertPendingOrder,
  isRegisteredPerson,
  listOrderTeamIds,
  lockSupplierOrder,
  replaceOrderLines,
  runInTransaction,
  setLinePrice,
  setOrderTotal,
  updateEditableOrderFields,
  updateSupplierNote,
  type NewOrderLine,
} from './order.repository.js';
import type {
  AcceptInput,
  CancelInput,
  EditOrderInput,
  EnterOrderInput,
  PlaceOrderInput,
  RefuseInput,
} from './order.schemas.js';
import { transitionOrder } from './order.state.js';
import {
  projectOrderForCustomer,
  projectOrderForSupplier,
  type CustomerOrderView,
  type SupplierOrderView,
} from './order.views.js';

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

/**
 * Tells the customer an order changed status (`order.status_changed`), in their language. The
 * customer notified is the person of the relationship, or, for a business customer, the person who
 * entered the order; a guest has no account, so nobody is notified.
 */
async function notifyCustomerOfStatus(
  tx: Prisma.TransactionClient,
  order: { id: string; customerPersonId: string | null; enteredById: string },
  supplierOrganizationId: string,
  content: { FR: string; EN: string }
): Promise<void> {
  const recipientId = order.customerPersonId ?? order.enteredById;
  if (!(await isRegisteredPerson(tx, recipientId))) return;
  const language = await recipientLanguage(recipientId, tx);
  await notify(
    {
      recipientId,
      organizationId: supplierOrganizationId,
      sourceEvent: 'order.status_changed',
      content: language === 'EN' ? content.EN : content.FR,
      related: { type: 'order', id: order.id },
    },
    tx
  );
}

const ACCEPTED_CONTENT = {
  FR: 'Votre commande a été acceptée.',
  EN: 'Your order was accepted.',
} as const;

/**
 * The supplier's SELLER, MANAGER or OWNER accepts a PENDING order, lowering prices if agreed
 * (ORD-011, CM-12, CM-16). One transaction (v5.0.0-2.3.3): the order of the caller's organization
 * is locked (an order of another business is 404, v5.0.0-8.2.2), PENDING becomes CONFIRMED by a
 * conditional update (v5.0.0-2.3.1), each listed price is lowered (never raised, never negative),
 * the line amounts and the total are recomputed on the server and the customer is notified
 * `order.status_changed`. Any refusal rolls everything back. Prices are frozen from here: no other
 * gesture changes them.
 *
 * A price equal to the current one changes nothing. The customer notified is the person of the
 * relationship, or, for a business customer, the person who entered the order; a guest has no
 * account, so nobody is notified. Replays with the same `id` are answered by `idempotent()`.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked `accept Order`.
 * @param orderId - Order from the path.
 * @param input - Validated body: gesture id and optional lowered prices.
 * @returns The CONFIRMED order, supplier view for the caller's role.
 * @throws 404 `NOT_FOUND` (order outside the caller's business, or a line of another order);
 * 409 `INVALID_TRANSITION` (not PENDING); 400 `PRICE_INCREASE_REFUSED` (price above the current).
 */
export function acceptOrder(
  actor: Actor,
  orderId: string,
  input: AcceptInput
): Promise<SupplierOrderView> {
  return runInTransaction(async (tx) => {
    if (!(await lockSupplierOrder(tx, orderId, actor.organizationId))) {
      throw httpError(404, 'NOT_FOUND', 'Order not found.');
    }
    await transitionOrder(tx, orderId, 'CONFIRMED', {
      personId: actor.personId,
      party: 'SUPPLIER',
    });

    const order = await findOrderToAccept(tx, orderId);
    if (!order) throw httpError(404, 'NOT_FOUND', 'Order not found.');

    const now = new Date();
    const lines = new Map(order.lines.map((line) => [line.id, line]));
    for (const requested of input.line_prices ?? []) {
      const line = lines.get(requested.line_id);
      if (!line) throw httpError(404, 'NOT_FOUND', 'Order line not found.');
      const price = BigInt(requested.unit_price_applied);
      if (price > line.unitPriceApplied) {
        throw httpError(400, 'PRICE_INCREASE_REFUSED', 'A price cannot be raised at acceptance.');
      }
      if (price === line.unitPriceApplied) continue;
      line.unitPriceApplied = price;
      line.amount = lineAmountOf({
        quantityMilli: parseQuantity(line.quantity.toFixed(3)),
        deliveredQuantityMilli:
          line.deliveredQuantity === null ? null : parseQuantity(line.deliveredQuantity.toFixed(3)),
        unitPriceApplied: price,
      });
      line.priceSetById = actor.personId;
      line.priceSetAt = now;
      await setLinePrice(tx, line.id, {
        unitPriceApplied: price,
        amount: line.amount,
        priceSetById: actor.personId,
        priceSetAt: now,
      });
    }

    if (input.line_prices !== undefined && input.line_prices.length > 0) {
      order.totalAmount = orderTotal(
        order.lines.map((line) => line.amount),
        order.deliveryCost
      );
      await setOrderTotal(tx, orderId, order.totalAmount);
    }

    await notifyCustomerOfStatus(tx, order, actor.organizationId, ACCEPTED_CONTENT);

    return projectOrderForSupplier(order, actor.role);
  });
}

const REFUSED_CONTENT = {
  FR: 'Votre commande a été refusée.',
  EN: 'Your order was refused.',
} as const;

/**
 * The supplier's SELLER, MANAGER or OWNER refuses a PENDING order with a reason (ORD-012, CM-12,
 * C-16). One transaction (v5.0.0-2.3.3): the order of the caller's organization is locked (an
 * order of another business is 404, v5.0.0-8.2.2), PENDING becomes CANCELLED by the conditional
 * update of `transitionOrder` (v5.0.0-2.3.1), which records the SUPPLIER party, the caller, the
 * time and the reason, and the customer is notified `order.status_changed`. Any refusal rolls
 * everything back. Replays with the same `id` are answered by `idempotent()`.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked `refuse Order`.
 * @param orderId - Order from the path.
 * @param input - Validated body: gesture id and the reason (1 to 2000 characters).
 * @returns The CANCELLED order, supplier view for the caller's role.
 * @throws 404 `NOT_FOUND` (order outside the caller's business); 409 `INVALID_TRANSITION`
 * (not PENDING).
 */
export function refuseOrder(
  actor: Actor,
  orderId: string,
  input: RefuseInput
): Promise<SupplierOrderView> {
  return runInTransaction(async (tx) => {
    if (!(await lockSupplierOrder(tx, orderId, actor.organizationId))) {
      throw httpError(404, 'NOT_FOUND', 'Order not found.');
    }
    // Only PENDING can be refused; transitionOrder alone would also let CONFIRMED be cancelled.
    // The row is locked, so this read cannot go stale before the conditional update below.
    const before = await findOrderToAccept(tx, orderId);
    if (!before) throw httpError(404, 'NOT_FOUND', 'Order not found.');
    if (before.status !== 'PENDING') {
      throw httpError(
        409,
        'INVALID_TRANSITION',
        `Order cannot go from ${before.status} to CANCELLED by a refusal.`
      );
    }
    await transitionOrder(
      tx,
      orderId,
      'CANCELLED',
      { personId: actor.personId, party: 'SUPPLIER' },
      { cancellationReason: input.reason }
    );

    const order = await findOrderToAccept(tx, orderId);
    if (!order) throw httpError(404, 'NOT_FOUND', 'Order not found.');

    await notifyCustomerOfStatus(tx, order, actor.organizationId, REFUSED_CONTENT);

    return projectOrderForSupplier(order, actor.role);
  });
}

const CANCELLED_CONTENT = {
  FR: 'Votre commande a été annulée.',
  EN: 'Your order was cancelled.',
} as const;

/**
 * The supplier's SELLER, MANAGER or OWNER cancels a PENDING or CONFIRMED order with a reason before
 * it leaves (ORD-016, CM-12, C-16). One transaction (v5.0.0-2.3.3): the order of the caller's
 * organization is locked (an order of another business is 404, v5.0.0-8.2.2), then the conditional
 * update of `transitionOrder` (v5.0.0-2.3.1) records the SUPPLIER party, the caller, the time and
 * the reason; IN_DELIVERY, DELIVERED and CANCELLED orders answer 409. The customer is notified
 * `order.status_changed`. The supplier note is untouched. Unstarted deliveries are removed by
 * DLV-010. Replays with the same `id` are answered by `idempotent()`.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked `cancel Order`.
 * @param orderId - Order from the path.
 * @param input - Validated body: gesture id and the reason (1 to 2000 characters).
 * @returns The CANCELLED order, supplier view for the caller's role.
 * @throws 404 `NOT_FOUND` (order outside the caller's business); 409 `INVALID_TRANSITION`
 * (IN_DELIVERY, DELIVERED or CANCELLED).
 */
export function cancelOrderAsSupplier(
  actor: Actor,
  orderId: string,
  input: CancelInput
): Promise<SupplierOrderView> {
  return runInTransaction(async (tx) => {
    if (!(await lockSupplierOrder(tx, orderId, actor.organizationId))) {
      throw httpError(404, 'NOT_FOUND', 'Order not found.');
    }
    // CANCELLED comes only from PENDING or CONFIRMED (CM-12), so the state machine settles the rest.
    await transitionOrder(
      tx,
      orderId,
      'CANCELLED',
      { personId: actor.personId, party: 'SUPPLIER' },
      { cancellationReason: input.reason }
    );

    const order = await findOrderToAccept(tx, orderId);
    if (!order) throw httpError(404, 'NOT_FOUND', 'Order not found.');

    await notifyCustomerOfStatus(tx, order, actor.organizationId, CANCELLED_CONTENT);

    return projectOrderForSupplier(order, actor.role);
  });
}

/**
 * Prices one line a seller enters (C-15): the product must be an ACTIVE product of the supplier
 * (404 otherwise) and the reference price comes from the database. The minimum order quantity does
 * not apply to a seller. The applied price defaults to the reference; a different one (any price
 * from 0 up) is a gap whose author is the caller and whose time is `now` (C-20).
 */
async function priceEnteredLine(
  tx: Prisma.TransactionClient,
  actor: Actor,
  relationshipId: string,
  line: EnterOrderInput['lines'][number],
  now: Date
): Promise<NewOrderLine> {
  const product = await getActiveProduct(tx, actor.organizationId, line.product_id);
  const quantityMilli = parseQuantity(line.quantity);
  const { price: referencePrice } = await getReferencePrice(tx, relationshipId, product.id);
  const unitPriceApplied =
    line.unit_price_applied === undefined ? referencePrice : BigInt(line.unit_price_applied);
  return {
    id: line.id,
    productId: product.id,
    labelApplied: `${product.name} (${product.unit})`,
    quantity: line.quantity,
    referencePrice,
    unitPriceApplied,
    amount: lineAmountOf({ quantityMilli, unitPriceApplied }),
    ...(unitPriceApplied === referencePrice
      ? {}
      : { priceSetById: actor.personId, priceSetAt: now }),
  };
}

/**
 * A SELLER, MANAGER or OWNER enters an order for one of the business's customers (ORD-013, C-14,
 * C-15, C-17): the order is CONFIRMED at once, placed by the SUPPLIER party and entered by the
 * caller. One transaction (v5.0.0-2.3.3): the relationship is found through the visibility
 * predicate and locked (another business's relationship is 404, v5.0.0-8.2.1), then every line is
 * priced on the server (v5.0.0-15.3.3); any refusal stores nothing. Replays with the same `id` are
 * answered by `idempotent()`.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked `create Order`.
 * @param input - Validated body: ids, optional address, cost, date and note, and 1 to 100 lines.
 * @returns The CONFIRMED order, supplier view for the caller's role.
 * @throws 404 `NOT_FOUND` (relationship outside the business, product not ACTIVE or not the
 * business's); 409 `USE_COUNTER_SALE` (counter), `RELATIONSHIP_NOT_ACTIVE`,
 * `ORGANIZATION_NOT_ACTIVE`.
 */
export function enterOrder(actor: Actor, input: EnterOrderInput): Promise<SupplierOrderView> {
  return runInTransaction(async (tx) => {
    await assertOrganizationActive(actor.organizationId, tx);
    const relationship = await findSupplierRelationshipLocked(
      tx,
      { personId: actor.personId, organizationId: actor.organizationId },
      input.customer_relationship_id
    );
    if (!relationship) throw httpError(404, 'NOT_FOUND', 'Customer not found.');
    if (relationship.customerPersonId === null && relationship.customerOrganizationId === null) {
      throw httpError(409, 'USE_COUNTER_SALE', 'Use a counter sale for a counter.');
    }
    if (relationship.status !== 'ACTIVE') {
      throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'Relationship is not active');
    }

    const now = new Date();
    const lines: NewOrderLine[] = [];
    for (const line of input.lines) {
      lines.push(await priceEnteredLine(tx, actor, relationship.id, line, now));
    }
    const deliveryCost = BigInt(input.delivery_cost ?? 0);

    const order = await insertConfirmedOrder(tx, {
      id: input.id,
      customerRelationshipId: relationship.id,
      enteredById: actor.personId,
      deliveryAddressApplied: input.delivery_address ?? relationship.deliveryAddress,
      deliveryCost,
      desiredDeliveryDate: input.desired_delivery_date
        ? new Date(`${input.desired_delivery_date}T00:00:00.000Z`)
        : null,
      customerNote: input.customer_note ?? null,
      totalAmount: orderTotal(
        lines.map((line) => line.amount),
        deliveryCost
      ),
      lines,
    });

    // Lines come back in the request order, so the answer mirrors what was sent.
    const position = new Map(input.lines.map((line, index) => [line.id, index]));
    order.lines.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
    return projectOrderForSupplier(order, actor.role);
  });
}

/**
 * A SELLER, MANAGER or OWNER corrects an order the business entered, until it leaves for delivery
 * (ORD-014, C-18). One transaction (v5.0.0-2.3.3): the order of the caller's organization is locked
 * (another business's order is 404, v5.0.0-8.2.1), then its origin and status are checked before
 * any change (v5.0.0-2.3.1): only a CONFIRMED order placed by the SUPPLIER can be edited, anything
 * else is `ORDER_FROZEN`. A `lines` list replaces the old lines (soft-deleted) and is priced as in
 * `enterOrder`; the total is always recomputed from the lines and the delivery cost on the server
 * (v5.0.0-15.3.3). A scalar set to `null` is cleared (a null delivery cost means 0). Replays with
 * the same gesture `id` are answered by `idempotent()`.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked `create Order`.
 * @param orderId - Order from the path.
 * @param input - Validated body: gesture id and at least one editable field.
 * @returns The edited CONFIRMED order, supplier view for the caller's role.
 * @throws 404 `NOT_FOUND` (order outside the business, product not ACTIVE or not the business's);
 * 409 `ORDER_FROZEN`, `ORGANIZATION_NOT_ACTIVE`; 400 `VALIDATION_ERROR` (a line id already used by
 * the order).
 */
export function editOrder(
  actor: Actor,
  orderId: string,
  input: EditOrderInput
): Promise<SupplierOrderView> {
  return runInTransaction(async (tx) => {
    if (!(await lockSupplierOrder(tx, orderId, actor.organizationId))) {
      throw httpError(404, 'NOT_FOUND', 'Order not found.');
    }
    await assertOrganizationActive(actor.organizationId, tx);
    const order = await findOrderToAccept(tx, orderId);
    if (!order) throw httpError(404, 'NOT_FOUND', 'Order not found.');
    if (order.placedByParty !== 'SUPPLIER' || order.status !== 'CONFIRMED') {
      throw httpError(409, 'ORDER_FROZEN', 'This order can no longer be edited.');
    }

    const deliveryCost =
      input.delivery_cost === undefined ? order.deliveryCost : BigInt(input.delivery_cost ?? 0);
    let amounts = order.lines.map((line) => line.amount);
    if (input.lines !== undefined) {
      if (
        (
          await findExistingLineIds(
            tx,
            orderId,
            input.lines.map((line) => line.id)
          )
        ).length > 0
      ) {
        throw httpError(400, 'VALIDATION_ERROR', 'A line id is already used by this order');
      }
      const now = new Date();
      const lines: NewOrderLine[] = [];
      for (const line of input.lines) {
        lines.push(await priceEnteredLine(tx, actor, order.customerRelationshipId, line, now));
      }
      await replaceOrderLines(tx, orderId, lines, now);
      amounts = lines.map((line) => line.amount);
    }

    await updateEditableOrderFields(tx, orderId, {
      ...(input.delivery_address === undefined
        ? {}
        : { deliveryAddressApplied: input.delivery_address }),
      ...(input.delivery_cost === undefined ? {} : { deliveryCost }),
      ...(input.desired_delivery_date === undefined
        ? {}
        : {
            desiredDeliveryDate:
              input.desired_delivery_date === null
                ? null
                : new Date(`${input.desired_delivery_date}T00:00:00.000Z`),
          }),
      ...(input.customer_note === undefined ? {} : { customerNote: input.customer_note }),
      totalAmount: orderTotal(amounts, deliveryCost),
    });

    const edited = await findOrderToAccept(tx, orderId);
    if (!edited) throw httpError(404, 'NOT_FOUND', 'Order not found.');
    if (input.lines !== undefined) {
      // Lines come back in the request order, so the answer mirrors what was sent.
      const position = new Map(input.lines.map((line, index) => [line.id, index]));
      edited.lines.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
    }
    return projectOrderForSupplier(edited, actor.role);
  });
}

/**
 * A seller writes, replaces or clears the note the customer sees on an order, in any status
 * (ORD-015). Only `supplier_note` is written. The order is looked up by the caller's organization
 * under a row lock, so another business's order, or an unknown one, is a 404 (ASVS v5.0.0-8.2.1).
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked `update Order`.
 * @param orderId - Order from the path.
 * @param note - New note, or null to clear it.
 * @returns The order, supplier view for the caller's role.
 * @throws 404 `NOT_FOUND` when the order is not the caller's business's.
 */
export function setSupplierNote(
  actor: Actor,
  orderId: string,
  note: string | null
): Promise<SupplierOrderView> {
  return runInTransaction(async (tx) => {
    if (!(await lockSupplierOrder(tx, orderId, actor.organizationId))) {
      throw httpError(404, 'NOT_FOUND', 'Order not found.');
    }
    await updateSupplierNote(tx, orderId, note);
    const order = await findOrderToAccept(tx, orderId);
    if (!order) throw httpError(404, 'NOT_FOUND', 'Order not found.');
    return projectOrderForSupplier(order, actor.role);
  });
}
