import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const SELLER = '0199e015-0000-7000-8000-000000000001';
const OWNER_A = '0199e015-0000-7000-8000-000000000005';
const OWNER_B = '0199e015-0000-7000-8000-000000000006';
const CUSTOMER = '0199e015-0000-7000-8000-000000000007';
const ORG_A = '0199e015-0000-7000-8000-0000000000a1';
const ORG_B = '0199e015-0000-7000-8000-0000000000b1';
const REL = '0199e015-0000-7000-8000-0000000000c1';
const REL_B = '0199e015-0000-7000-8000-0000000000c2';
const REL_DUPLICATE = '0199e015-0000-7000-8000-0000000000c3';
const REL_PENDING = '0199e015-0000-7000-8000-0000000000c4';
const PAYMENT = '0199e015-0000-7000-8000-000000000802';
const PAYMENT_2 = '0199e015-0000-7000-8000-000000000803';
const ENTRY = '0199e015-0000-7000-8000-000000000804';
const NOTE_MINE = '0199e015-0000-7000-8000-000000000901';
const NOTE_OTHER = '0199e015-0000-7000-8000-000000000902';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
};

const devices: Record<string, string> = {};

const push = (personId: string, changes: unknown) =>
  createAuthenticatedRequest(app, personId, devices[personId])
    .post(`/api/v1/sync/push?last_pulled_at=${Date.now()}`)
    .send({ changes });

const table = (part: Partial<{ created: unknown[]; updated: unknown[]; deleted: string[] }>) => ({
  created: [],
  updated: [],
  deleted: [],
  ...part,
});

const payment = (amount: number, extra: Record<string, unknown> = {}) => ({
  id: PAYMENT,
  customer_relationship_id: REL,
  kind: 'PAYMENT',
  amount,
  mode: 'CASH',
  occurred_at: Date.parse('2026-10-01T09:00:00.000Z'),
  ...extra,
});

const ledger = (part: Parameters<typeof table>[0]) => ({ ledger_entries: table(part) });

async function seedPerson(id: string, phone: string, name: string, registered = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: name,
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      ...(registered
        ? {
            email: `${phone.slice(1)}@example.test`,
            passwordHash: 'test-password-hash',
            registeredAt: LONG_AGO,
          }
        : {}),
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
  if (registered) {
    devices[id] = `0199e015-0000-7000-8000-0000000009${phone.slice(-2)}`;
    await prisma.device.create({
      data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
    });
  }
}

