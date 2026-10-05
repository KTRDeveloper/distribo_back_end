import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const OWNER = '0199e007-0000-7000-8000-000000000001';
const MANAGER = '0199e007-0000-7000-8000-000000000002';
const SELLER = '0199e007-0000-7000-8000-000000000003';
const DRIVER = '0199e007-0000-7000-8000-000000000004';
const CUSTOMER = '0199e007-0000-7000-8000-000000000005';
const OWNER_B = '0199e007-0000-7000-8000-000000000006';
const CUSTOMER_B = '0199e007-0000-7000-8000-000000000007';
const ORG_A = '0199e007-0000-7000-8000-0000000000a1';
const ORG_B = '0199e007-0000-7000-8000-0000000000b1';
const REL_A = '0199e007-0000-7000-8000-0000000000c1';
const REL_B = '0199e007-0000-7000-8000-0000000000c2';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

const LEDGER = {
  recent: '0199e007-0000-7000-8000-000000000101',
  old: '0199e007-0000-7000-8000-000000000102',
  orgB: '0199e007-0000-7000-8000-000000000103',
} as const;
const EXPENSE = {
  recent: '0199e007-0000-7000-8000-000000000201',
  old: '0199e007-0000-7000-8000-000000000202',
  cancelledRecently: '0199e007-0000-7000-8000-000000000203',
  orgB: '0199e007-0000-7000-8000-000000000204',
} as const;
const HANDOVER = {
  sellerToManager: '0199e007-0000-7000-8000-000000000301',
  driverToOwner: '0199e007-0000-7000-8000-000000000302',
  managerToOwner: '0199e007-0000-7000-8000-000000000303',
  old: '0199e007-0000-7000-8000-000000000304',
  orgB: '0199e007-0000-7000-8000-000000000305',
} as const;
const LIMIT = {
  recent: '0199e007-0000-7000-8000-000000000401',
  old: '0199e007-0000-7000-8000-000000000402',
  orgB: '0199e007-0000-7000-8000-000000000403',
} as const;
const NOTE = {
  owner: '0199e007-0000-7000-8000-000000000501',
  ownerOldRead: '0199e007-0000-7000-8000-000000000502',
  ownerOldUnread: '0199e007-0000-7000-8000-000000000503',
  seller: '0199e007-0000-7000-8000-000000000504',
  customerB: '0199e007-0000-7000-8000-000000000505',
} as const;

type Rows = Array<Record<string, unknown>>;
type Changes = { created: Rows; updated: Rows; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const pull = (personId: string, query = '') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/sync/pull${query}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const idsOf = (rows: Rows) => rows.map((r) => r['id'] as string).sort();
const sorted = (ids: string[]) => [...ids].sort();

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

async function seedCollaboration(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e007-0000-7000-8000-0000000009${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

async function seedLedger(id: string, relationshipId: string, recordedById: string, at: Date) {
  await prisma.ledgerEntry.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      kind: 'PAYMENT',
      mode: 'MOBILE_MONEY',
      amount: 7000n,
      transactionReference: 'ref-secret-1',
      note: 'acompte',
      recordedById,
      occurredAt: at,
    },
  });
}

async function seedExpense(
  id: string,
  organizationId: string,
  paidById: string,
  occurredAt: Date,
  cancelledAt?: Date
) {
  await prisma.expense.create({
    data: {
      id,
      organizationId,
      paidById,
      amount: 2500n,
      category: 'fuel',
      recordedById: paidById,
      occurredAt,
      cancelledAt: cancelledAt ?? null,
      cancelledById: cancelledAt ? paidById : null,
    },
  });
}

async function seedHandover(
  id: string,
  organizationId: string,
  fromPersonId: string,
  toPersonId: string,
  occurredAt: Date
) {
  await prisma.handover.create({
    data: { id, organizationId, fromPersonId, toPersonId, amount: 9000n, occurredAt },
  });
}

async function seedLimit(id: string, relationshipId: string, setById: string, setAt: Date) {
  await prisma.creditLimitChange.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      previousLimit: 0n,
      newLimit: 50000n,
      setById,
      setAt,
    },
  });
}

async function seedNote(id: string, recipientId: string, createdAt: Date, read = false) {
  await prisma.notification.create({
    data: {
      id,
      recipientId,
      sourceEvent: 'order.created',
      content: 'Nouvelle commande',
      readStatus: read ? 'READ' : 'UNREAD',
      createdAt,
    },
  });
}

