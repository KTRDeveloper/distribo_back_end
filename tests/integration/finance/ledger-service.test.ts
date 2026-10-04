import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { appendLedgerEntry, reverseLedgerEntry } from '../../../src/modules/finance/ledger.service';
import type { LedgerInput } from '../../../src/modules/finance/ledger.service';

const ORG_ID = '0199c017-0000-7000-8000-000000000001';
const OWNER_ID = '0199c017-0000-7000-8000-000000000011';
const COLLAB_ID = '0199c017-0000-7000-8000-000000000012';
const CUSTOMER_ID = '0199c017-0000-7000-8000-000000000013';
const OUTSIDER_ID = '0199c017-0000-7000-8000-000000000014';
const REL_ID = '0199c017-0000-7000-8000-000000000021';
const DUPLICATE_REL_ID = '0199c017-0000-7000-8000-000000000022';
const ORDER_ID = '0199c017-0000-7000-8000-000000000041';
const MISSING_ID = '0199c017-0000-7000-8000-0000000000ff';

let sequence = 0;
/** Returns a fresh UUID for a ledger entry of the fixture. */
function entryId(): string {
  sequence += 1;
  return `0199c017-0000-7000-8000-${String(100 + sequence).padStart(12, '0')}`;
}

function input(overrides: Partial<LedgerInput> = {}): LedgerInput {
  return {
    id: entryId(),
    relationshipId: REL_ID,
    kind: 'OPENING_BALANCE',
    amount: 10000n,
    recordedById: COLLAB_ID,
    organizationId: ORG_ID,
    occurredAt: new Date('2026-10-01T10:00:00.000Z'),
    ...overrides,
  };
}

async function balance(id = REL_ID): Promise<bigint> {
  const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id } });
  return row.balance;
}

async function held(personId = COLLAB_ID): Promise<bigint> {
  const row = await prisma.collaboration.findFirstOrThrow({
    where: { personId, organizationId: ORG_ID },
  });
  return row.amountHeld;
}

async function entryCount(): Promise<number> {
  return prisma.ledgerEntry.count();
}

beforeEach(async () => {
  const registered = {
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700017011', ...registered },
      { id: COLLAB_ID, fullName: 'Fixture Collab', phoneNumber: '+2250700017012', ...registered },
      { id: CUSTOMER_ID, fullName: 'Fixture Client', phoneNumber: '+2250700017013', ...registered },
      { id: OUTSIDER_ID, fullName: 'Fixture Other', phoneNumber: '+2250700017014', ...registered },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Supplier')
  `;
  await prisma.collaboration.createMany({
    data: [
      {
        id: '0199c017-0000-7000-8000-000000000031',
        personId: OWNER_ID,
        organizationId: ORG_ID,
        role: 'OWNER',
        status: 'ACTIVE',
      },
      {
        id: '0199c017-0000-7000-8000-000000000032',
        personId: COLLAB_ID,
        organizationId: ORG_ID,
        role: 'MANAGER',
        status: 'ACTIVE',
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, customer_person_id, created_by_id
    ) VALUES (${REL_ID}::uuid, ${ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO orders (
      id, customer_relationship_id, placed_by_party, entered_by_id, total_amount, delivery_cost
    ) VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'SUPPLIER', ${OWNER_ID}::uuid, 10000, 10000)
  `;
});

describe('appendLedgerEntry cache effects (AC-1, C-37, CM-17)', () => {
  const rows: Array<{
    kind: LedgerInput['kind'];
    mode?: 'CASH';
    orderId?: string;
    balance: bigint;
    held: bigint;
  }> = [
    { kind: 'SALE', orderId: ORDER_ID, balance: 10000n, held: 0n },
    { kind: 'PAYMENT', mode: 'CASH', balance: -10000n, held: 10000n },
    { kind: 'REFUND', mode: 'CASH', balance: 10000n, held: -10000n },
    { kind: 'CREDIT_NOTE', balance: -10000n, held: 0n },
    { kind: 'OPENING_BALANCE', balance: 10000n, held: 0n },
  ];

  it.each(rows)('moves the caches for a $kind', async (row) => {
    const entry = await prisma.$transaction((tx) =>
      appendLedgerEntry(tx, input({ kind: row.kind, mode: row.mode, orderId: row.orderId }))
    );
    expect(entry.balanceEffect).toBe(row.balance);
    expect(await balance()).toBe(row.balance);
    expect(await held()).toBe(row.held);
    expect(await held(OWNER_ID)).toBe(0n);
  });

  it('stores the given fields on the entry', async () => {
    const id = entryId();
    const entry = await prisma.$transaction((tx) =>
      appendLedgerEntry(
        tx,
        input({
          id,
          kind: 'PAYMENT',
          mode: 'MOBILE_MONEY',
          transactionReference: 'REF-1',
          note: 'first',
        })
      )
    );
    expect(entry).toMatchObject({
      id,
      customerRelationshipId: REL_ID,
      kind: 'PAYMENT',
      amount: 10000n,
      mode: 'MOBILE_MONEY',
      transactionReference: 'REF-1',
      note: 'first',
      recordedById: COLLAB_ID,
      reversesEntryId: null,
    });
  });
});

describe('reverseLedgerEntry (AC-2)', () => {
  it('mirrors a PAYMENT: balance up, amount held down', async () => {
    const payment = await prisma.$transaction((tx) =>
      appendLedgerEntry(tx, input({ kind: 'PAYMENT', mode: 'CASH', note: 'x' }))
    );
    const id = entryId();
    const reversal = await prisma.$transaction((tx) =>
      reverseLedgerEntry(tx, payment.id, { id, recordedById: COLLAB_ID, note: 'oops' })
    );
    expect(reversal).toMatchObject({
      id,
      reversesEntryId: payment.id,
      customerRelationshipId: REL_ID,
      kind: 'PAYMENT',
      amount: 10000n,
      mode: 'CASH',
      balanceEffect: 10000n,
      note: 'oops',
    });
    expect(await balance()).toBe(0n);
    expect(await held()).toBe(0n);
  });

  it('mirrors a REFUND: balance down, amount held up', async () => {
    const refund = await prisma.$transaction((tx) =>
      appendLedgerEntry(tx, input({ kind: 'REFUND', mode: 'CASH' }))
    );
    await prisma.$transaction((tx) =>
      reverseLedgerEntry(tx, refund.id, { id: entryId(), recordedById: COLLAB_ID })
    );
    expect(await balance()).toBe(0n);
    expect(await held()).toBe(0n);
  });

  it('keeps the order of a reversed SALE and leaves the held money alone', async () => {
    const sale = await prisma.$transaction((tx) =>
      appendLedgerEntry(tx, input({ kind: 'SALE', orderId: ORDER_ID }))
    );
    const reversal = await prisma.$transaction((tx) =>
      reverseLedgerEntry(tx, sale.id, { id: entryId(), recordedById: COLLAB_ID })
    );
    expect(reversal.orderId).toBe(ORDER_ID);
    expect(await balance()).toBe(0n);
    expect(await held()).toBe(0n);
  });

  it('answers 404 NOT_FOUND for an unknown entry', async () => {
    await expect(
      prisma.$transaction((tx) =>
        reverseLedgerEntry(tx, MISSING_ID, { id: entryId(), recordedById: COLLAB_ID })
      )
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(await entryCount()).toBe(0);
  });
});

describe('simultaneous writes (AC-3, AB-1, CWE-362)', () => {
  it('keeps all 20 payments of 100', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.$transaction((tx) =>
          appendLedgerEntry(tx, input({ kind: 'PAYMENT', mode: 'CASH', amount: 100n }))
        )
      )
    );
    expect(await balance()).toBe(-2000n);
    expect(await held()).toBe(2000n);
    expect(await entryCount()).toBe(20);
  });

  it('keeps both effects when two transactions read the balance first', async () => {
    // Both transactions read the balance before either writes.
    const openings = (amount: bigint) =>
      prisma.$transaction(async (tx) => {
        await tx.customerRelationship.findUniqueOrThrow({ where: { id: REL_ID } });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await appendLedgerEntry(tx, input({ amount }));
      });
    await Promise.all([openings(300n), openings(500n)]);
    expect(await balance()).toBe(800n);
  });
});

