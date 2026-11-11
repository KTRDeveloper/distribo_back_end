import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { RECEIPT_FIELDS } from '../../helpers/receipt-fields.js';
import { prisma } from '../../setup.js';

const OWNER = '0199e020-0000-7000-8000-000000000001';
const JEAN = '0199e020-0000-7000-8000-000000000002';
const PAUL = '0199e020-0000-7000-8000-000000000003';
const DRIVER = '0199e020-0000-7000-8000-000000000004';
const CUSTOMER = '0199e020-0000-7000-8000-000000000005';
const OWNER_B = '0199e020-0000-7000-8000-000000000006';
const SELLER_B = '0199e020-0000-7000-8000-000000000007';
const FORMER = '0199e020-0000-7000-8000-000000000008';
const ORG_A = '0199e020-0000-7000-8000-0000000000a1';
const ORG_B = '0199e020-0000-7000-8000-0000000000b1';
const REL_A = '0199e020-0000-7000-8000-0000000000c1';
const REL_B = '0199e020-0000-7000-8000-0000000000c2';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

const idOf = (n: number) => `0199e020-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ORDER_JEAN_1 = idOf(0x201);
const ORDER_JEAN_2 = idOf(0x202);
const ORDER_PAUL = idOf(0x203);
const ORDER_JEAN_CLEAN = idOf(0x204);
const ORDER_B = idOf(0x205);
const ORDER_DELIVERED_BY_JEAN = idOf(0x206);
const ORDER_FORMER = idOf(0x207);
const ORDER_CUSTOMER = idOf(0x208);
const DELIVERY_DRIVER = idOf(0x301);
const DELIVERY_B = idOf(0x302);

type Item = {
  table: string;
  id: string;
  order_id: string;
  code: string;
  message: string;
  created_at: string;
};
type Page = { items: Item[]; next_cursor: string | null };

const list = (personId: string, query = '') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/sync/issues${query}`);
const idsOf = (page: Page) => page.items.map((item) => item.id);

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

