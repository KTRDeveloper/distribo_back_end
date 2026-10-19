import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0e0-0000-7000-8000-000000000001';
const SELLER = '0199c0e0-0000-7000-8000-000000000003';
const DRIVER = '0199c0e0-0000-7000-8000-000000000004';
const CUSTOMER = '0199c0e0-0000-7000-8000-000000000006';

const SUPPLIER = '0199c0e0-0000-7000-8000-0000000000a1';
const SOLO_PRODUCT = '0199c0e0-0000-7000-8000-0000000000b1';
const SOLO_VARIANT = '0199c0e0-0000-7000-8000-0000000000b2';
const SHIRT_PRODUCT = '0199c0e0-0000-7000-8000-0000000000b3';
const RED_L = '0199c0e0-0000-7000-8000-0000000000b4';
const BLUE_M = '0199c0e0-0000-7000-8000-0000000000b5';
const REL = '0199c0e0-0000-7000-8000-0000000000e1';
const COUNTER = '0199c0e0-0000-7000-8000-0000000000e2';

const REG = new Date('2026-01-01T00:00:00.000Z');

const orderId = (n: number) => `0199c0e0-0000-7000-8000-0000000001${n}0`;
const lineId = (n: number) => `0199c0e0-0000-7000-8000-0000000002${n}0`;
const deliveryId = (n: number) => `0199c0e0-0000-7000-8000-0000000003${n}0`;
const gestureId = (n: number) => `0199c0e0-0000-7000-8000-0000000005${n}0`;
const saleId = (n: number) => `0199c0e0-0000-7000-8000-0000000006${n}0`;
const paymentId = (n: number) => `0199c0e0-0000-7000-8000-0000000007${n}0`;

async function seedPerson(id: string, phone: string) {
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

/** A new-style product (empty unit): the code, not the trigger, inserts its variants. */
async function seedProduct(id: string, name: string) {
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price)
    VALUES (${id}::uuid, ${SUPPLIER}::uuid, ${name}, '', 3000)
  `;
}

async function seedVariant(id: string, productId: string, name: string | null) {
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price)
    VALUES (${id}::uuid, ${productId}::uuid, ${SUPPLIER}::uuid, ${name}, 'pièce', 3000)
  `;
}

/** An IN_DELIVERY order departed with the driver: one line of 5 units of the variant at 3000. */
async function seedOrder(n: number, productId: string, variantId: string, label: string) {
  await prisma.order.create({
    data: {
      id: orderId(n),
      customerRelationshipId: REL,
      enteredById: SELLER,
      placedByParty: 'SUPPLIER',
      status: 'IN_DELIVERY',
      deliveryAddressApplied: 'Street 1',
      deliveryCost: 0n,
      totalAmount: 13500n,
      createdAt: new Date(Date.UTC(2026, 5, n)),
      lines: {
        create: [
          {
            id: lineId(n),
            productId,
            productVariantId: variantId,
            labelApplied: label,
            quantity: '5',
            referencePrice: 3000n,
            unitPriceApplied: 2700n,
            amount: 13500n,
            priceSetById: SELLER,
            priceSetAt: REG,
          },
        ],
      },
    },
  });
  await prisma.delivery.create({
    data: {
      id: deliveryId(n),
      orderId: orderId(n),
      assignedToId: DRIVER,
      departedAt: new Date(Date.UTC(2026, 6, 1, 8)),
    },
  });
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600090001');
  await seedPerson(SELLER, '+237600090003');
  await seedPerson(DRIVER, '+237600090004');
  await seedPerson(CUSTOMER, '+237600090006');
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
        id: `0199c0e0-0000-7000-8000-0000000004${i}f`,
        personId,
        organizationId: SUPPLIER,
        role,
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  }
  await seedProduct(SOLO_PRODUCT, 'Sac');
  await seedVariant(SOLO_VARIANT, SOLO_PRODUCT, null);
  await seedProduct(SHIRT_PRODUCT, 'T-shirt');
  await seedVariant(RED_L, SHIRT_PRODUCT, 'Rouge / L');
  await seedVariant(BLUE_M, SHIRT_PRODUCT, 'Bleu / M');
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: 100000n,
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: COUNTER,
      supplierOrganizationId: SUPPLIER,
      customerLabel: 'Counter',
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: 0n,
    },
  });
});

describe('DLV-014 the rest of a delivery and a counter sale keep the variant', () => {
  it.each([
    ['the only variant of a product', SOLO_PRODUCT, SOLO_VARIANT, 'Sac (pièce)'],
    ['a variant "Rouge / L" among several', SHIRT_PRODUCT, RED_L, 'T-shirt — Rouge / L (pièce)'],
  ])('the rest keeps %s (AC-1)', async (_name, productId, variantId, label) => {
    await seedOrder(1, productId, variantId, label);

    const response = await createAuthenticatedRequest(app, DRIVER)
      .post(`/api/v1/organizations/${SUPPLIER}/orders/${orderId(1)}/deliver`)
      .send({
        id: gestureId(1),
        collected_amount: 0,
        sale_entry_id: saleId(1),
        lines: [{ line_id: lineId(1), delivered_quantity: '3' }],
        rest: 'LATER',
      });

    expect(response.status).toBe(200);
    const child = await prisma.order.findFirstOrThrow({
      where: { parentOrderId: orderId(1) },
      include: { lines: true },
    });
    expect(child.lines).toHaveLength(1);
    expect(child.lines[0]).toMatchObject({
      productId,
      productVariantId: variantId,
      labelApplied: label,
      referencePrice: 3000n,
      unitPriceApplied: 2700n,
      amount: 5400n,
      priceSetById: SELLER,
    });
    expect(child.lines[0]?.quantity.toString()).toBe('2');
  });

  it('a counter sale names the variant and its product (AC-2)', async () => {
    const response = await createAuthenticatedRequest(app, SELLER)
      .post(`/api/v1/organizations/${SUPPLIER}/counters/${COUNTER}/sales`)
      .send({
        id: gestureId(2),
        sale_entry_id: saleId(2),
        payment_entry_id: paymentId(2),
        lines: [{ id: lineId(2), product_id: RED_L, quantity: '2' }],
        collected_amount: 6000,
        mode: 'CASH',
      });

    expect(response.status).toBe(201);
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId(2) } });
    expect(line).toMatchObject({
      productId: SHIRT_PRODUCT,
      productVariantId: RED_L,
      labelApplied: 'T-shirt — Rouge / L (pièce)',
      amount: 6000n,
    });
  });
});
