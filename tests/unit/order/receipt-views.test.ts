import { describe, expect, it } from 'vitest';
import type { Order, OrderLine } from '@prisma/client';
import {
  projectOrderForCustomer,
  projectOrderForSupplier,
} from '../../../src/modules/order/order.views.js';
import { generateOpenApiDocument } from '../../../src/lib/openapi/generator.js';
import '../../../src/modules/order/order.openapi.js';

const ID = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function order(overrides: Partial<Order> = {}): Order & { lines: OrderLine[] } {
  return {
    id: ID(1),
    customerRelationshipId: ID(2),
    placedByParty: 'CUSTOMER',
    enteredById: ID(31),
    deliveryAddressApplied: 'Douala',
    receptionMode: 'DELIVERY',
    totalAmount: 23000n,
    deliveryCost: 3000n,
    status: 'DELIVERED',
    deliveredAt: new Date('2026-10-05T10:00:00Z'),
    deliveredById: ID(32),
    acceptedAt: null,
    createdAt: new Date('2026-10-04T09:00:00Z'),
    desiredDeliveryDate: null,
    cancelledByParty: null,
    cancelledById: null,
    cancelledAt: null,
    cancellationReason: null,
    parentOrderId: null,
    replacedByOrderId: null,
    customerNote: null,
    supplierNote: null,
    supplierNameApplied: 'Dépôt Test',
    customerNameApplied: 'Boutique Test',
    collectedApplied: 5000n,
    balanceAfterApplied: 10500n,
    syncIssue: null,
    serverUpdatedAt: new Date('2026-10-05T10:00:00Z'),
    deletedAt: null,
    lines: [],
    ...overrides,
  } as Order & { lines: OrderLine[] };
}

type ResponseSchema = { properties: Record<string, { readOnly?: boolean }> };
type ResponseContent = { content: Record<string, { schema: ResponseSchema }> };

const FIELDS = [
  'supplier_name_applied',
  'customer_name_applied',
  'collected_applied',
  'balance_after_applied',
];

describe('receipt fields on the order views (ORD-041)', () => {
  it('customer view carries the four frozen values (AC-1)', () => {
    expect(projectOrderForCustomer(order())).toMatchObject({
      supplier_name_applied: 'Dépôt Test',
      customer_name_applied: 'Boutique Test',
      collected_applied: 5000,
      balance_after_applied: 10500,
    });
  });

  it.each([
    ['OWNER', 10500],
    ['MANAGER', 10500],
    ['SELLER', 10500],
  ] as const)('supplier view shows the debt after delivery to %s (AC-2)', (role, shown) => {
    const view = projectOrderForSupplier(order(), role);
    expect(view.balance_after_applied).toBe(shown);
    expect(view).toMatchObject({
      supplier_name_applied: 'Dépôt Test',
      customer_name_applied: 'Boutique Test',
      collected_applied: 5000,
    });
  });

  it('supplier view hides the debt from a DRIVER but keeps the other three (AC-2)', () => {
    const view = projectOrderForSupplier(order(), 'DRIVER');
    expect(view).not.toHaveProperty('balance_after_applied');
    expect(view).toMatchObject({ collected_applied: 5000, supplier_name_applied: 'Dépôt Test' });
  });

  it('gives four nulls before delivery (AC-3)', () => {
    const pending = order({
      status: 'PENDING',
      supplierNameApplied: null,
      customerNameApplied: null,
      collectedApplied: null,
      balanceAfterApplied: null,
    });
    const customer = projectOrderForCustomer(pending);
    const supplier = projectOrderForSupplier(pending, 'OWNER');
    for (const key of FIELDS) {
      expect(customer).toHaveProperty(key, null);
      expect(supplier).toHaveProperty(key, null);
    }
  });

  it('documents the four fields in both view schemas (AC-4)', () => {
    const doc = generateOpenApiDocument();
    const schemaOf = (path: string): ResponseSchema =>
      (doc.paths as Record<string, { post: { responses: Record<string, ResponseContent> } }>)[path]
        .post.responses[path.endsWith('/orders') ? '201' : '200'].content['application/json']
        .schema;
    const customerSchema = schemaOf('/api/v1/orders');
    const supplierSchema = schemaOf(
      '/api/v1/organizations/{organizationId}/orders/{orderId}/accept'
    );
    for (const schema of [customerSchema, supplierSchema]) {
      for (const key of FIELDS) {
        expect(schema.properties).toHaveProperty(key);
        expect(schema.properties[key].readOnly).toBe(true);
      }
    }
  });

  it.each(['GUEST', 'ADMIN', '', undefined] as const)(
    'withholds the debt from an unexpected role %j (AB-1)',
    (role) => {
      const view = projectOrderForSupplier(order(), role as never);
      expect(view).not.toHaveProperty('balance_after_applied');
      expect(JSON.stringify(view)).not.toContain('10500');
    }
  );
});
