import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f6-0000-7000-8000-000000000001';
const JEAN = '0199c0f6-0000-7000-8000-000000000002';
const PAUL = '0199c0f6-0000-7000-8000-000000000003';
const MANAGER = '0199c0f6-0000-7000-8000-000000000004';
const CUSTOMER = '0199c0f6-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c0f6-0000-7000-8000-000000000006';

const ORG = '0199c0f6-0000-7000-8000-0000000000c1';
const OTHER_ORG = '0199c0f6-0000-7000-8000-0000000000c2';
const REL = '0199c0f6-0000-7000-8000-0000000000d1';
const OTHER_REL = '0199c0f6-0000-7000-8000-0000000000d2';
const PRODUCT = '0199c0f6-0000-7000-8000-0000000000e1';

const REG = new Date('2026-01-01T00:00:00.000Z');
const DAY = 86_400_000;

let counter = 0;
/** A fresh UUIDv7-shaped id per call, so fixtures never collide. */
function nextId(): string {
  counter += 1;
  return `0199c0f6-0000-7000-8000-${String(counter).padStart(12, '1')}`;
}

const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

type Bucket = { count: number; amount: number };
type Item = {
  person_id: string;
  refunds: Bucket;
  credit_notes: Bucket;
  reversals: Bucket;
  expenses: Bucket;
  price_gaps: Bucket;
  abandoned_rests: Bucket;
};

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

function read(personId: string, query = '', org = ORG) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${org}/exceptions/money${query}`
  );
}

async function readItems(personId = OWNER, query = ''): Promise<Item[]> {
  const response = await read(personId, query);
  expect(response.status).toBe(200);
  return bodyOf<{ items: Item[] }>(response).items;
}

/** Stores a ledger entry recorded by `by` on a relationship. */
async function entry(
  by: string,
  kind: 'REFUND' | 'CREDIT_NOTE' | 'PAYMENT',
  amount: number,
  options: { at?: Date; reverses?: string; rel?: string; id?: string } = {}
): Promise<string> {
  const id = options.id ?? nextId();
  await prisma.ledgerEntry.create({
    data: {
      id,
      customerRelationshipId: options.rel ?? REL,
      kind,
      amount: BigInt(amount),
      mode: kind === 'CREDIT_NOTE' ? null : 'CASH',
      reversesEntryId: options.reverses,
      recordedById: by,
      occurredAt: options.at ?? daysAgo(1),
    },
  });
  return id;
}

async function expense(
  by: string,
  amount: number,
  options: { at?: Date; cancelledBy?: string; cancelledAt?: Date; org?: string } = {}
) {
  await prisma.expense.create({
    data: {
      id: nextId(),
      organizationId: options.org ?? ORG,
      paidById: by,
      amount: BigInt(amount),
      recordedById: by,
      occurredAt: options.at ?? daysAgo(1),
      cancelledAt: options.cancelledAt,
      cancelledById: options.cancelledBy,
    },
  });
}

type Line = {
  reference: number;
  applied: number;
  quantity: string;
  delivered?: string;
  by?: string;
  at?: Date;
};

/** Stores one supplier-entered order whose lines carry the given price changes, in one transaction. */
async function orderWithLines(lines: Line[], rel = REL) {
  const orderId = nextId();
  const amounts = lines.map((line) => {
    const quantityMilli = BigInt(Math.round(Number(line.delivered ?? line.quantity) * 1000));
    const product = quantityMilli * BigInt(line.applied);
    return (product + 500n) / 1000n;
  });
  const total = amounts.reduce((sum, amount) => sum + amount, 0n);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
      VALUES (${orderId}::uuid, ${rel}::uuid, 'SUPPLIER'::text::public."OrderParty", ${OWNER}::uuid,
        ${total}::bigint)
    `;
    for (const [index, line] of lines.entries()) {
      const changed = line.applied !== line.reference;
      await tx.$executeRaw`
        INSERT INTO order_lines (
          id, order_id, product_id, label_applied, quantity, delivered_quantity,
          reference_price, unit_price_applied, amount, price_set_by_id, price_set_at
        )
        VALUES (
          ${nextId()}::uuid, ${orderId}::uuid, ${PRODUCT}::uuid, 'Fixture Rice',
          ${line.quantity}::numeric, ${line.delivered ?? null}::numeric,
          ${line.reference}::bigint, ${line.applied}::bigint, ${amounts[index]}::bigint,
          ${changed ? (line.by ?? PAUL) : null}::uuid,
          ${changed ? (line.at ?? daysAgo(1)) : null}::timestamptz
        )
      `;
    }
  });
}

