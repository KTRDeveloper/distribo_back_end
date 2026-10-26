import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { seedCustomerPrice } from '../../helpers/catalog-fixtures.js';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const OWNER = '0199e027-0000-7000-8000-000000000001';
const SELLER = '0199e027-0000-7000-8000-000000000002';
const CUSTOMER = '0199e027-0000-7000-8000-000000000003';
const OUTSIDER = '0199e027-0000-7000-8000-000000000004';
const ORG = '0199e027-0000-7000-8000-0000000000a1';
const REL = '0199e027-0000-7000-8000-0000000000c1';
const PRODUCT = '0199e027-0000-7000-8000-0000000000d1';
const VARIANT = '0199e027-0000-7000-8000-0000000000d2';
const PRICE = '0199e027-0000-7000-8000-0000000000e1';
const ORDER = '0199e027-0000-7000-8000-000000000201';
const LINE = '0199e027-0000-7000-8000-000000000291';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type Rows = Array<Record<string, unknown>>;
type Changes = { created: Rows; updated: Rows; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const pull = (personId: string, query = '') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/sync/pull${query}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

describe('GET /api/v1/sync/pull (negotiated prices and order lines by variant)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600002701', 'Owner A');
    await seedPerson(SELLER, '+237600002702', 'Seller A');
    await seedPerson(CUSTOMER, '+237600002703', 'Customer');
    await seedPerson(OUTSIDER, '+237600002704', 'Outsider');
    await prisma.organization.create({ data: { id: ORG, name: 'Org A', createdAt: LONG_AGO } });
    for (const [suffix, personId, role] of [
      ['01', OWNER, 'OWNER'],
      ['02', SELLER, 'SELLER'],
    ]) {
      await prisma.collaboration.create({
        data: {
          id: `0199e027-0000-7000-8000-0000000001${suffix}`,
          personId,
          organizationId: ORG,
          role: role as 'OWNER',
          status: 'ACTIVE',
          invitedAt: LONG_AGO,
          acceptedAt: LONG_AGO,
        },
      });
    }
    await prisma.customerRelationship.create({
      data: {
        id: REL,
        createdById: SELLER,
        createdAt: LONG_AGO,
        supplierOrganizationId: ORG,
        customerPersonId: CUSTOMER,
        customerLabel: 'Chez Mama',
        creditLimit: 50000n,
        balance: 0n,
      },
    });
    await prisma.product.create({
      data: { id: PRODUCT, organizationId: ORG, name: 'Riz' },
    });
    await prisma.productVariant.create({
      data: {
        id: VARIANT,
        productId: PRODUCT,
        organizationId: ORG,
        name: 'sac 10 kg',
        unit: 'sac',
        price: 5000n,
      },
    });
    await seedCustomerPrice(prisma, {
      id: PRICE,
      customerRelationshipId: REL,
      productVariantId: VARIANT,
      price: 4500n,
      setById: SELLER,
    });
    await prisma.order.create({
      data: {
        id: ORDER,
        customerRelationshipId: REL,
        placedByParty: 'SUPPLIER',
        enteredById: SELLER,
        totalAmount: 10000n,
        status: 'CONFIRMED',
        createdAt: LONG_AGO,
        lines: {
          create: {
            id: LINE,
            productVariantId: VARIANT,
            labelApplied: 'Riz sac 10 kg',
            quantity: 2,
            referencePrice: 5000n,
            unitPriceApplied: 5000n,
            amount: 10000n,
          },
        },
      },
    });
  });

  it('price by variant: the OWNER, a SELLER and the customer get product_variant_id and no product_id (AC-1)', async () => {
    for (const person of [OWNER, SELLER, CUSTOMER]) {
      const rows = bodyOf<PullBody>(await pull(person)).changes['customer_prices'].created;

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: PRICE,
        customer_relationship_id: REL,
        product_variant_id: VARIANT,
        price: 4500,
      });
      expect(rows[0]).not.toHaveProperty('product_id');
    }
  });

  it('price by variant: a person outside the relationship receives no price (v5.0.0-8.2.2)', async () => {
    const body = bodyOf<PullBody>(await pull(OUTSIDER));

    expect(body.changes['customer_prices']).toEqual({ created: [], updated: [], deleted: [] });
  });

  it('line by variant: the SELLER and the customer get product_variant_id and no product_id (AC-2)', async () => {
    for (const person of [SELLER, CUSTOMER]) {
      const rows = bodyOf<PullBody>(await pull(person)).changes['order_lines'].created;

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: LINE, order_id: ORDER, product_variant_id: VARIANT });
      expect(rows[0]).not.toHaveProperty('product_id');
    }
  });

  it('deleted price: its id is in deleted after the last pull (AC-3, C-35)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER));
    await sleep(20);
    await prisma.customerPrice.update({ where: { id: PRICE }, data: { deletedAt: new Date() } });

    for (const person of [SELLER, CUSTOMER]) {
      const body = bodyOf<PullBody>(await pull(person, `?last_pulled_at=${first.timestamp}`));

      expect(body.changes['customer_prices'].deleted).toEqual([PRICE]);
      expect(body.changes['customer_prices'].created).toEqual([]);
    }
  });
});