describe('GET /api/v1/sync/pull (ledger, money records and notifications)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600000701', 'Owner A');
    await seedPerson(MANAGER, '+237600000702', 'Manager A');
    await seedPerson(SELLER, '+237600000703', 'Seller A');
    await seedPerson(DRIVER, '+237600000704', 'Driver A');
    await seedPerson(CUSTOMER, '+237600000705', 'Customer');
    await seedPerson(OWNER_B, '+237600000706', 'Owner B');
    await seedPerson(CUSTOMER_B, '+237600000707', 'Customer B');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedCollaboration('01', OWNER, ORG_A, 'OWNER');
    await seedCollaboration('02', MANAGER, ORG_A, 'MANAGER');
    await seedCollaboration('03', SELLER, ORG_A, 'SELLER');
    await seedCollaboration('04', DRIVER, ORG_A, 'DRIVER');
    await seedCollaboration('05', OWNER_B, ORG_B, 'OWNER');

    for (const [id, org, customer, createdBy] of [
      [REL_A, ORG_A, CUSTOMER, SELLER],
      [REL_B, ORG_B, CUSTOMER_B, OWNER_B],
    ]) {
      await prisma.customerRelationship.create({
        data: {
          id,
          createdById: createdBy,
          createdAt: LONG_AGO,
          supplierOrganizationId: org,
          customerPersonId: customer,
          customerLabel: 'Client',
          creditLimit: 50000n,
          balance: 0n,
        },
      });
    }

    await seedLedger(LEDGER.recent, REL_A, SELLER, daysAgo(40));
    await seedLedger(LEDGER.old, REL_A, SELLER, daysAgo(120));
    await seedLedger(LEDGER.orgB, REL_B, OWNER_B, daysAgo(40));

    await seedExpense(EXPENSE.recent, ORG_A, MANAGER, daysAgo(10));
    await seedExpense(EXPENSE.old, ORG_A, MANAGER, daysAgo(120));
    await seedExpense(EXPENSE.cancelledRecently, ORG_A, MANAGER, daysAgo(120), daysAgo(5));
    await seedExpense(EXPENSE.orgB, ORG_B, OWNER_B, daysAgo(10));

    await seedHandover(HANDOVER.sellerToManager, ORG_A, SELLER, MANAGER, daysAgo(3));
    await seedHandover(HANDOVER.driverToOwner, ORG_A, DRIVER, OWNER, daysAgo(3));
    await seedHandover(HANDOVER.managerToOwner, ORG_A, MANAGER, OWNER, daysAgo(3));
    await seedHandover(HANDOVER.old, ORG_A, SELLER, MANAGER, daysAgo(120));
    await seedHandover(HANDOVER.orgB, ORG_B, OWNER_B, OWNER_B, daysAgo(3));

    await seedLimit(LIMIT.recent, REL_A, OWNER, daysAgo(10));
    await seedLimit(LIMIT.old, REL_A, OWNER, daysAgo(120));
    await seedLimit(LIMIT.orgB, REL_B, OWNER_B, daysAgo(10));

    await seedNote(NOTE.owner, OWNER, daysAgo(2));
    await seedNote(NOTE.ownerOldRead, OWNER, daysAgo(120), true);
    await seedNote(NOTE.ownerOldUnread, OWNER, daysAgo(120));
    await seedNote(NOTE.seller, SELLER, daysAgo(2));
    await seedNote(NOTE.customerB, CUSTOMER_B, daysAgo(2));
  });

  it('seller: the 40-day-old entry arrives, the 120-day-old one does not (AC-1, CM-30)', async () => {
    const body = bodyOf<PullBody>(await pull(SELLER));

    const ledger = body.changes['ledger_entries'].created;
    expect(idsOf(ledger)).toEqual([LEDGER.recent]);
    expect(ledger[0]).toMatchObject({
      customer_relationship_id: REL_A,
      kind: 'PAYMENT',
      mode: 'MOBILE_MONEY',
      amount: 7000,
      transaction_reference: 'ref-secret-1',
    });
    expect(typeof ledger[0]['occurred_at']).toBe('number');
    expect(typeof ledger[0]['server_updated_at']).toBe('number');
    // The recorder is shown to OWNER and MANAGER only (v5.0.0-8.2.3).
    expect(ledger[0]).not.toHaveProperty('recorded_by_id');
    expect(body.changes['expenses'].created).toEqual([]);
    expect(body.changes['credit_limit_changes'].created).toEqual([]);
  });

  it('seller: only the handovers they sent or received (AC-2)', async () => {
    const body = bodyOf<PullBody>(await pull(SELLER));

    expect(idsOf(body.changes['handovers'].created)).toEqual([HANDOVER.sellerToManager]);
  });

  it('driver: no ledger, expenses or credit limit changes, only own handovers (AC-2)', async () => {
    const body = bodyOf<PullBody>(await pull(DRIVER));

    expect(body.changes['ledger_entries'].created).toEqual([]);
    expect(body.changes['expenses'].created).toEqual([]);
    expect(body.changes['credit_limit_changes'].created).toEqual([]);
    expect(idsOf(body.changes['handovers'].created)).toEqual([HANDOVER.driverToOwner]);
  });

  it('customer: own entries without recorded_by_id nor transaction_reference (AC-3, C-35)', async () => {
    const body = bodyOf<PullBody>(await pull(CUSTOMER));

    const ledger = body.changes['ledger_entries'].created;
    expect(idsOf(ledger)).toEqual([LEDGER.recent]);
    expect(ledger[0]).not.toHaveProperty('recorded_by_id');
    expect(ledger[0]).not.toHaveProperty('transaction_reference');
    expect(ledger[0]).toMatchObject({ amount: 7000, kind: 'PAYMENT' });
    expect(body.changes['expenses'].created).toEqual([]);
    expect(body.changes['handovers'].created).toEqual([]);
    expect(body.changes['credit_limit_changes'].created).toEqual([]);
  });

  it('each viewer receives only their own notifications, all unread and the last 90 days (AC-4)', async () => {
    const owner = bodyOf<PullBody>(await pull(OWNER));
    expect(idsOf(owner.changes['notifications'].created)).toEqual(
      sorted([NOTE.owner, NOTE.ownerOldUnread])
    );
    expect(owner.changes['notifications'].created[0]).toMatchObject({
      recipient_id: OWNER,
      source_event: 'order.created',
      content: 'Nouvelle commande',
    });

    const seller = bodyOf<PullBody>(await pull(SELLER));
    expect(idsOf(seller.changes['notifications'].created)).toEqual([NOTE.seller]);
    const customerB = bodyOf<PullBody>(await pull(CUSTOMER_B));
    expect(idsOf(customerB.changes['notifications'].created)).toEqual([NOTE.customerB]);
  });

  it.each([
    ['owner', OWNER],
    ['manager', MANAGER],
  ])('%s: all recent money records of the organization (AC-5)', async (_name, personId) => {
    const body = bodyOf<PullBody>(await pull(personId));

    expect(idsOf(body.changes['ledger_entries'].created)).toEqual([LEDGER.recent]);
    expect(body.changes['ledger_entries'].created[0]).toMatchObject({ recorded_by_id: SELLER });
    // An old expense cancelled within 90 days is still sent: the cancellation date counts.
    expect(idsOf(body.changes['expenses'].created)).toEqual(
      sorted([EXPENSE.recent, EXPENSE.cancelledRecently])
    );
    expect(body.changes['expenses'].created.find((e) => e['id'] === EXPENSE.recent)).toMatchObject({
      organization_id: ORG_A,
      paid_by_id: MANAGER,
      amount: 2500,
      cancelled_at: null,
    });
    expect(idsOf(body.changes['handovers'].created)).toEqual(
      sorted([HANDOVER.sellerToManager, HANDOVER.driverToOwner, HANDOVER.managerToOwner])
    );
    expect(idsOf(body.changes['credit_limit_changes'].created)).toEqual([LIMIT.recent]);
    expect(body.changes['credit_limit_changes'].created[0]).toMatchObject({
      customer_relationship_id: REL_A,
      new_limit: 50000,
      set_by_id: OWNER,
    });
  });

  it("a member of A never receives B's money records, nor others' notifications (AB-1)", async () => {
    for (const personId of [OWNER, MANAGER, SELLER, DRIVER, CUSTOMER]) {
      const body = bodyOf<PullBody>(await pull(personId));
      const everything = JSON.stringify(body.changes);
      for (const id of [LEDGER.orgB, EXPENSE.orgB, HANDOVER.orgB, LIMIT.orgB, NOTE.customerB]) {
        expect(everything).not.toContain(id);
      }
    }
    const ownerB = bodyOf<PullBody>(await pull(OWNER_B));
    expect(idsOf(ownerB.changes['ledger_entries'].created)).toEqual([LEDGER.orgB]);
    expect(idsOf(ownerB.changes['expenses'].created)).toEqual([EXPENSE.orgB]);
    expect(idsOf(ownerB.changes['handovers'].created)).toEqual([HANDOVER.orgB]);
    expect(idsOf(ownerB.changes['credit_limit_changes'].created)).toEqual([LIMIT.orgB]);
    expect(ownerB.changes['notifications'].created).toEqual([]);
  });

  it('a person with no active membership receives nothing from the organization (AB-1)', async () => {
    await prisma.collaboration.updateMany({
      where: { personId: MANAGER },
      data: { status: 'REVOKED' },
    });

    const body = bodyOf<PullBody>(await pull(MANAGER));

    for (const table of ['ledger_entries', 'expenses', 'handovers', 'credit_limit_changes']) {
      expect(body.changes[table].created).toEqual([]);
    }
  });

  it('an incremental pull lists an expense cancelled since as updated (C-35)', async () => {
    const first = bodyOf<PullBody>(await pull(OWNER));
    await sleep(20);
    await prisma.expense.update({
      where: { id: EXPENSE.recent },
      data: { cancelledAt: new Date(), cancelledById: OWNER },
    });

    const body = bodyOf<PullBody>(await pull(OWNER, `?last_pulled_at=${first.timestamp}`));

    expect(idsOf(body.changes['expenses'].updated)).toEqual([EXPENSE.recent]);
    expect(body.changes['expenses'].created).toEqual([]);
    expect(body.changes['ledger_entries'].updated).toEqual([]);
  });
});