describe('atomicity (AC-4, v5.0.0-2.3.3)', () => {
  it('leaves no entry and no balance change when the held update fails', async () => {
    await expect(
      prisma.$transaction((tx) =>
        appendLedgerEntry(tx, input({ kind: 'PAYMENT', mode: 'CASH', recordedById: OUTSIDER_ID }))
      )
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(await entryCount()).toBe(0);
    expect(await balance()).toBe(0n);
    expect(await held()).toBe(0n);
  });
});

describe('merged relationship (AC-5)', () => {
  it('writes the entry on the surviving relationship', async () => {
    await prisma.$executeRaw`
      INSERT INTO customer_relationships (
        id, supplier_organization_id, customer_person_id, created_by_id,
        deleted_at, merged_into_id
      ) VALUES (
        ${DUPLICATE_REL_ID}::uuid, ${ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid,
        now(), ${REL_ID}::uuid
      )
    `;
    const entry = await prisma.$transaction((tx) =>
      appendLedgerEntry(tx, input({ relationshipId: DUPLICATE_REL_ID }))
    );
    expect(entry.customerRelationshipId).toBe(REL_ID);
    expect(await balance()).toBe(10000n);
    expect(await balance(DUPLICATE_REL_ID)).toBe(0n);
  });
});

describe('input checks', () => {
  it('rejects an unknown relationship with 404 NOT_FOUND', async () => {
    await expect(
      prisma.$transaction((tx) => appendLedgerEntry(tx, input({ relationshipId: MISSING_ID })))
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(await entryCount()).toBe(0);
  });

  it.each([
    ['a zero amount', { amount: 0n }],
    ['a negative amount', { amount: -5n }],
    ['a PAYMENT without a mode', { kind: 'PAYMENT' as const }],
    ['a SALE with a mode', { kind: 'SALE' as const, orderId: ORDER_ID, mode: 'CASH' as const }],
  ])('rejects %s with 400 VALIDATION_ERROR before any write', async (_name, overrides) => {
    await expect(
      prisma.$transaction((tx) => appendLedgerEntry(tx, input(overrides)))
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(await entryCount()).toBe(0);
    expect(await balance()).toBe(0n);
  });
});
