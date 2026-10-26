import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c013-0000-7000-8000-000000000001';
const SELLER = '0199c013-0000-7000-8000-000000000003';
const DRIVER = '0199c013-0000-7000-8000-000000000004';
const CUSTOMER = '0199c013-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c013-0000-7000-8000-000000000006';

const SUPPLIER = '0199c013-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c013-0000-7000-8000-0000000000a2';
const PRODUCT_A = '0199c013-0000-7000-8000-0000000000b1';
const PRODUCT_B = '0199c013-0000-7000-8000-0000000000b2';
const PRODUCT_OFF = '0199c013-0000-7000-8000-0000000000b3';
const OTHER_PRODUCT = '0199c013-0000-7000-8000-0000000000b4';
const REL = '0199c013-0000-7000-8000-0000000000e1';
const COUNTER_REL = '0199c013-0000-7000-8000-0000000000e2';
const ENDED_REL = '0199c013-0000-7000-8000-0000000000e3';
const OTHER_REL = '0199c013-0000-7000-8000-0000000000e4';
const ORDER_ID = '0199c013-0000-7000-8000-0000000000c1';
const LINE_1 = '0199c013-0000-7000-8000-0000000000d1';
const LINE_2 = '0199c013-0000-7000-8000-0000000000d2';
const LINE_3 = '0199c013-0000-7000-8000-0000000000d3';

const REG = new Date('2026-01-01T00:00:00.000Z');

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
      preferredLanguage: 'EN',
    },
  });
}

async function seedMember(
  orgId: string,
  personId: string,
  role: 'OWNER' | 'SELLER' | 'DRIVER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c013-0000-7000-8000-0000000001${n}0`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

const GESTURE = '0199c013-0000-7000-8000-0000000000f9';
const LINE_4 = '0199c013-0000-7000-8000-0000000000d4';

type OrderBody = {
  id: string;
  status: string;
  total_amount: number;
  delivery_cost: number;
  delivery_address_applied: string | null;
  customer_note: string | null;
  desired_delivery_date: string | null;
  lines: Array<{
    id: string;
    reference_price: number;
    unit_price_applied: number;
    amount: number;
    price_set_by_id?: string | null;
  }>;
};

function edit(body: unknown, orderId = ORDER_ID, personId = SELLER, organizationId = SUPPLIER) {
  return createAuthenticatedRequest(app, personId)
    .patch(`/api/v1/organizations/${organizationId}/orders/${orderId}`)
    .send(body as object);
}

function patchOf(extra: Record<string, unknown> = {}) {
  return { id: GESTURE, ...extra };
}

async function seedOrder(
  id: string,
  relationshipId: string,
  placedByParty: 'SUPPLIER' | 'CUSTOMER',
  status: 'CONFIRMED' | 'PENDING' = 'CONFIRMED',
  lineId = LINE_1
) {
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      enteredById: placedByParty === 'SUPPLIER' ? SELLER : CUSTOMER,
      placedByParty,
      status,
      deliveryAddressApplied: 'Rue 1',
      deliveryCost: 500n,
      totalAmount: 30500n,
      lines: {
        create: {
          id: lineId,
          productVariantId: PRODUCT_A,
          labelApplied: 'Rice (sack)',
          quantity: '10',
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: 30000n,
        },
      },
    },
  });
}

async function unchanged() {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
  expect(order.totalAmount).toBe(30500n);
  expect(order.deliveryCost).toBe(500n);
  expect(order.deliveryAddressApplied).toBe('Rue 1');
  const lines = await prisma.orderLine.findMany({ where: { orderId: ORDER_ID } });
  expect(lines.map((line) => [line.id, line.deletedAt])).toEqual([[LINE_1, null]]);
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600013001');
  await seedPerson(SELLER, '+237600013003');
  await seedPerson(DRIVER, '+237600013004');
  await seedPerson(CUSTOMER, '+237600013005');
  await seedPerson(OTHER_OWNER, '+237600013006');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 5);
  await seedProduct(prisma, {
    id: PRODUCT_A,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 3000n,
  });
  await seedProduct(prisma, {
    id: PRODUCT_B,
    organizationId: SUPPLIER,
    name: 'Salt',
    unit: 'kg',
    price: 500n,
    minOrderQuantity: '5',
  });
  await seedProduct(prisma, {
    id: PRODUCT_OFF,
    organizationId: SUPPLIER,
    name: 'Old',
    unit: 'kg',
    price: 100n,
    status: 'INACTIVE',
  });
  await seedProduct(prisma, {
    id: OTHER_PRODUCT,
    organizationId: OTHER_ORG,
    name: 'Oil',
    unit: 'l',
    price: 900n,
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
      deliveryAddress: 'Rue 1',
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: COUNTER_REL,
      supplierOrganizationId: SUPPLIER,
      customerLabel: 'Comptoir',
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: 0n,
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: ENDED_REL,
      supplierOrganizationId: SUPPLIER,
      customerLabel: 'Old customer',
      customerPersonId: OTHER_OWNER,
      createdById: OWNER,
      status: 'ENDED',
      endedByParty: 'SUPPLIER',
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: OTHER_REL,
      supplierOrganizationId: OTHER_ORG,
      customerPersonId: CUSTOMER,
      createdById: OTHER_OWNER,
      status: 'ACTIVE',
    },
  });
  await seedOrder(ORDER_ID, REL, 'SUPPLIER');
});

