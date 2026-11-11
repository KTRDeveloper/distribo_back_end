import type { Order, OrderLine } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { lineAmountOf, orderTotal } from '../../../src/modules/order/order.calculations.js';
import {
  projectOrderForCustomer,
  projectOrderForSupplier,
} from '../../../src/modules/order/order.views.js';

const ID = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function line(overrides: Partial<OrderLine> = {}): OrderLine {
  return {
    id: ID(10),
    orderId: ID(1),
    productId: ID(20),
    productVariantId: null,
    labelApplied: 'Rice 25kg',
    quantity: new Prisma.Decimal('10'),
    deliveredQuantity: new Prisma.Decimal('8'),
    referencePrice: 3000n,
    unitPriceApplied: 2500n,
    amount: 20000n,
    priceSetById: ID(30),
    priceSetAt: new Date('2026-10-04T10:00:00Z'),
    serverUpdatedAt: new Date('2026-10-04T10:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function order(overrides: Partial<Order> = {}): Order & { lines: OrderLine[] } {
  return {
    id: ID(1),
    customerRelationshipId: ID(2),
    placedByParty: 'CUSTOMER',
    enteredById: ID(31),
    deliveryAddressApplied: 'Douala',
    totalAmount: 23000n,
    deliveryCost: 3000n,
    status: 'CANCELLED',
    deliveredAt: new Date('2026-10-05T10:00:00Z'),
    deliveredById: ID(32),
    acceptedAt: null,
    createdAt: new Date('2026-10-04T09:00:00Z'),
    desiredDeliveryDate: null,
    cancelledByParty: 'SUPPLIER',
    cancelledById: ID(33),
    cancelledAt: new Date('2026-10-06T10:00:00Z'),
    cancellationReason: 'Out of stock',
    parentOrderId: null,
    customerNote: 'Call me',
    supplierNote: 'Fragile',
    syncIssue: 'PRICE_CONFLICT',
    serverUpdatedAt: new Date('2026-10-06T10:00:00Z'),
    deletedAt: null,
    lines: [line()],
    ...overrides,
  };
}

describe('lineAmountOf', () => {
  it.each([
    [2500n, null, 333n, 833n],
    [10000n, 8000n, 3000n, 24000n],
    [1n, null, 500n, 1n],
  ])('quantity %s, delivered %s, price %s gives %s', (q, d, p, amount) => {
    expect(lineAmountOf({ quantityMilli: q, deliveredQuantityMilli: d, unitPriceApplied: p })).toBe(
      amount,
    );
  });

  it('falls back to the ordered quantity when delivered is undefined', () => {
    expect(lineAmountOf({ quantityMilli: 2000n, unitPriceApplied: 100n })).toBe(200n);
  });

  it('uses a delivered quantity of zero rather than the ordered one', () => {
    expect(
      lineAmountOf({ quantityMilli: 2000n, deliveredQuantityMilli: 0n, unitPriceApplied: 100n }),
    ).toBe(0n);
  });
});

describe('orderTotal', () => {
  it('sums amounts and adds the delivery cost', () => {
    expect(orderTotal([15000n, 15000n], 3000n)).toBe(33000n);
  });

  it('is the delivery cost alone for no lines', () => {
    expect(orderTotal([], 3000n)).toBe(3000n);
  });
});

describe('supplier view', () => {
  it('shows the price author only to OWNER and MANAGER', () => {
    const seller = projectOrderForSupplier(order(), 'SELLER');
    const driver = projectOrderForSupplier(order(), 'DRIVER');
    const manager = projectOrderForSupplier(order(), 'MANAGER');
    const owner = projectOrderForSupplier(order(), 'OWNER');
    for (const view of [seller, driver]) {
      expect(view.lines[0]).not.toHaveProperty('price_set_by_id');
      expect(view.lines[0]).not.toHaveProperty('price_set_at');
    }
    for (const view of [manager, owner]) {
      expect(view.lines[0]).toMatchObject({
        price_set_by_id: ID(30),
        price_set_at: '2026-10-04T10:00:00.000Z',
      });
    }
  });

  it('keeps team ids, sync issue and both prices', () => {
    const view = projectOrderForSupplier(order(), 'SELLER');
    expect(view).toMatchObject({
      entered_by_id: ID(31),
      delivered_by_id: ID(32),
      cancelled_by_id: ID(33),
      sync_issue: 'PRICE_CONFLICT',
      total_amount: 23000,
    });
    expect(view.lines[0]).toMatchObject({
      reference_price: 3000,
      unit_price_applied: 2500,
      quantity: '10',
      delivered_quantity: '8',
      amount: 20000,
    });
  });

  it('fails closed on an unknown role', () => {
    const view = projectOrderForSupplier(order(), 'GUEST' as never);
    expect(view.lines[0]).not.toHaveProperty('price_set_by_id');
  });

  it('is JSON serializable', () => {
    expect(() => JSON.stringify(projectOrderForSupplier(order(), 'OWNER'))).not.toThrow();
  });
});

describe('customer view', () => {
  const hidden = ['entered_by_id', 'delivered_by_id', 'cancelled_by_id', 'sync_issue'];

  it('has none of the private fields and shows both prices and the parties', () => {
    const view = projectOrderForCustomer(order());
    for (const key of hidden) expect(view).not.toHaveProperty(key);
    expect(view.lines[0]).not.toHaveProperty('price_set_by_id');
    expect(view.lines[0]).not.toHaveProperty('price_set_at');
    expect(view.lines[0]).toMatchObject({ reference_price: 3000, unit_price_applied: 2500 });
    expect(view).toMatchObject({ placed_by_party: 'CUSTOMER', cancelled_by_party: 'SUPPLIER' });
  });

  it('lists exactly the expected keys', () => {
    expect(Object.keys(projectOrderForCustomer(order())).sort()).toEqual(
      [
        'id',
        'customer_relationship_id',
        'placed_by_party',
        'delivery_address_applied',
        'reception_mode',
        'total_amount',
        'delivery_cost',
        'status',
        'accepted_at',
        'delivered_at',
        'created_at',
        'desired_delivery_date',
        'cancelled_by_party',
        'cancelled_at',
        'cancellation_reason',
        'parent_order_id',
        'customer_note',
        'supplier_note',
        'lines',
      ].sort(),
    );
  });
});

describe('private fields (AB-1)', () => {
  it('never serializes a supplier-team person id or the sync issue to the customer', () => {
    const json = JSON.stringify(projectOrderForCustomer(order()));
    for (const secret of [ID(30), ID(31), ID(32), ID(33), 'PRICE_CONFLICT']) {
      expect(json).not.toContain(secret);
    }
  });
});
