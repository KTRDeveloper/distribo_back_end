import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup.js';

const OWNER = '0199e048-0000-7000-8000-000000000001';
const DRIVER = '0199e048-0000-7000-8000-000000000002';
const CUSTOMER = '0199e048-0000-7000-8000-000000000003';
const ORG = '0199e048-0000-7000-8000-0000000000a1';
const REL = '0199e048-0000-7000-8000-0000000000c1';
const PRODUCT = '0199e048-0000-7000-8000-0000000000d1';
const ORDER = '0199e048-0000-7000-8000-000000000201';
const LINE = '0199e048-0000-7000-8000-000000000291';
const DEVICE = '0199e048-0000-7000-8000-000000000701';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type Rows = Array<Record<string, unknown>>;
type Changes = { created: Rows; updated: Rows; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const RECEIPT = {
  supplier_name_applied: 'Grossiste Org',
  customer_name_applied: 'Chez Mama',
  collected_applied: 4000,
  balance_after_applied: 6000,
};

const pull = (personId: string) =>
  createAuthenticatedRequest(app, personId).get('/api/v1/sync/pull');

const orderRowOf = async (personId: string) => {
  const body = bodyOf<PullBody>(await pull(personId));
  return body.changes['orders'].created.find((r) => r['id'] === ORDER);
};

async function seedPerson(id: string, phone: string, name: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: name,
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${name.toLowerCase().replace(/\W/g, '')}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
}

describe('GET /api/v1/sync/pull (the frozen receipt of an order)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600004801', 'Owner R');
    await seedPerson(DRIVER, '+237600004802', 'Driver R');
    await seedPerson(CUSTOMER, '+237600004803', 'Customer R');
    await prisma.device.create({
      data: { id: DEVICE, personId: OWNER, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    await prisma.organization.create({ data: { id: ORG, name: 'Org R', createdAt: LONG_AGO } });
    for (const [suffix, personId, role] of [
      ['01', OWNER, 'OWNER'],
      ['02', DRIVER, 'DRIVER'],
    ] as const) {
      await prisma.collaboration.create({
        data: {
          id: `0199e048-0000-7000-8000-0000000001${suffix}`,
          personId,
          organizationId: ORG,
          role,
          status: 'ACTIVE',
          invitedAt: LONG_AGO,
          acceptedAt: LONG_AGO,
        },
      });
    }
    await prisma.customerRelationship.create({
      data: {
        id: REL,
        createdById: OWNER,
        createdAt: LONG_AGO,
        supplierOrganizationId: ORG,
        customerPersonId: CUSTOMER,
        customerLabel: 'Chez Mama',
        creditLimit: 50000n,
        balance: 0n,
      },
    });
    await seedProduct(prisma, {
      id: PRODUCT,
      organizationId: ORG,
      name: 'Eau',
      unit: 'carton',
      price: 5000n,
    });
  });

  async function seedOrder(delivered: boolean) {
    await prisma.order.create({
      data: {
        id: ORDER,
        customerRelationshipId: REL,
        placedByParty: 'SUPPLIER',
        enteredById: OWNER,
        totalAmount: 10000n,
        status: delivered ? 'DELIVERED' : 'CONFIRMED',
        deliveryAddressApplied: 'Rue 1',
        createdAt: LONG_AGO,
        ...(delivered
          ? {
              deliveredAt: new Date(),
              deliveredById: DRIVER,
              supplierNameApplied: RECEIPT.supplier_name_applied,
              customerNameApplied: RECEIPT.customer_name_applied,
              collectedApplied: 4000n,
              balanceAfterApplied: 6000n,
            }
          : {}),
        lines: {
          create: {
            id: LINE,
            productVariantId: PRODUCT,
            labelApplied: 'Eau',
            quantity: 2,
            ...(delivered ? { deliveredQuantity: 2 } : {}),
            referencePrice: 5000n,
            unitPriceApplied: 5000n,
            amount: 10000n,
          },
        },
      },
    });
  }

  it.each([
    ['an OWNER of the supplier', OWNER, true],
    ['the customer person', CUSTOMER, true],
    ['a DRIVER of the supplier', DRIVER, false],
  ])('%s receives the receipt fields (AC-1)', async (_name, viewer, seesBalance) => {
    await seedOrder(true);

    const row = await orderRowOf(viewer);

    expect(row).toMatchObject({
      supplier_name_applied: RECEIPT.supplier_name_applied,
      customer_name_applied: RECEIPT.customer_name_applied,
      collected_applied: RECEIPT.collected_applied,
    });
    if (seesBalance) expect(row).toHaveProperty('balance_after_applied', 6000);
    else expect(row).not.toHaveProperty('balance_after_applied');
  });

  it('an order not yet delivered has null receipt fields (AC-2)', async () => {
    await seedOrder(false);

    const row = await orderRowOf(OWNER);

    expect(row).toMatchObject({
      supplier_name_applied: null,
      customer_name_applied: null,
      collected_applied: null,
      balance_after_applied: null,
    });
  });

  it('a phone pushing a receipt does not change the stored one (AB-1, WSTG-BUSL-01)', async () => {
    await seedOrder(true);

    await createAuthenticatedRequest(app, OWNER, DEVICE)
      .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
      .send({
        changes: {
          orders: {
            created: [],
            updated: [
              {
                id: ORDER,
                collected_applied: 0,
                supplier_name_applied: 'Faux',
                customer_name_applied: 'Faux',
                balance_after_applied: 0,
              },
            ],
            deleted: [],
          },
        },
      });

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: ORDER } });
    expect(stored.collectedApplied).toBe(4000n);
    expect(stored.supplierNameApplied).toBe(RECEIPT.supplier_name_applied);
    expect(stored.customerNameApplied).toBe(RECEIPT.customer_name_applied);
    expect(stored.balanceAfterApplied).toBe(6000n);
    expect(await orderRowOf(OWNER)).toMatchObject(RECEIPT);
  });
});
