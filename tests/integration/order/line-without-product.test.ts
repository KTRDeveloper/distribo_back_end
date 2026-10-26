import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { seedProduct } from '../../helpers/catalog-fixtures';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const OWNER = '0199c033-0000-7000-8000-000000000001';
const SELLER = '0199c033-0000-7000-8000-000000000002';
const DRIVER = '0199c033-0000-7000-8000-000000000003';
const CUSTOMER = '0199c033-0000-7000-8000-000000000004';
const DEVICE = '0199c033-0000-7000-8000-000000000005';
const SUPPLIER = '0199c033-0000-7000-8000-0000000000a1';
const REL = '0199c033-0000-7000-8000-0000000000c1';
const RICE = '0199c033-0000-7000-8000-0000000000d1';
const SALT = '0199c033-0000-7000-8000-0000000000d2';

const REG = new Date('2026-01-01T00:00:00.000Z');

const orderId = (n: number) => `0199c033-0000-7000-8000-0000000001${n}0`;
const lineId = (n: number) => `0199c033-0000-7000-8000-0000000002${n}0`;
const deliveryId = (n: number) => `0199c033-0000-7000-8000-0000000003${n}0`;
const gestureId = (n: number) => `0199c033-0000-7000-8000-0000000005${n}0`;
const saleId = (n: number) => `0199c033-0000-7000-8000-0000000006${n}0`;

const linesOf = (id: string) =>
  prisma.orderLine.findMany({ where: { orderId: id }, orderBy: { id: 'asc' } });

beforeEach(async () => {
  for (const [id, phone] of [
    [OWNER, '+237600033001'],
    [SELLER, '+237600033002'],
    [DRIVER, '+237600033003'],
    [CUSTOMER, '+237600033004'],
  ] as const) {
    await prisma.person.create({
      data: {
        id,
        fullName: 'Fixture Person',
        phoneNumber: phone,
        phoneVerifiedAt: REG,
        passwordHash: 'test-password-hash',
        registeredAt: REG,
      },
    });
  }
  await prisma.device.create({
    data: { id: DEVICE, personId: SELLER, platform: 'ANDROID', appVersion: '1.0.0' },
  });
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  for (const [i, [personId, role]] of (
    [
      [OWNER, 'OWNER'],
      [SELLER, 'SELLER'],
      [DRIVER, 'DRIVER'],
    ] as const
  ).entries()) {
    await prisma.collaboration.create({
      data: {
        id: `0199c033-0000-7000-8000-0000000004${i}f`,
        personId,
        organizationId: SUPPLIER,
        role,
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  }
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: 100000n,
      deliveryAddress: 'Street 1',
    },
  });
  await seedProduct(prisma, {
    id: RICE,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 3000n,
  });
  await seedProduct(prisma, {
    id: SALT,
    organizationId: SUPPLIER,
    name: 'Salt',
    unit: 'kg',
    price: 500n,
  });
});

describe('ORD-033 lines are saved with their variant and no product', () => {
  it('a placed order and an entered order keep the variant only (AC-1)', async () => {
    const placed = await createAuthenticatedRequest(app, CUSTOMER)
      .post('/api/v1/orders')
      .send({
        id: orderId(1),
        supplier_organization_id: SUPPLIER,
        lines: [
          { id: lineId(1), product_variant_id: RICE, quantity: '2' },
          { id: lineId(2), product_variant_id: SALT, quantity: '3' },
        ],
      });
    const entered = await createAuthenticatedRequest(app, SELLER)
      .post(`/api/v1/organizations/${SUPPLIER}/orders`)
      .send({
        id: orderId(2),
        customer_relationship_id: REL,
        lines: [
          { id: lineId(3), product_variant_id: RICE, quantity: '1' },
          { id: lineId(4), product_variant_id: SALT, quantity: '4' },
        ],
      });

    expect([placed.status, entered.status]).toEqual([201, 201]);
    const lines = [...(await linesOf(orderId(1))), ...(await linesOf(orderId(2)))];
    expect(lines.map((line) => line.productVariantId)).toEqual([RICE, SALT, RICE, SALT]);
    for (const line of lines) expect(line).not.toHaveProperty('productId');
  });

  it('the order made for the rest of a delivery keeps the variant only (AC-2)', async () => {
    await prisma.order.create({
      data: {
        id: orderId(3),
        customerRelationshipId: REL,
        enteredById: SELLER,
        placedByParty: 'SUPPLIER',
        status: 'IN_DELIVERY',
        deliveryAddressApplied: 'Street 1',
        deliveryCost: 0n,
        totalAmount: 21000n,
        lines: {
          create: [
            {
              id: lineId(5),
              productVariantId: RICE,
              labelApplied: 'Rice (sack)',
              quantity: '5',
              referencePrice: 3000n,
              unitPriceApplied: 3000n,
              amount: 15000n,
            },
            {
              id: lineId(6),
              productVariantId: SALT,
              labelApplied: 'Salt (kg)',
              quantity: '12',
              referencePrice: 500n,
              unitPriceApplied: 500n,
              amount: 6000n,
            },
          ],
        },
      },
    });
    await prisma.delivery.create({
      data: {
        id: deliveryId(3),
        orderId: orderId(3),
        assignedToId: DRIVER,
        departedAt: new Date(Date.UTC(2026, 6, 1, 8)),
      },
    });

    const response = await createAuthenticatedRequest(app, DRIVER)
      .post(`/api/v1/organizations/${SUPPLIER}/orders/${orderId(3)}/deliver`)
      .send({
        id: gestureId(3),
        collected_amount: 0,
        sale_entry_id: saleId(3),
        lines: [
          { line_id: lineId(5), delivered_quantity: '3' },
          { line_id: lineId(6), delivered_quantity: '10' },
        ],
        rest: 'LATER',
      });

    expect(response.status).toBe(200);
    const child = await prisma.order.findFirstOrThrow({ where: { parentOrderId: orderId(3) } });
    const lines = await linesOf(child.id);
    expect(lines.map((line) => line.productVariantId).sort()).toEqual([RICE, SALT].sort());
    for (const line of lines) expect(line).not.toHaveProperty('productId');
  });

  it('a line pushed by a phone keeps the variant only (AC-3)', async () => {
    const response = await createAuthenticatedRequest(app, SELLER, DEVICE)
      .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
      .send({
        changes: {
          orders: {
            created: [
              {
                id: orderId(4),
                customer_relationship_id: REL,
                delivery_address_applied: 'Street 1',
                delivery_cost: 0,
                created_at: Date.parse('2026-09-30T08:00:00.000Z'),
              },
            ],
            updated: [],
            deleted: [],
          },
          order_lines: {
            created: [
              {
                id: lineId(7),
                order_id: orderId(4),
                product_variant_id: RICE,
                quantity: '4',
                reference_price: 3000,
                unit_price_applied: 3000,
              },
            ],
            updated: [],
            deleted: [],
          },
        },
      });

    expect(bodyOf<{ accepted: number; rejected: unknown[] }>(response)).toMatchObject({
      accepted: 2,
      rejected: [],
    });
    expect(await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId(7) } })).toMatchObject({
      productVariantId: RICE,
    });
  });
});