/**
 * One business with an owner, two collaborators (Jean the manager, Paul the seller) and a second
 * manager; REL is its registered customer. OTHER_ORG is another business with its own owner and
 * relationship, where Jean also works.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600090001');
  await seedPerson(JEAN, '+237600090002');
  await seedPerson(PAUL, '+237600090003');
  await seedPerson(MANAGER, '+237600090004');
  await seedPerson(CUSTOMER, '+237600090005');
  await seedPerson(OTHER_OWNER, '+237600090006');
  await prisma.organization.create({ data: { id: ORG, name: 'Business', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(ORG, OWNER, 'OWNER');
  await seedMember(ORG, JEAN, 'MANAGER');
  await seedMember(ORG, PAUL, 'SELLER');
  await seedMember(ORG, MANAGER, 'MANAGER');
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER');
  await seedMember(OTHER_ORG, JEAN, 'MANAGER');
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
  await seedProduct(prisma, {
    id: PRODUCT,
    organizationId: ORG,
    name: 'Fixture Rice',
    unit: 'sack',
    price: 3200n,
  });
});

describe('FIN-019 owner reads the money exceptions', () => {
  it('groups the gestures by person, largest total first (AC-1)', async () => {
    await entry(JEAN, 'REFUND', 1000);
    await entry(JEAN, 'REFUND', 2000);
    await expense(JEAN, 500);
    await orderWithLines(
      Array.from({ length: 12 }, () => ({ reference: 3200, applied: 3000, quantity: '1' }))
    );

    const items = await readItems();

    expect(items).toEqual([
      {
        person_id: JEAN,
        refunds: { count: 2, amount: 3000 },
        credit_notes: { count: 0, amount: 0 },
        reversals: { count: 0, amount: 0 },
        expenses: { count: 1, amount: 500 },
        price_gaps: { count: 0, amount: 0 },
        abandoned_rests: { count: 0, amount: 0 },
      },
      {
        person_id: PAUL,
        refunds: { count: 0, amount: 0 },
        credit_notes: { count: 0, amount: 0 },
        reversals: { count: 0, amount: 0 },
        expenses: { count: 0, amount: 0 },
        price_gaps: { count: 12, amount: 2400 },
        abandoned_rests: { count: 0, amount: 0 },
      },
    ]);
  });

  it('counts a credit note and leaves a person without gestures out (AC-1)', async () => {
    await entry(JEAN, 'CREDIT_NOTE', 700);
    await entry(JEAN, 'PAYMENT', 9000);

    const items = await readItems();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      person_id: JEAN,
      credit_notes: { count: 1, amount: 700 },
      refunds: { count: 0, amount: 0 },
    });
  });

  it('never lists the owner own gestures (AC-2)', async () => {
    await entry(OWNER, 'REFUND', 1000);
    await expense(OWNER, 400);
    await orderWithLines([{ reference: 3200, applied: 3000, quantity: '2', by: OWNER }]);

    expect(await readItems()).toEqual([]);
  });

  it('ignores a gesture older than from and one after to (AC-3)', async () => {
    await entry(JEAN, 'REFUND', 1000, { at: daysAgo(20) });
    await entry(JEAN, 'REFUND', 2000, { at: daysAgo(10) });

    expect(await readItems()).toEqual([]);

    const items = await readItems(OWNER, `?from=${isoDate(daysAgo(12))}&to=${isoDate(daysAgo(8))}`);
    expect(items).toHaveLength(1);
    expect(items[0]?.refunds).toEqual({ count: 1, amount: 2000 });
  });

  it('includes the whole last day of the period (AC-3)', async () => {
    const day = '2026-03-10';
    await entry(JEAN, 'REFUND', 1000, { at: new Date(`${day}T23:59:59.000Z`) });
    await entry(JEAN, 'REFUND', 3000, { at: new Date('2026-03-11T00:00:00.000Z') });

    const items = await readItems(OWNER, `?from=${day}&to=${day}`);
    expect(items[0]?.refunds).toEqual({ count: 1, amount: 1000 });
  });

  it('dates a cancellation by cancelled_at and a price gap by price_set_at (AC-3)', async () => {
    await expense(JEAN, 800, {
      at: daysAgo(30),
      cancelledBy: MANAGER,
      cancelledAt: daysAgo(1),
    });
    await orderWithLines([{ reference: 3200, applied: 3000, quantity: '1', at: daysAgo(30) }]);

    const items = await readItems();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      person_id: MANAGER,
      reversals: { count: 1, amount: 800 },
      expenses: { count: 0, amount: 0 },
    });
  });

  it.each([
    ['a MANAGER caller', MANAGER, '', 403],
    ['a SELLER caller', PAUL, '', 403],
    ['a period of 93 days', OWNER, '?from=2026-01-01&to=2026-04-04', 400],
    ['from after to', OWNER, '?from=2026-03-10&to=2026-03-09', 400],
    ['a period of 92 days', OWNER, '?from=2026-01-01&to=2026-04-03', 200],
    ['a malformed date', OWNER, '?from=yesterday', 400],
    ['an impossible date', OWNER, '?from=2026-02-30&to=2026-03-01', 400],
    ['an unknown query field', OWNER, '?person=x', 400],
  ])('answers for %s (AC-4)', async (_name, who, query, status) => {
    const response = await read(who, query);
    expect(response.status).toBe(status);
    if (status === 400) {
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    if (status === 403) expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('values a price gap at 1400 for 3000 against 3200, quantity 7 (AC-5)', async () => {
    await orderWithLines([{ reference: 3200, applied: 3000, quantity: '7' }]);

    const items = await readItems();
    expect(items[0]?.price_gaps).toEqual({ count: 1, amount: 1400 });
  });

  it('uses the delivered quantity and rounds half up like a line (AC-5)', async () => {
    await orderWithLines([
      { reference: 3200, applied: 3000, quantity: '7', delivered: '5' },
      { reference: 3001, applied: 3000, quantity: '0.5' },
    ]);

    const items = await readItems();
    // 200 x 5 = 1000, and 1 x 0.5 rounds up to 1.
    expect(items[0]?.price_gaps).toEqual({ count: 2, amount: 1001 });
  });

  it('does not count a price raised above the reference (AC-5)', async () => {
    await orderWithLines([{ reference: 3000, applied: 3500, quantity: '2' }]);

    expect(await readItems()).toEqual([]);
  });

  it('keeps the refund and the later reversal under the same name (AB-1, CWE-778)', async () => {
    const refund = await entry(JEAN, 'REFUND', 1500);
    await entry(JEAN, 'REFUND', 1500, { reverses: refund });

    const items = await readItems();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      person_id: JEAN,
      refunds: { count: 1, amount: 1500 },
      reversals: { count: 1, amount: 1500 },
    });
  });

  it('counts cancelled expenses and handovers under the canceller (AB-1)', async () => {
    await expense(PAUL, 300, { cancelledBy: JEAN, cancelledAt: daysAgo(1) });
    await prisma.handover.create({
      data: {
        id: nextId(),
        organizationId: ORG,
        fromPersonId: PAUL,
        toPersonId: JEAN,
        amount: 1200n,
        occurredAt: daysAgo(2),
        cancelledAt: daysAgo(1),
        cancelledById: JEAN,
      },
    });

    const items = await readItems();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      person_id: JEAN,
      reversals: { count: 2, amount: 1500 },
      expenses: { count: 0, amount: 0 },
    });
  });

  it('leaves out what a person did in another business (AB-2)', async () => {
    await entry(JEAN, 'REFUND', 4000, { rel: OTHER_REL });
    await expense(JEAN, 900, { org: OTHER_ORG });

    expect(await readItems()).toEqual([]);
    const response = await read(OTHER_OWNER, '', OTHER_ORG);
    const own = bodyOf<{ items: Item[] }>(response).items;
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      person_id: JEAN,
      refunds: { count: 1, amount: 4000 },
      expenses: { count: 1, amount: 900 },
    });
  });

  it('answers 404 to a member of another business (AB-2, WSTG-ATHZ-04)', async () => {
    await entry(PAUL, 'REFUND', 1000);

    const response = await read(OTHER_OWNER, '', ORG);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('exposes only person ids and totals (v5.0.0-8.2.3)', async () => {
    await entry(JEAN, 'REFUND', 1000);

    const [item] = await readItems();

    expect(Object.keys(item ?? {}).sort()).toEqual(
      [
        'abandoned_rests',
        'credit_notes',
        'expenses',
        'person_id',
        'price_gaps',
        'refunds',
        'reversals',
      ].sort()
    );
    expect(Object.keys(item?.refunds ?? {}).sort()).toEqual(['amount', 'count']);
  });
});
