import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f5-0000-7000-8000-000000000001';
const MANAGER = '0199c0f5-0000-7000-8000-000000000002';
const SELLER = '0199c0f5-0000-7000-8000-000000000003';
const DRIVER = '0199c0f5-0000-7000-8000-000000000004';
const CUSTOMER = '0199c0f5-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c0f5-0000-7000-8000-000000000006';
const STRANGER = '0199c0f5-0000-7000-8000-000000000007';
const CUST_OWNER = '0199c0f5-0000-7000-8000-000000000008';
const CUST_MANAGER = '0199c0f5-0000-7000-8000-000000000009';
const CUST_SELLER = '0199c0f5-0000-7000-8000-00000000000a';

const SUPPLIER = '0199c0f5-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c0f5-0000-7000-8000-0000000000a2';
const CUST_ORG = '0199c0f5-0000-7000-8000-0000000000a3';

const REL = '0199c0f5-0000-7000-8000-0000000000e1';
const OTHER_REL = '0199c0f5-0000-7000-8000-0000000000e2';
const ORG_REL = '0199c0f5-0000-7000-8000-0000000000e3';

const ORDER = '0199c0f5-0000-7000-8000-0000000000b1';
const SALE = '0199c0f5-0000-7000-8000-000000000701';
const PAYMENT = '0199c0f5-0000-7000-8000-000000000702';
const ORG_PAYMENT = '0199c0f5-0000-7000-8000-000000000703';
const OTHER_PAYMENT = '0199c0f5-0000-7000-8000-000000000704';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Item = {
  id: string;
  kind: string;
  amount: number;
  balance_effect: number;
  mode: string | null;
  order_id: string | null;
  reverses_entry_id: string | null;
  note: string | null;
  occurred_at: string;
  recorded_by_id?: string;
  transaction_reference?: string;
};
type Page = { balance: number; items: Item[]; next_cursor: string | null };

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

