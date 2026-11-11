import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { seedProduct } from '../../helpers/catalog-fixtures';
import { prisma } from '../../setup.js';

const OWNER_A = '0199f045-0000-7000-8000-000000000001';
const CUSTOMER_A = '0199f045-0000-7000-8000-000000000002';
const OWNER_B = '0199f045-0000-7000-8000-000000000003';
const ORG_A = '0199f045-0000-7000-8000-0000000000a1';
const ORG_B = '0199f045-0000-7000-8000-0000000000b1';
const REL_A = '0199f045-0000-7000-8000-0000000000c1';
const PRODUCT_A = '0199f045-0000-7000-8000-0000000000d1';
const O1 = '0199f045-0000-7000-8000-000000000201';
const O2 = '0199f045-0000-7000-8000-000000000202';
const L1 = '0199f045-0000-7000-8000-000000000301';
const L2 = '0199f045-0000-7000-8000-000000000302';
const L3 = '0199f045-0000-7000-8000-000000000303';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type Rows = Array<Record<string, unknown>>;
type Changes = { created: Rows; updated: Rows; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const pull = (personId: string, query = '') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/sync/pull${query}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sorted = (ids: string[]) => [...ids].sort();
const idsOf = (rows: Rows) => sorted(rows.map((r) => r['id'] as string));

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

async function seedOrder(id: string, lines: string[]) {
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: REL_A,
      placedByParty: 'CUSTOMER',
      enteredById: CUSTOMER_A,
      totalAmount: BigInt(lines.length * 10000),
      status: 'PENDING',
      createdAt: LONG_AGO,
      lines: {
        create: lines.map((lineId) => ({
          id: lineId,
          productVariantId: PRODUCT_A,
          labelApplied: 'Eau',
          quantity: 2,
          referencePrice: 5000n,
          unitPriceApplied: 5000n,
          amount: 10000n,
        })),
      },
    },
  });
}

describe('GET /api/v1/sync/pull (lines of a deleted order, SYNC-045)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER_A, '+237600004501', 'Owner A');
    await seedPerson(CUSTOMER_A, '+237600004502', 'Customer A');
    await seedPerson(OWNER_B, '+237600004503', 'Owner B');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    for (const [suffix, personId, org] of [
      ['01', OWNER_A, ORG_A],
      ['02', OWNER_B, ORG_B],
    ]) {
      await prisma.collaboration.create({
        data: {
          id: `0199f045-0000-7000-8000-0000000001${suffix}`,
          personId,
          organizationId: org,
          role: 'OWNER',
          status: 'ACTIVE',
          invitedAt: LONG_AGO,
          acceptedAt: LONG_AGO,
        },
      });
    }
    await prisma.customerRelationship.create({
      data: {
        id: REL_A,
        createdById: OWNER_A,
        createdAt: LONG_AGO,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER_A,
        customerLabel: 'Chez Mama',
        creditLimit: 50000n,
        balance: 0n,
      },
    });
    await seedProduct(prisma, {
      id: PRODUCT_A,
      organizationId: ORG_A,
      name: 'Eau',
      unit: 'carton',
      price: 5000n,
    });
    await seedOrder(O1, [L1, L2]);
    await seedOrder(O2, [L3]);
  });

  it('AC-1: the lines follow their deleted order', async () => {
    const first = bodyOf<PullBody>(await pull(OWNER_A));
    await sleep(20);
    await prisma.order.update({ where: { id: O1 }, data: { deletedAt: new Date() } });

    const body = bodyOf<PullBody>(await pull(OWNER_A, `?last_pulled_at=${first.timestamp}`));

    expect(sorted(body.changes['order_lines'].deleted)).toEqual(sorted([L1, L2]));
    expect(body.changes['orders'].deleted).toEqual([O1]);
    expect(body.changes['order_lines'].updated).toEqual([]);
    expect(body.changes['order_lines'].created).toEqual([]);

    const customer = bodyOf<PullBody>(await pull(CUSTOMER_A, `?last_pulled_at=${first.timestamp}`));
    expect(sorted(customer.changes['order_lines'].deleted)).toEqual(sorted([L1, L2]));
  });

  it('AC-1: the deletion is listed once, not again on a later pull', async () => {
    await prisma.order.update({ where: { id: O1 }, data: { deletedAt: new Date() } });
    const mid = bodyOf<PullBody>(await pull(OWNER_A, '?last_pulled_at=0'));
    await sleep(20);

    const body = bodyOf<PullBody>(await pull(OWNER_A, `?last_pulled_at=${mid.timestamp}`));

    expect(body.changes['order_lines'].deleted).toEqual([]);
    expect(body.changes['orders'].deleted).toEqual([]);
  });

  it('AC-2: a first pull sends neither the deleted order nor its lines', async () => {
    await prisma.order.update({ where: { id: O1 }, data: { deletedAt: new Date() } });

    const body = bodyOf<PullBody>(await pull(OWNER_A));

    expect(idsOf(body.changes['orders'].created)).toEqual([O2]);
    expect(idsOf(body.changes['order_lines'].created)).toEqual([L3]);
    expect(body.changes['order_lines'].deleted).toEqual([]);
    expect(body.changes['orders'].deleted).toEqual([]);
  });

  it('AC-3: a changed line of a live order is updated, not deleted', async () => {
    const first = bodyOf<PullBody>(await pull(OWNER_A));
    await sleep(20);
    await prisma.orderLine.update({ where: { id: L3 }, data: { labelApplied: 'Eau 1L' } });

    const body = bodyOf<PullBody>(await pull(OWNER_A, `?last_pulled_at=${first.timestamp}`));

    expect(idsOf(body.changes['order_lines'].updated)).toEqual([L3]);
    expect(body.changes['order_lines'].deleted).toEqual([]);
  });

  it('AB-1 (WSTG-ATHZ-04): a member of another business gets no line of the deleted order', async () => {
    const first = bodyOf<PullBody>(await pull(OWNER_B));
    await sleep(20);
    await prisma.order.update({ where: { id: O1 }, data: { deletedAt: new Date() } });

    const body = bodyOf<PullBody>(await pull(OWNER_B, `?last_pulled_at=${first.timestamp}`));

    expect(body.changes['order_lines']).toEqual({ created: [], updated: [], deleted: [] });
    expect(body.changes['orders']).toEqual({ created: [], updated: [], deleted: [] });
  });
});
