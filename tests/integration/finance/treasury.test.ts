import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f7-0000-7000-8000-000000000001';
const MANAGER = '0199c0f7-0000-7000-8000-000000000002';
const SELLER = '0199c0f7-0000-7000-8000-000000000003';
const DRIVER = '0199c0f7-0000-7000-8000-000000000004';
const CUSTOMER = '0199c0f7-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c0f7-0000-7000-8000-000000000006';
const SUPPLIER_OWNER = '0199c0f7-0000-7000-8000-000000000007';

const ORG = '0199c0f7-0000-7000-8000-0000000000c1';
const OTHER_ORG = '0199c0f7-0000-7000-8000-0000000000c2';
const SUPPLIER_ORG = '0199c0f7-0000-7000-8000-0000000000c3';
const REL = '0199c0f7-0000-7000-8000-0000000000d1';
const OTHER_REL = '0199c0f7-0000-7000-8000-0000000000d2';
// ORG buys from SUPPLIER_ORG: ORG is the customer of this relationship.
const SUPPLIER_REL = '0199c0f7-0000-7000-8000-0000000000d3';

const REG = new Date('2026-01-01T00:00:00.000Z');
const DAY = 86_400_000;

let counter = 0;
/** A fresh UUIDv7-shaped id per call, so fixtures never collide. */
function nextId(): string {
  counter += 1;
  return `0199c0f7-0000-7000-8000-${String(counter).padStart(12, '1')}`;
}

const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