describe('ORD-014 seller edits an order before departure', () => {
  it('edits the delivery cost and address, total recomputed (AC-1, C-18)', async () => {
    const response = await edit(patchOf({ delivery_cost: 1500, delivery_address: 'Rue 2' }));

    expect(response.status).toBe(200);
    const body = bodyOf<OrderBody>(response);
    expect(body).toMatchObject({
      id: ORDER_ID,
      status: 'CONFIRMED',
      delivery_cost: 1500,
      delivery_address_applied: 'Rue 2',
      total_amount: 31500,
    });
    expect(body.lines).toHaveLength(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
    expect(order).toMatchObject({ deliveryCost: 1500n, totalAmount: 31500n });
  });

  it('clears the nullable fields with null (AC-1)', async () => {
    await prisma.order.update({
      where: { id: ORDER_ID },
      data: { customerNote: 'Fragile', desiredDeliveryDate: new Date('2026-12-01T00:00:00.000Z') },
    });

    const response = await edit(
      patchOf({
        delivery_address: null,
        delivery_cost: null,
        desired_delivery_date: null,
        customer_note: null,
      })
    );

    expect(response.status).toBe(200);
    expect(bodyOf<OrderBody>(response)).toMatchObject({
      delivery_address_applied: null,
      delivery_cost: 0,
      desired_delivery_date: null,
      customer_note: null,
      total_amount: 30000,
    });
  });

  it('replaces the lines: old deleted, new priced from the catalog, total recomputed (AC-2)', async () => {
    const response = await edit(
      patchOf({
        lines: [
          { id: LINE_2, product_variant_id: PRODUCT_A, quantity: 2 },
          { id: LINE_3, product_variant_id: PRODUCT_B, quantity: 1, unit_price_applied: 400 },
        ],
      })
    );

    expect(response.status).toBe(200);
    const body = bodyOf<OrderBody>(response);
    expect(body.total_amount).toBe(6000 + 400 + 500);
    expect(body.lines.map((line) => line.id).sort()).toEqual([LINE_2, LINE_3]);
    const second = body.lines.find((line) => line.id === LINE_2);
    expect(second).toMatchObject({ reference_price: 3000, unit_price_applied: 3000, amount: 6000 });
    expect(body.lines.find((line) => line.id === LINE_3)).toMatchObject({
      reference_price: 500,
      unit_price_applied: 400,
      amount: 400,
    });

    const old = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE_1 } });
    expect(old.deletedAt).not.toBeNull();
    const gap = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE_3 } });
    expect(gap.priceSetById).toBe(SELLER);
    expect(gap.priceSetAt).not.toBeNull();
    const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
    expect(order.totalAmount).toBe(6900n);
  });

  it('ignores the minimum order quantity, like a seller entry (AC-2)', async () => {
    const response = await edit(
      patchOf({ lines: [{ id: LINE_2, product_variant_id: PRODUCT_B, quantity: 1 }] })
    );

    expect(response.status).toBe(200);
    expect(bodyOf<OrderBody>(response).total_amount).toBe(1000);
  });

  it('refuses a line id already used by the order with 400, changing nothing (AC-4)', async () => {
    const response = await edit(
      patchOf({ lines: [{ id: LINE_1, product_variant_id: PRODUCT_A, quantity: 2 }] })
    );

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    await unchanged();
  });

  it.each(['IN_DELIVERY', 'DELIVERED', 'CANCELLED'] as const)(
    'refuses an order that is %s with ORDER_FROZEN (AC-3, AB-1, C-18)',
    async (status) => {
      if (status === 'IN_DELIVERY') {
        await prisma.order.update({ where: { id: ORDER_ID }, data: { status } });
      } else if (status === 'DELIVERED') {
        await prisma.$transaction([
          prisma.orderLine.updateMany({
            where: { orderId: ORDER_ID },
            data: { deliveredQuantity: '10' },
          }),
          prisma.order.update({
            where: { id: ORDER_ID },
            data: { status, deliveredAt: new Date(), deliveredById: SELLER },
          }),
        ]);
      } else {
        await prisma.order.update({
          where: { id: ORDER_ID },
          data: {
            status,
            cancelledByParty: 'SUPPLIER',
            cancelledById: OWNER,
            cancelledAt: new Date(),
            cancellationReason: 'Test',
          },
        });
      }

      const response = await edit(patchOf({ delivery_cost: 1500 }));
      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORDER_FROZEN');
      const lines = await edit(
        patchOf({ id: LINE_4, lines: [{ id: LINE_2, product_variant_id: PRODUCT_A, quantity: 1 }] })
      );
      expect(lines.status).toBe(409);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
      expect(order.deliveryCost).toBe(500n);
      expect(order.totalAmount).toBe(30500n);
      expect(await prisma.orderLine.count({ where: { deletedAt: { not: null } } })).toBe(0);
    }
  );

  it('refuses an order placed by the customer, confirmed or pending (AC-3)', async () => {
    const confirmed = '0199c013-0000-7000-8000-0000000000c2';
    const pending = '0199c013-0000-7000-8000-0000000000c3';
    await seedOrder(confirmed, REL, 'CUSTOMER', 'CONFIRMED', LINE_2);
    await seedOrder(pending, REL, 'CUSTOMER', 'PENDING', LINE_3);

    for (const id of [confirmed, pending]) {
      const response = await edit(patchOf({ delivery_cost: 1500 }), id);
      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORDER_FROZEN');
      const order = await prisma.order.findUniqueOrThrow({ where: { id } });
      expect(order.deliveryCost).toBe(500n);
    }
  });

  it('refuses an empty body, only a gesture id, empty lines and unknown or computed fields (AC-4, CWE-915)', async () => {
    for (const body of [
      {},
      patchOf(),
      patchOf({ lines: [] }),
      patchOf({ status: 'CANCELLED' }),
      patchOf({ total_amount: 1 }),
      patchOf({ placed_by_party: 'CUSTOMER' }),
      patchOf({ delivery_cost: -1 }),
      patchOf({ delivery_cost: 1.5 }),
      patchOf({ lines: [{ id: LINE_2, product_variant_id: PRODUCT_A, quantity: 1, amount: 1 }] }),
      patchOf({
        lines: [
          { id: LINE_2, product_variant_id: PRODUCT_A, quantity: 1 },
          { id: LINE_2, product_variant_id: PRODUCT_A, quantity: 2 },
        ],
      }),
    ]) {
      const response = await edit(body);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    await unchanged();
  });

  it('refuses an INACTIVE product or a product of another business with 404, changing nothing (AC-4, C-15)', async () => {
    for (const productId of [PRODUCT_OFF, OTHER_PRODUCT]) {
      const response = await edit(
        patchOf({
          delivery_cost: 1500,
          lines: [
            { id: LINE_2, product_variant_id: PRODUCT_A, quantity: 1 },
            { id: LINE_3, product_variant_id: productId, quantity: 1 },
          ],
        })
      );
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      await unchanged();
    }
  });

  it("answers 404 for another business's order and for an unknown order (AB-2, WSTG-ATHZ-04)", async () => {
    const asOther = await edit(patchOf({ delivery_cost: 1500 }), ORDER_ID, OTHER_OWNER, OTHER_ORG);
    expect(asOther.status).toBe(404);
    expect(bodyOf<ErrorBody>(asOther).error.code).toBe('NOT_FOUND');

    const wrongPath = await edit(patchOf({ delivery_cost: 1500 }), ORDER_ID, OTHER_OWNER, SUPPLIER);
    expect(wrongPath.status).toBe(404);

    const unknown = await edit(
      patchOf({ delivery_cost: 1500 }),
      '0199c013-0000-7000-8000-0000000000cf'
    );
    expect(unknown.status).toBe(404);
    await unchanged();
  });

  it('refuses a DRIVER with 403 (AC-4)', async () => {
    const response = await edit(patchOf({ delivery_cost: 1500 }), ORDER_ID, DRIVER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    await unchanged();
  });

  it('repeats the same gesture: applied once, same answer', async () => {
    const first = await edit(patchOf({ delivery_cost: 1500 }));
    const second = await edit(patchOf({ delivery_cost: 1500 }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('keeps the price author away from the SELLER view and shows it to the OWNER (v5.0.0-8.2.3)', async () => {
    const lines = [
      { id: LINE_2, product_variant_id: PRODUCT_A, quantity: 1, unit_price_applied: 2000 },
    ];
    const asSeller = await edit(patchOf({ lines }));
    expect(bodyOf<OrderBody>(asSeller).lines[0]).not.toHaveProperty('price_set_by_id');

    const asOwner = await edit(
      patchOf({ id: LINE_4, lines: [{ ...lines[0], id: LINE_3 }] }),
      ORDER_ID,
      OWNER
    );
    expect(asOwner.status).toBe(200);
    expect(bodyOf<OrderBody>(asOwner).lines[0]).toHaveProperty('price_set_by_id', OWNER);
  });
});