async function seedMember(
  orgId: string,
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c0f5-0000-7000-8000-0000000004${n}f`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

/** Stores an entry and applies its effect to the relationship balance, as a gesture would. */
async function seedEntry(data: {
  id: string;
  relationshipId: string;
  kind: 'SALE' | 'PAYMENT';
  amount: bigint;
  recordedById: string;
  occurredAt: string;
  orderId?: string;
  mode?: 'CASH' | 'MOBILE_MONEY';
  transactionReference?: string;
  note?: string;
}) {
  const entry = await prisma.ledgerEntry.create({
    data: {
      id: data.id,
      customerRelationshipId: data.relationshipId,
      kind: data.kind,
      amount: data.amount,
      orderId: data.orderId ?? null,
      mode: data.mode ?? null,
      transactionReference: data.transactionReference ?? null,
      note: data.note ?? null,
      recordedById: data.recordedById,
      occurredAt: new Date(data.occurredAt),
    },
  });
  await prisma.customerRelationship.update({
    where: { id: data.relationshipId },
    data: { balance: { increment: entry.balanceEffect } },
  });
}

const supplierPath = (relationshipId = REL, orgId = SUPPLIER) =>
  `/api/v1/organizations/${orgId}/customers/${relationshipId}/ledger`;
const customerPath = (relationshipId = REL) => `/api/v1/suppliers/${relationshipId}/ledger`;
const orgCustomerPath = (relationshipId = ORG_REL, orgId = CUST_ORG) =>
  `/api/v1/organizations/${orgId}/suppliers/${relationshipId}/ledger`;

function read(personId: string, path: string) {
  return createAuthenticatedRequest(app, personId).get(path);
}

/**
 * Supplier with an owner, a manager, a seller and a driver. REL (customer person) has a SALE of
 * 30000 on day 1 and a mobile-money PAYMENT of 20000 on day 2, so it owes 10000. ORG_REL has the
 * business CUST_ORG as customer, with a manager and a seller; OTHER_REL belongs to OTHER_ORG.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600089001');
  await seedPerson(MANAGER, '+237600089002');
  await seedPerson(SELLER, '+237600089003');
  await seedPerson(DRIVER, '+237600089004');
  await seedPerson(CUSTOMER, '+237600089005');
  await seedPerson(OTHER_OWNER, '+237600089006');
  await seedPerson(STRANGER, '+237600089007');
  await seedPerson(CUST_OWNER, '+237600089008');
  await seedPerson(CUST_MANAGER, '+237600089009');
  await seedPerson(CUST_SELLER, '+237600089010');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: CUST_ORG, name: 'Customer', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, MANAGER, 'MANAGER', 2);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 5);
  await seedMember(CUST_ORG, CUST_OWNER, 'OWNER', 6);
  await seedMember(CUST_ORG, CUST_MANAGER, 'MANAGER', 7);
  await seedMember(CUST_ORG, CUST_SELLER, 'SELLER', 8);
  const base = { supplierOrganizationId: SUPPLIER, createdById: OWNER, status: 'ACTIVE' as const };
  await prisma.customerRelationship.create({
    data: { ...base, id: REL, customerPersonId: CUSTOMER },
  });
  await prisma.customerRelationship.create({
    data: { ...base, id: ORG_REL, customerOrganizationId: CUST_ORG },
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
  await prisma.$executeRaw`
    INSERT INTO orders (
      id, customer_relationship_id, placed_by_party, entered_by_id, total_amount, delivery_cost
    ) VALUES (${ORDER}::uuid, ${REL}::uuid, 'SUPPLIER', ${OWNER}::uuid, 30000, 30000)
  `;
  await seedEntry({
    id: SALE,
    relationshipId: REL,
    kind: 'SALE',
    amount: 30000n,
    recordedById: OWNER,
    occurredAt: '2026-02-01T10:00:00.000Z',
    orderId: ORDER,
  });
  await seedEntry({
    id: PAYMENT,
    relationshipId: REL,
    kind: 'PAYMENT',
    amount: 20000n,
    recordedById: SELLER,
    occurredAt: '2026-02-02T10:00:00.000Z',
    mode: 'MOBILE_MONEY',
    transactionReference: 'MM-REF-SECRET',
    note: 'first instalment',
  });
  await seedEntry({
    id: ORG_PAYMENT,
    relationshipId: ORG_REL,
    kind: 'PAYMENT',
    amount: 5000n,
    recordedById: SELLER,
    occurredAt: '2026-02-03T10:00:00.000Z',
    mode: 'CASH',
  });
  await seedEntry({
    id: OTHER_PAYMENT,
    relationshipId: OTHER_REL,
    kind: 'PAYMENT',
    amount: 7000n,
    recordedById: OTHER_OWNER,
    occurredAt: '2026-02-04T10:00:00.000Z',
    mode: 'CASH',
  });
});

describe('FIN-010 parties read the ledger of a relationship', () => {
  it('a SELLER reads two items newest first with balance 10000 (AC-1, C-23)', async () => {
    const response = await read(SELLER, supplierPath());

    expect(response.status).toBe(200);
    const body = bodyOf<Page>(response);
    expect(body.balance).toBe(10000);
    expect(body.next_cursor).toBeNull();
    expect(body.items.map((item) => item.id)).toEqual([PAYMENT, SALE]);
    expect(body.items[0]).toEqual({
      id: PAYMENT,
      kind: 'PAYMENT',
      amount: 20000,
      balance_effect: -20000,
      mode: 'MOBILE_MONEY',
      order_id: null,
      reverses_entry_id: null,
      note: 'first instalment',
      occurred_at: '2026-02-02T10:00:00.000Z',
    });
    expect(body.items[1]).toMatchObject({
      kind: 'SALE',
      amount: 30000,
      balance_effect: 30000,
      mode: null,
      order_id: ORDER,
    });
  });

  it('adds recorded_by_id for an OWNER and a MANAGER, not for a SELLER (Context, AC-1)', async () => {
    for (const person of [OWNER, MANAGER]) {
      const body = bodyOf<Page>(await read(person, supplierPath()));
      expect(body.items.map((item) => item.recorded_by_id)).toEqual([SELLER, OWNER]);
    }
    const seller = bodyOf<Page>(await read(SELLER, supplierPath()));
    expect(seller.items.every((item) => !('recorded_by_id' in item))).toBe(true);
  });

  it('the customer person reads the same two items without recorded_by_id (AC-2)', async () => {
    const response = await read(CUSTOMER, customerPath());

    expect(response.status).toBe(200);
    const body = bodyOf<Page>(response);
    expect(body.balance).toBe(10000);
    expect(body.items.map((item) => item.id)).toEqual([PAYMENT, SALE]);
    expect(body.items.every((item) => !('recorded_by_id' in item))).toBe(true);
  });

  it('a MANAGER of a customer business reads the ledger without recorded_by_id (Context)', async () => {
    for (const person of [CUST_OWNER, CUST_MANAGER]) {
      const response = await read(person, orgCustomerPath());
      expect(response.status).toBe(200);
      const body = bodyOf<Page>(response);
      expect(body.balance).toBe(-5000);
      expect(body.items.map((item) => item.id)).toEqual([ORG_PAYMENT]);
      expect(body.items.every((item) => !('recorded_by_id' in item))).toBe(true);
    }
  });

  it('pages one item at a time without repeats (AC-3)', async () => {
    const first = bodyOf<Page>(await read(SELLER, `${supplierPath()}?limit=1`));
    expect(first.items.map((item) => item.id)).toEqual([PAYMENT]);
    expect(first.next_cursor).not.toBeNull();

    const second = bodyOf<Page>(
      await read(SELLER, `${supplierPath()}?limit=1&cursor=${first.next_cursor}`)
    );
    expect(second.items.map((item) => item.id)).toEqual([SALE]);
    expect(second.next_cursor).toBeNull();
    expect(second.balance).toBe(10000);
  });

  it('answers 403 to a DRIVER of the supplier and a SELLER of the customer business (AC-4)', async () => {
    const driver = await read(DRIVER, supplierPath());
    expect(driver.status).toBe(403);
    expect(bodyOf<ErrorBody>(driver).error.code).toBe('FORBIDDEN');

    const seller = await read(CUST_SELLER, orgCustomerPath());
    expect(seller.status).toBe(403);
    expect(bodyOf<ErrorBody>(seller).error.code).toBe('FORBIDDEN');
  });

  it('answers 404 to another person as customer and to a member of another business (AC-4, AB-1)', async () => {
    const stranger = await read(STRANGER, customerPath());
    expect(stranger.status).toBe(404);
    expect(bodyOf<ErrorBody>(stranger).error.code).toBe('NOT_FOUND');

    // A member of another business, through their own organization and through the supplier's.
    expect((await read(OTHER_OWNER, supplierPath(REL, OTHER_ORG))).status).toBe(404);
    expect((await read(OTHER_OWNER, supplierPath(REL, SUPPLIER))).status).toBe(404);
    expect((await read(OTHER_OWNER, orgCustomerPath(REL, OTHER_ORG))).status).toBe(404);
  });

  it('keeps each side on its own route: no party reads through the wrong door (AB-1, WSTG-ATHZ-04)', async () => {
    // The supplier's owner is not the customer; the customer person is not the supplier.
    expect((await read(OWNER, orgCustomerPath(REL, SUPPLIER))).status).toBe(404);
    expect((await read(OWNER, customerPath(REL))).status).toBe(404);
    expect((await read(CUSTOMER, customerPath(OTHER_REL))).status).toBe(200);
    expect((await read(CUSTOMER, customerPath(ORG_REL))).status).toBe(404);
    // The customer business's manager cannot read the supplier-side list of the same relation.
    expect((await read(CUST_MANAGER, supplierPath(ORG_REL, CUST_ORG))).status).toBe(404);
    // An id from another relationship never leaks into the page.
    const body = bodyOf<Page>(await read(SELLER, supplierPath()));
    expect(body.items.map((item) => item.id)).not.toContain(OTHER_PAYMENT);
  });

  it('never shows transaction_reference, nor recorded_by_id to the customer (AB-2, CWE-200)', async () => {
    for (const response of [
      await read(CUSTOMER, customerPath()),
      await read(OWNER, supplierPath()),
      await read(SELLER, supplierPath()),
    ]) {
      expect(JSON.stringify(response.body)).not.toContain('transaction_reference');
      expect(JSON.stringify(response.body)).not.toContain('MM-REF-SECRET');
    }
    const customer = await read(CUSTOMER, customerPath());
    expect(JSON.stringify(customer.body)).not.toContain('recorded_by_id');
    expect(JSON.stringify(customer.body)).not.toContain(SELLER);
  });

  it('rejects a malformed id, an unknown query field and a bad limit with 400', async () => {
    expect((await read(SELLER, supplierPath('not-a-uuid'))).status).toBe(400);
    expect((await read(SELLER, `${supplierPath()}?foo=1`)).status).toBe(400);
    expect((await read(SELLER, `${supplierPath()}?limit=0`)).status).toBe(400);
    expect((await read(SELLER, `${supplierPath()}?limit=101`)).status).toBe(400);
    expect((await read(SELLER, `${supplierPath()}?cursor=garbage`)).status).toBe(400);
    expect((await read(CUSTOMER, customerPath('not-a-uuid'))).status).toBe(400);
  });

  it('requires authentication (v5.0.0-8.2.1)', async () => {
    const { default: request } = await import('supertest');
    expect((await request(app).get(supplierPath())).status).toBe(401);
    expect((await request(app).get(customerPath())).status).toBe(401);
    expect((await request(app).get(orgCustomerPath())).status).toBe(401);
  });
});