type Treasury = { inflows: number; outflows: number; net: number };
type ExpenseItem = {
  id: string;
  amount: number;
  cancelled: boolean;
  cancelled_at: string | null;
};
type Page = { items: ExpenseItem[]; next_cursor: string | null };

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
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER'
) {
  await prisma.collaboration.create({
    data: {
      id: nextId(),
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

function readTreasury(personId: string, query = '', org = ORG) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${org}/treasury${query}`
  );
}

async function treasury(query = '', personId = OWNER): Promise<Treasury> {
  const response = await readTreasury(personId, query);
  expect(response.status).toBe(200);
  return bodyOf<Treasury>(response);
}

function readExpenses(personId: string, query = '', org = ORG) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${org}/expenses${query}`
  );
}

/** Stores a ledger entry on a relationship; `reverses` makes it the mirror of another entry. */
async function entry(
  kind: 'PAYMENT' | 'REFUND' | 'SALE' | 'CREDIT_NOTE' | 'OPENING_BALANCE',
  amount: number,
  options: { at?: Date; reverses?: string; rel?: string; by?: string; orderId?: string } = {}
): Promise<string> {
  const id = nextId();
  const hasMode = kind === 'PAYMENT' || kind === 'REFUND';
  await prisma.ledgerEntry.create({
    data: {
      id,
      customerRelationshipId: options.rel ?? REL,
      kind,
      amount: BigInt(amount),
      mode: hasMode ? 'CASH' : null,
      orderId: options.orderId,
      reversesEntryId: options.reverses,
      recordedById: options.by ?? OWNER,
      occurredAt: options.at ?? daysAgo(1),
    },
  });
  return id;
}

async function expense(
  amount: number,
  options: { at?: Date; cancelled?: boolean; org?: string; by?: string } = {}
): Promise<string> {
  const id = nextId();
  const by = options.by ?? OWNER;
  await prisma.expense.create({
    data: {
      id,
      organizationId: options.org ?? ORG,
      paidById: by,
      amount: BigInt(amount),
      recordedById: by,
      occurredAt: options.at ?? daysAgo(1),
      cancelledAt: options.cancelled ? daysAgo(0) : undefined,
      cancelledById: options.cancelled ? by : undefined,
    },
  });
  return id;
}

/**
 * ORG is a business with an owner, a manager, a seller and a driver; REL is its customer. It also
 * buys from SUPPLIER_ORG (SUPPLIER_REL, ORG being the customer). OTHER_ORG is another business.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600091001');
  await seedPerson(MANAGER, '+237600091002');
  await seedPerson(SELLER, '+237600091003');
  await seedPerson(DRIVER, '+237600091004');
  await seedPerson(CUSTOMER, '+237600091005');
  await seedPerson(OTHER_OWNER, '+237600091006');
  await seedPerson(SUPPLIER_OWNER, '+237600091007');
  await prisma.organization.create({ data: { id: ORG, name: 'Business', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await prisma.organization.create({
    data: { id: SUPPLIER_ORG, name: 'Supplier', status: 'ACTIVE' },
  });
  await seedMember(ORG, OWNER, 'OWNER');
  await seedMember(ORG, MANAGER, 'MANAGER');
  await seedMember(ORG, SELLER, 'SELLER');
  await seedMember(ORG, DRIVER, 'DRIVER');
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER');
  await seedMember(SUPPLIER_ORG, SUPPLIER_OWNER, 'OWNER');
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: ORG,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
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
  await prisma.customerRelationship.create({
    data: {
      id: SUPPLIER_REL,
      supplierOrganizationId: SUPPLIER_ORG,
      customerOrganizationId: ORG,
      createdById: SUPPLIER_OWNER,
      status: 'ACTIVE',
    },
  });
});

describe('FIN-020 owner reads the treasury', () => {
  it('adds payments and refunds as inflows and outflows with the expenses (AC-1)', async () => {
    await entry('PAYMENT', 50_000);
    await entry('PAYMENT', 20_000);
    await entry('REFUND', 5000);
    await expense(8000);

    expect(await treasury()).toEqual({ inflows: 70_000, outflows: 13_000, net: 57_000 });
  });

  it('counts the other side of a relationship where the organization is the customer (AC-1)', async () => {
    await entry('PAYMENT', 30_000, { rel: SUPPLIER_REL }); // ORG paid its supplier: outflow
    await entry('REFUND', 4000, { rel: SUPPLIER_REL }); // its supplier refunded ORG: inflow

    expect(await treasury()).toEqual({ inflows: 4000, outflows: 30_000, net: -26_000 });
  });

  it('does not count sales, credit notes or opening balances as money (AC-1)', async () => {
    await entry('OPENING_BALANCE', 9000);
    await entry('CREDIT_NOTE', 1000);
    const orderId = nextId();
    await prisma.$executeRaw`
      INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount, delivery_cost)
      VALUES (${orderId}::uuid, ${REL}::uuid, 'SUPPLIER'::text::public."OrderParty", ${OWNER}::uuid, 4000::bigint, 4000::bigint)
    `;
    await entry('SALE', 4000, { orderId });

    expect(await treasury()).toEqual({ inflows: 0, outflows: 0, net: 0 });
  });

  it('subtracts a reversed payment, refund and nothing for a cancelled expense (AC-2)', async () => {
    await entry('PAYMENT', 50_000);
    const reversed = await entry('PAYMENT', 20_000);
    await entry('PAYMENT', 20_000, { reverses: reversed });
    const refund = await entry('REFUND', 6000);
    await entry('REFUND', 6000, { reverses: refund });
    await expense(3000);
    await expense(7000, { cancelled: true });

    expect(await treasury()).toEqual({ inflows: 50_000, outflows: 3000, net: 47_000 });
  });

  it('keeps only the period, the whole last day included (AC-1)', async () => {
    await entry('PAYMENT', 1000, { at: new Date('2026-03-10T23:59:59.000Z') });
    await entry('PAYMENT', 2000, { at: new Date('2026-03-11T00:00:00.000Z') });
    await entry('PAYMENT', 4000, { at: new Date('2026-03-09T23:59:59.000Z') });
    await expense(500, { at: new Date('2026-03-10T12:00:00.000Z') });
    await expense(900, { at: new Date('2026-03-11T12:00:00.000Z') });

    expect(await treasury('?from=2026-03-10&to=2026-03-10')).toEqual({
      inflows: 1000,
      outflows: 500,
      net: 500,
    });
  });

  it('reads the last 7 days when no period is given (AC-1)', async () => {
    await entry('PAYMENT', 1000, { at: daysAgo(2) });
    await entry('PAYMENT', 2000, { at: daysAgo(20) });

    expect((await treasury()).inflows).toBe(1000);
  });

  it('ignores another business money (AB-1)', async () => {
    await entry('PAYMENT', 9999, { rel: OTHER_REL, by: OTHER_OWNER });
    await expense(777, { org: OTHER_ORG, by: OTHER_OWNER });
    await entry('PAYMENT', 100);

    expect(await treasury()).toEqual({ inflows: 100, outflows: 0, net: 100 });
  });

  it('lets a manager read it (AC-4)', async () => {
    await entry('PAYMENT', 100);
    expect((await treasury('', MANAGER)).inflows).toBe(100);
  });

  it.each([
    ['a SELLER caller', SELLER, '', 403],
    ['a DRIVER caller', DRIVER, '', 403],
    ['a period of 93 days', OWNER, '?from=2026-01-01&to=2026-04-04', 400],
    ['a period of 92 days', OWNER, '?from=2026-01-01&to=2026-04-03', 200],
    ['from after to', OWNER, '?from=2026-03-10&to=2026-03-09', 400],
    ['a malformed date', OWNER, '?from=yesterday', 400],
    ['an unknown query field', OWNER, '?person=x', 400],
  ])('answers for %s (AC-4)', async (_name, who, query, status) => {
    const response = await readTreasury(who, query);
    expect(response.status).toBe(status);
    if (status === 400) {
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    if (status === 403) expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('answers 401 without a token', async () => {
    const response = await request(app).get(`/api/v1/organizations/${ORG}/treasury`);
    expect(response.status).toBe(401);
  });

  it('answers 404 to a member of another business and to a stranger (AB-1)', async () => {
    await entry('PAYMENT', 100);
    const asOtherOwner = await readTreasury(OTHER_OWNER);
    expect(asOtherOwner.status).toBe(404);
    expect(bodyOf<ErrorBody>(asOtherOwner).error.code).toBe('NOT_FOUND');
    expect((await readTreasury(CUSTOMER)).status).toBe(404);
  });
});

describe('FIN-020 owner reads the expenses', () => {
  it('lists newest first with cancelled ones flagged (AC-3)', async () => {
    const oldest = await expense(100, { at: daysAgo(3) });
    const cancelled = await expense(200, { at: daysAgo(2), cancelled: true });
    const newest = await expense(300, { at: daysAgo(1) });
    await expense(999, { org: OTHER_ORG, by: OTHER_OWNER });

    const response = await readExpenses(OWNER);

    expect(response.status).toBe(200);
    const page = bodyOf<Page>(response);
    expect(page.items.map((item) => item.id)).toEqual([newest, cancelled, oldest]);
    expect(page.items.map((item) => item.cancelled)).toEqual([false, true, false]);
    expect(page.items[1]?.cancelled_at).not.toBeNull();
    expect(page.items[0]?.cancelled_at).toBeNull();
    expect(page.next_cursor).toBeNull();
  });

  it('pages with limit and cursor without repeating or missing a row (AC-3)', async () => {
    const ids: string[] = [];
    for (let day = 5; day >= 1; day -= 1) ids.push(await expense(day * 10, { at: daysAgo(day) }));
    ids.reverse(); // newest first

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const response = await readExpenses(MANAGER, query);
      expect(response.status).toBe(200);
      const page = bodyOf<Page>(response);
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toEqual(ids);
  });

  it('filters by from and to on the occurrence date (AC-3)', async () => {
    await expense(100, { at: daysAgo(20) });
    const inside = await expense(200, { at: daysAgo(10) });
    await expense(300, { at: daysAgo(2) });

    const response = await readExpenses(
      OWNER,
      `?from=${isoDate(daysAgo(12))}&to=${isoDate(daysAgo(8))}`
    );

    expect(bodyOf<Page>(response).items.map((item) => item.id)).toEqual([inside]);
  });

  it.each([
    ['a SELLER caller', SELLER, '', 403],
    ['a DRIVER caller', DRIVER, '', 403],
    ['a limit of 101', OWNER, '?limit=101', 400],
    ['a malformed cursor', OWNER, '?cursor=garbage', 400],
    ['a malformed date', OWNER, '?from=yesterday', 400],
    ['from after to', OWNER, '?from=2026-03-10&to=2026-03-09', 400],
    ['an unknown query field', OWNER, '?person=x', 400],
  ])('answers for %s (AC-4)', async (_name, who, query, status) => {
    const response = await readExpenses(who, query);
    expect(response.status).toBe(status);
  });

  it('answers 404 to a member of another business (AB-1)', async () => {
    await expense(100);
    const response = await readExpenses(OTHER_OWNER);
    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });
});