async function seedMember(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e015-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

const balance = async (id = REL) =>
  (await prisma.customerRelationship.findUniqueOrThrow({ where: { id } })).balance;
const held = async (person = SELLER, org = ORG_A) =>
  (
    await prisma.collaboration.findFirstOrThrow({
      where: { personId: person, organizationId: org },
    })
  ).amountHeld;
const entries = () => prisma.ledgerEntry.findMany({ orderBy: { id: 'asc' } });

describe('push of payments and notification reads (SYNC-015)', () => {
  beforeEach(async () => {
    await seedPerson(SELLER, '+237600001501', 'Sam Seller');
    await seedPerson(OWNER_A, '+237600001505', 'Olga Owner');
    await seedPerson(OWNER_B, '+237600001506', 'Otto Owner');
    await seedPerson(CUSTOMER, '+237600001507', 'Cora Customer', false);
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedMember('05', OWNER_A, ORG_A, 'OWNER');
    await seedMember('06', OWNER_B, ORG_B, 'OWNER');
    await seedMember('01', SELLER, ORG_A, 'SELLER');
    const base = { customerPersonId: CUSTOMER, createdById: OWNER_A, createdAt: LONG_AGO };
    await prisma.customerRelationship.create({
      data: { ...base, id: REL, supplierOrganizationId: ORG_A, status: 'ACTIVE', balance: 45000n },
    });
    await prisma.customerRelationship.create({
      data: {
        ...base,
        id: REL_B,
        supplierOrganizationId: ORG_B,
        status: 'ACTIVE',
        balance: 45000n,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        id: REL_DUPLICATE,
        supplierOrganizationId: ORG_A,
        customerPersonId: null,
        customerPhoneNumber: '+237600001599',
        customerLabel: 'Cora',
        createdById: OWNER_A,
        createdAt: LONG_AGO,
        status: 'ACTIVE',
        deletedAt: LONG_AGO,
        mergedIntoId: REL,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        id: REL_PENDING,
        supplierPersonId: OWNER_B,
        customerPersonId: SELLER,
        createdById: OWNER_B,
        createdAt: LONG_AGO,
        status: 'PENDING',
      },
    });
  });

  it('records a cash payment and moves balance and held money (AC-1, CM-27)', async () => {
    const response = await push(
      SELLER,
      ledger({
        created: [
          payment(20000, {
            balance_effect: -999,
            recorded_by_id: OWNER_A,
            transaction_reference: 'REF-1',
            note: 'cash at the shop',
          }),
        ],
      })
    );

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, rejected: [], aside: 0 });
    expect(await balance()).toBe(25000n);
    expect(await held()).toBe(20000n);
    const [entry] = await entries();
    expect(entry).toMatchObject({
      id: PAYMENT,
      customerRelationshipId: REL,
      kind: 'PAYMENT',
      mode: 'CASH',
      amount: 20000n,
      balanceEffect: -20000n,
      recordedById: SELLER,
      transactionReference: 'REF-1',
      note: 'cash at the shop',
      orderId: null,
    });
  });

  it.each([
    ['a REFUND', { kind: 'REFUND', mode: 'CASH' }],
    ['a CREDIT_NOTE', { kind: 'CREDIT_NOTE', mode: undefined }],
    ['an OPENING_BALANCE', { kind: 'OPENING_BALANCE', mode: undefined }],
  ])('forbids %s with ONLINE_ONLY and stores nothing (AC-2, AB-1)', async (_name, extra) => {
    for (const person of [SELLER, OWNER_A]) {
      const response = await push(person, ledger({ created: [payment(500, extra)] }));
      expect(bodyOf<PushBody>(response).rejected.map((r) => r.code)).toEqual(['ONLINE_ONLY']);
    }
    expect(await entries()).toEqual([]);
    expect(await balance()).toBe(45000n);
    expect(await held()).toBe(0n);
  });

  it('forbids an update and a delete of an existing entry with ONLINE_ONLY (AC-2)', async () => {
    await prisma.ledgerEntry.create({
      data: {
        id: ENTRY,
        customerRelationshipId: REL,
        kind: 'PAYMENT',
        mode: 'CASH',
        amount: 100n,
        recordedById: SELLER,
        occurredAt: LONG_AGO,
      },
    });

    for (const person of [SELLER, OWNER_A]) {
      const response = await push(
        person,
        ledger({ updated: [{ id: ENTRY, amount: 1 }], deleted: [ENTRY] })
      );
      expect(bodyOf<PushBody>(response).rejected.map((r) => r.code)).toEqual([
        'ONLINE_ONLY',
        'ONLINE_ONLY',
      ]);
    }
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: ENTRY } })).amount).toBe(
      100n
    );
  });

  it('refuses a payment tied to an order outside a closing, storing nothing (AC-2)', async () => {
    const response = await push(
      SELLER,
      ledger({ created: [payment(500, { order_id: '0199e015-0000-7000-8000-000000000501' })] })
    );

    expect(bodyOf<PushBody>(response).rejected.map((r) => r.code)).toEqual(['ONLINE_ONLY']);
    expect(await entries()).toEqual([]);
  });

  it('stores a repeated payment once and changes the caches once (AC-3, C-36)', async () => {
    await push(SELLER, ledger({ created: [payment(20000)] }));
    const second = await push(SELLER, ledger({ created: [payment(20000)] }));

    expect(bodyOf<PushBody>(second)).toMatchObject({ accepted: 1, rejected: [], aside: 0 });
    expect(await entries()).toHaveLength(1);
    expect(await balance()).toBe(25000n);
    expect(await held()).toBe(20000n);
  });

  it('does not take a payment id stored by someone else as a repeat (ASVS 8.2.1)', async () => {
    await prisma.ledgerEntry.create({
      data: {
        id: PAYMENT,
        customerRelationshipId: REL,
        kind: 'PAYMENT',
        mode: 'CASH',
        amount: 100n,
        recordedById: OWNER_A,
        occurredAt: LONG_AGO,
      },
    });

    const response = await push(SELLER, ledger({ created: [payment(20000)] }));

    expect(bodyOf<PushBody>(response).rejected.map((r) => r.code)).toEqual(['OUT_OF_SCOPE']);
    expect(await entries()).toHaveLength(1);
  });

  it('stores two payments of one batch, each once (AC-3)', async () => {
    await push(SELLER, ledger({ created: [payment(1000), payment(2000, { id: PAYMENT_2 })] }));

    expect(await entries()).toHaveLength(2);
    expect(await balance()).toBe(42000n);
    expect(await held()).toBe(3000n);
  });

  it('sets aside a payment whose amount is not above zero (C-36)', async () => {
    const response = await push(
      SELLER,
      ledger({ created: [payment(0), payment(-5, { id: PAYMENT_2 })] })
    );

    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 2 });
    expect(await entries()).toEqual([]);
  });

  it('stores nothing on a pending relationship, whoever pushes (AC-1)', async () => {
    const response = await push(
      SELLER,
      ledger({ created: [payment(500, { customer_relationship_id: REL_PENDING })] })
    );

    expect(bodyOf<PushBody>(response).accepted).toBe(0);
    expect(await entries()).toEqual([]);
    expect(await held()).toBe(0n);
  });

  it('answers a payment that names no relationship as an issue and stores nothing', async () => {
    const response = await push(
      SELLER,
      ledger({ created: [payment(500, { customer_relationship_id: null })] })
    );

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, rejected: [], aside: 0 });
    expect(await entries()).toEqual([]);
    expect(await held()).toBe(0n);
  });

  it('stores the payment of a merged duplicate on the surviving relationship (AC-5)', async () => {
    const response = await push(
      SELLER,
      ledger({ created: [payment(20000, { customer_relationship_id: REL_DUPLICATE })] })
    );

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const [entry] = await entries();
    expect(entry?.customerRelationshipId).toBe(REL);
    expect(await balance()).toBe(25000n);
    expect(await held()).toBe(20000n);
  });

  it('forbids a payment on another business customer with OUT_OF_SCOPE (AB-2)', async () => {
    const response = await push(
      SELLER,
      ledger({ created: [payment(500, { customer_relationship_id: REL_B })] })
    );

    expect(bodyOf<PushBody>(response).rejected.map((r) => r.code)).toEqual(['OUT_OF_SCOPE']);
    expect(await entries()).toEqual([]);
    expect(await balance(REL_B)).toBe(45000n);
  });

  describe('notifications', () => {
    beforeEach(async () => {
      for (const [id, recipient] of [
        [NOTE_MINE, SELLER],
        [NOTE_OTHER, OWNER_A],
      ]) {
        await prisma.notification.create({
          data: { id, recipientId: recipient, content: 'hello', sourceEvent: 'sync.test' },
        });
      }
    });

    const status = async (id: string) =>
      (await prisma.notification.findUniqueOrThrow({ where: { id } })).readStatus;

    it('marks the viewer own notification as read (AC-4)', async () => {
      const response = await push(SELLER, {
        notifications: table({ updated: [{ id: NOTE_MINE, read_status: 'READ' }] }),
      });

      expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, rejected: [] });
      expect(await status(NOTE_MINE)).toBe('READ');
    });

    it('forbids another person notification and leaves it unread (AC-4)', async () => {
      const response = await push(SELLER, {
        notifications: table({ updated: [{ id: NOTE_OTHER, read_status: 'READ' }] }),
      });

      expect(bodyOf<PushBody>(response).rejected).toHaveLength(1);
      expect(await status(NOTE_OTHER)).toBe('UNREAD');
    });

    it('forbids any other field, even next to read_status (AC-4)', async () => {
      const response = await push(SELLER, {
        notifications: table({ updated: [{ id: NOTE_MINE, read_status: 'READ', content: 'x' }] }),
      });

      expect(bodyOf<PushBody>(response).rejected.map((r) => r.code)).toEqual(['FIELD_NOT_ALLOWED']);
      const row = await prisma.notification.findUniqueOrThrow({ where: { id: NOTE_MINE } });
      expect(row).toMatchObject({ readStatus: 'UNREAD', content: 'hello' });
    });

    it('sets aside a read_status value that is not a status', async () => {
      const response = await push(SELLER, {
        notifications: table({ updated: [{ id: NOTE_MINE, read_status: 'MAYBE' }] }),
      });

      expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 1 });
      expect(await status(NOTE_MINE)).toBe('UNREAD');
    });

    it('forbids a phone creating or deleting a notification', async () => {
      const response = await push(SELLER, {
        notifications: table({
          created: [{ id: PAYMENT_2, recipient_id: SELLER, content: 'x', source_event: 'a.b' }],
          deleted: [NOTE_MINE],
        }),
      });

      expect(bodyOf<PushBody>(response).rejected).toHaveLength(2);
      expect(await prisma.notification.count()).toBe(2);
    });
  });
});