async function seedCollaboration(
  suffix: string,
  personId: string,
  org: string,
  role: 'OWNER' | 'SELLER' | 'DRIVER',
  status: 'ACTIVE' | 'REVOKED' = 'ACTIVE'
) {
  await prisma.collaboration.create({
    data: {
      id: idOf(0x100 + Number.parseInt(suffix, 16)),
      personId,
      organizationId: org,
      role,
      status,
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

async function seedOrder(
  id: string,
  relationshipId: string,
  enteredById: string,
  syncIssue: string | null,
  createdAt: Date,
  extra: { deliveredById?: string } = {}
) {
  const delivered = extra.deliveredById !== undefined;
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      placedByParty: 'SUPPLIER',
      enteredById,
      totalAmount: 0n,
      status: delivered ? 'DELIVERED' : 'CONFIRMED',
      deliveredAt: delivered ? createdAt : null,
      ...(delivered ? RECEIPT_FIELDS : {}),
      deliveredById: extra.deliveredById ?? null,
      syncIssue,
      createdAt,
    },
  });
}

const at = (minutes: number) => new Date(LONG_AGO.getTime() + minutes * 60_000);

describe('GET /api/v1/sync/issues', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600002001', 'Owner A');
    await seedPerson(JEAN, '+237600002002', 'Jean');
    await seedPerson(PAUL, '+237600002003', 'Paul');
    await seedPerson(DRIVER, '+237600002004', 'Driver A');
    await seedPerson(CUSTOMER, '+237600002005', 'Customer');
    await seedPerson(OWNER_B, '+237600002006', 'Owner B');
    await seedPerson(SELLER_B, '+237600002007', 'Seller B');
    await seedPerson(FORMER, '+237600002008', 'Former');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedCollaboration('01', OWNER, ORG_A, 'OWNER');
    await seedCollaboration('02', JEAN, ORG_A, 'SELLER');
    await seedCollaboration('03', PAUL, ORG_A, 'SELLER');
    await seedCollaboration('04', DRIVER, ORG_A, 'DRIVER');
    await seedCollaboration('05', OWNER_B, ORG_B, 'OWNER');
    await seedCollaboration('06', SELLER_B, ORG_B, 'SELLER');
    await seedCollaboration('07', FORMER, ORG_A, 'SELLER', 'REVOKED');

    await prisma.customerRelationship.create({
      data: {
        id: REL_A,
        createdById: JEAN,
        createdAt: LONG_AGO,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        customerLabel: 'Chez Mama',
        creditLimit: 50000n,
        balance: 0n,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        id: REL_B,
        createdById: OWNER_B,
        createdAt: LONG_AGO,
        supplierOrganizationId: ORG_B,
        customerLabel: 'Client B',
        creditLimit: 0n,
        balance: 0n,
      },
    });

    await seedOrder(ORDER_JEAN_1, REL_A, JEAN, 'PRICE_CHANGED: prix modifié', at(10));
    await seedOrder(ORDER_JEAN_2, REL_A, JEAN, 'CREDIT_EXCEEDED: Chez Mama : plafond', at(20));
    await seedOrder(ORDER_PAUL, REL_A, PAUL, 'ARTICLE_REMOVED: article retiré', at(30));
    await seedOrder(ORDER_JEAN_CLEAN, REL_A, JEAN, null, at(40));
    await seedOrder(ORDER_B, REL_B, SELLER_B, 'PRICE_CHANGED: autre boutique', at(50));
  });

  it('own: a seller sees only the flagged records they entered (AC-1)', async () => {
    const res = await list(JEAN);

    expect(res.status).toBe(200);
    const page = bodyOf<Page>(res);
    expect(idsOf(page)).toEqual([ORDER_JEAN_2, ORDER_JEAN_1]);
    expect(page.next_cursor).toBeNull();
  });

  it('owner: sees all the flagged records of the organization (AC-2)', async () => {
    const page = bodyOf<Page>(await list(OWNER));

    expect(idsOf(page)).toEqual([ORDER_PAUL, ORDER_JEAN_2, ORDER_JEAN_1]);
  });

  it('corrected: an emptied issue no longer appears (AC-3)', async () => {
    await prisma.order.update({ where: { id: ORDER_JEAN_1 }, data: { syncIssue: null } });
    await prisma.order.update({ where: { id: ORDER_JEAN_2 }, data: { syncIssue: '' } });

    expect(idsOf(bodyOf<Page>(await list(JEAN)))).toEqual([]);
    expect(idsOf(bodyOf<Page>(await list(OWNER)))).toEqual([ORDER_PAUL]);
  });

  it('paging: pages follow without repeats and each item has its code and message (AC-4)', async () => {
    const first = bodyOf<Page>(await list(OWNER, '?limit=2'));
    expect(idsOf(first)).toEqual([ORDER_PAUL, ORDER_JEAN_2]);
    expect(first.next_cursor).toEqual(expect.any(String));

    const second = bodyOf<Page>(
      await list(OWNER, `?limit=2&cursor=${encodeURIComponent(first.next_cursor!)}`)
    );
    expect(idsOf(second)).toEqual([ORDER_JEAN_1]);
    expect(second.next_cursor).toBeNull();

    expect(first.items[0]).toEqual({
      table: 'orders',
      id: ORDER_PAUL,
      order_id: ORDER_PAUL,
      code: 'ARTICLE_REMOVED',
      message: 'ARTICLE_REMOVED: article retiré',
      created_at: at(30).toISOString(),
    });
    expect(first.items[1]).toMatchObject({ code: 'CREDIT_EXCEEDED' });
  });

  it('other business: nothing of another business appears (AB-1, WSTG-ATHZ-04)', async () => {
    const forA = [JEAN, PAUL, OWNER, DRIVER, CUSTOMER].map(async (person) =>
      bodyOf<Page>(await list(person))
    );
    for (const page of await Promise.all(forA)) {
      expect(idsOf(page)).not.toContain(ORDER_B);
    }
    expect(idsOf(bodyOf<Page>(await list(OWNER_B)))).toEqual([ORDER_B]);
  });

  it('delivered and assigned: records delivered by or assigned to the caller are listed', async () => {
    await seedOrder(ORDER_DELIVERED_BY_JEAN, REL_A, PAUL, 'LATE: livrée tard', at(60), {
      deliveredById: JEAN,
    });
    await prisma.delivery.create({
      data: {
        id: DELIVERY_DRIVER,
        orderId: ORDER_PAUL,
        assignedToId: DRIVER,
        syncIssue: 'Livraison déjà prise par Paul',
      },
    });
    await prisma.delivery.create({
      data: { id: DELIVERY_B, orderId: ORDER_B, assignedToId: OWNER_B, syncIssue: 'X: autre' },
    });

    const jean = bodyOf<Page>(await list(JEAN));
    expect(idsOf(jean)).toEqual([ORDER_DELIVERED_BY_JEAN, ORDER_JEAN_2, ORDER_JEAN_1]);

    const driver = bodyOf<Page>(await list(DRIVER));
    expect(driver.items).toEqual([
      {
        table: 'deliveries',
        id: DELIVERY_DRIVER,
        order_id: ORDER_PAUL,
        code: 'Livraison déjà prise par Paul',
        message: 'Livraison déjà prise par Paul',
        created_at: at(30).toISOString(),
      },
    ]);

    const owner = bodyOf<Page>(await list(OWNER));
    expect(idsOf(owner)).toEqual([
      ORDER_DELIVERED_BY_JEAN,
      ORDER_PAUL,
      DELIVERY_DRIVER,
      ORDER_JEAN_2,
      ORDER_JEAN_1,
    ]);
    expect(owner.items.map((i) => i.table).sort()).toEqual([
      'deliveries',
      'orders',
      'orders',
      'orders',
      'orders',
    ]);
    expect(idsOf(owner)).not.toContain(DELIVERY_B);
  });

  it('a person who left the business, and a customer, see nothing of it (AB-1)', async () => {
    await seedOrder(ORDER_FORMER, REL_A, FORMER, 'X: ancien', at(70));
    await seedOrder(ORDER_CUSTOMER, REL_A, CUSTOMER, 'X: client', at(80));

    expect(idsOf(bodyOf<Page>(await list(FORMER)))).toEqual([]);
    expect(idsOf(bodyOf<Page>(await list(CUSTOMER)))).toEqual([]);
  });

  it('a malformed query or cursor is a 400 VALIDATION_ERROR', async () => {
    for (const query of ['?limit=0', '?limit=101', '?limit=abc', '?cursor=%%%', '?other=1']) {
      const res = await list(JEAN, query);
      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/sync/issues');
    expect(res.status).toBe(401);
  });
});
