import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { customerRelationshipsAdapter } from '../../../src/modules/sync/adapters/relationship.adapter.js';
import { ordersAdapter } from '../../../src/modules/sync/adapters/order.adapter.js';
import type { TableChange, Viewer } from '../../../src/modules/sync/sync.types.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const SELLER = '0199e011-0000-7000-8000-000000000001';
const SELLER_2 = '0199e011-0000-7000-8000-000000000002';
const DRIVER = '0199e011-0000-7000-8000-000000000003';
const OWNER_A = '0199e011-0000-7000-8000-000000000004';
const OWNER_B = '0199e011-0000-7000-8000-000000000005';
const CUSTOMER = '0199e011-0000-7000-8000-000000000006';
const ORG_A = '0199e011-0000-7000-8000-0000000000a1';
const ORG_B = '0199e011-0000-7000-8000-0000000000b1';
const REL_EXIST = '0199e011-0000-7000-8000-0000000000c1';
const NEW_1 = '0199e011-0000-7000-8000-000000000401';
const NEW_2 = '0199e011-0000-7000-8000-000000000402';
const NEW_3 = '0199e011-0000-7000-8000-000000000403';
const ORDER_1 = '0199e011-0000-7000-8000-000000000501';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

const CUSTOMER_PHONE = '+237677123456';

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
};

const devices: Record<string, string> = {};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const newCustomer = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  supplier_organization_id: ORG_A,
  customer_phone_number: '6 77 12 34 56',
  customer_label: 'Chez Paul',
  delivery_address: 'Rue 1',
  ...extra,
});

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Push Person',
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${phone.slice(1)}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
  devices[id] = `0199e011-0000-7000-8000-0000000007${phone.slice(-2)}`;
  await prisma.device.create({
    data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
  });
}

async function seedMember(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e011-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

/** The relationship the organization already holds with the person owning CUSTOMER_PHONE. */
async function seedExistingCustomer() {
  await prisma.person.create({ data: { id: CUSTOMER, phoneNumber: CUSTOMER_PHONE } });
  await prisma.customerRelationship.create({
    data: {
      id: REL_EXIST,
      createdById: OWNER_A,
      createdAt: LONG_AGO,
      supplierOrganizationId: ORG_A,
      customerPersonId: CUSTOMER,
      customerLabel: 'Paul',
      creditLimit: 50000n,
      balance: 0n,
    },
  });
}

const sellerViewer: Viewer = {
  personId: SELLER,
  deviceId: 'device',
  memberships: [{ organizationId: ORG_A, role: 'SELLER', status: 'ACTIVE' }],
  scopeVersion: 0,
  isOnline: false,
};

/** Runs the relationship adapter alone on already judged lines and returns its outcomes. */
function pushToAdapter(change: Partial<TableChange>) {
  return prisma.$transaction((tx) =>
    customerRelationshipsAdapter.push(
      { viewer: sellerViewer, tx },
      { table: 'customer_relationships', created: [], updated: [], deleted: [], ...change }
    )
  );
}

describe('push of customer_relationships (SYNC-011)', () => {
  beforeEach(async () => {
    await seedPerson(SELLER, '+237600001101');
    await seedPerson(SELLER_2, '+237600001102');
    await seedPerson(DRIVER, '+237600001103');
    await seedPerson(OWNER_A, '+237600001104');
    await seedPerson(OWNER_B, '+237600001105');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedMember('04', OWNER_A, ORG_A, 'OWNER');
    await seedMember('05', OWNER_B, ORG_B, 'OWNER');
    await seedMember('01', SELLER, ORG_A, 'SELLER');
    await seedMember('02', SELLER_2, ORG_A, 'SELLER');
    await seedMember('03', DRIVER, ORG_A, 'DRIVER');
    await sleep(5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a guest person and a relationship with defaults for a new customer (AC-1, C-06)', async () => {
    const response = await push(SELLER, {
      customer_relationships: table({ created: [newCustomer(NEW_1)] }),
    });

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const person = await prisma.person.findFirstOrThrow({ where: { phoneNumber: CUSTOMER_PHONE } });
    expect(person.registeredAt).toBeNull();
    const stored = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: NEW_1 } });
    expect(stored).toMatchObject({
      supplierOrganizationId: ORG_A,
      customerPersonId: person.id,
      customerPhoneNumber: null,
      customerLabel: 'Chez Paul',
      deliveryAddress: 'Rue 1',
      creditLimit: 0n,
      balance: 0n,
      status: 'ACTIVE',
      createdById: SELLER,
      deletedAt: null,
      mergedIntoId: null,
    });
  });

  it('merges a second new row for a customer already held and does not reject the batch (AC-2, C-36)', async () => {
    await seedExistingCustomer();

    const response = await push(SELLER_2, {
      customer_relationships: table({ created: [newCustomer(NEW_1)] }),
    });

    expect(response.status).toBe(200);
    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([]);
    expect(body.accepted).toBe(1);
    const duplicate = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: NEW_1 } });
    expect(duplicate.mergedIntoId).toBe(REL_EXIST);
    expect(duplicate.deletedAt).not.toBeNull();
    expect(duplicate.customerPhoneNumber).toBeNull();
    const kept = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: REL_EXIST } });
    expect(kept).toMatchObject({ creditLimit: 50000n, customerLabel: 'Paul', deletedAt: null });
  });

  it('reports a MERGED info issue naming the label (AC-2)', async () => {
    await seedExistingCustomer();

    const outcomes = await pushToAdapter({
      created: [newCustomer(NEW_1, { created_by_id: SELLER })],
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        table: 'customer_relationships',
        id: NEW_1,
        kind: 'issue',
        code: 'MERGED',
        message: 'Chez Paul ajoutée deux fois : fiches réunies',
        mergedInto: REL_EXIST,
      }),
    ]);
  });

  it('stores an order of the same batch on the surviving relationship (AC-3)', async () => {
    await seedExistingCustomer();
    const calls: TableChange[] = [];
    vi.spyOn(ordersAdapter, 'push').mockImplementation((_ctx, change) => {
      calls.push(change);
      return Promise.resolve(
        change.created.map((row) => ({
          table: change.table,
          id: String(row['id']),
          kind: 'accepted' as const,
        }))
      );
    });

    const response = await push(SELLER, {
      customer_relationships: table({ created: [newCustomer(NEW_1)] }),
      orders: table({ created: [{ id: ORDER_1, customer_relationship_id: NEW_1 }] }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    expect(calls.flatMap((c) => c.created)).toEqual([
      expect.objectContaining({ id: ORDER_1, customer_relationship_id: REL_EXIST }),
    ]);
  });

  it('makes an invalid number an INVALID_PHONE issue, stores nothing and lets the rest pass (AC-4)', async () => {
    const response = await push(SELLER, {
      customer_relationships: table({
        created: [newCustomer(NEW_1, { customer_phone_number: '12345' }), newCustomer(NEW_2)],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([]);
    expect(body.accepted).toBe(2);
    expect(await prisma.customerRelationship.findUnique({ where: { id: NEW_1 } })).toBeNull();
    expect(await prisma.customerRelationship.findUnique({ where: { id: NEW_2 } })).not.toBeNull();
    expect(await prisma.person.count({ where: { phoneNumber: '12345' } })).toBe(0);

    const outcomes = await pushToAdapter({
      created: [newCustomer(NEW_3, { customer_phone_number: '12345', created_by_id: SELLER })],
    });
    expect(outcomes).toEqual([
      expect.objectContaining({ id: NEW_3, kind: 'issue', code: 'INVALID_PHONE' }),
    ]);
  });

  it('stores an edit of customer_label and supplier_notes by a SELLER (AC-5)', async () => {
    await seedExistingCustomer();
    await sleep(5);

    const response = await push(SELLER, {
      customer_relationships: table({
        updated: [
          { id: REL_EXIST, customer_label: 'Paul le grossiste', supplier_notes: 'Paie le lundi' },
        ],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const stored = await prisma.customerRelationship.findUniqueOrThrow({
      where: { id: REL_EXIST },
    });
    expect(stored).toMatchObject({
      customerLabel: 'Paul le grossiste',
      supplierNotes: 'Paie le lundi',
      creditLimit: 50000n,
    });
  });

  it('creates one relationship when the same created row is pushed twice (AC-6)', async () => {
    const batch = { customer_relationships: table({ created: [newCustomer(NEW_1)] }) };

    const first = await push(SELLER, batch);
    const second = await push(SELLER, batch);

    expect(bodyOf<PushBody>(first).rejected).toEqual([]);
    expect(bodyOf<PushBody>(second).rejected).toEqual([]);
    expect(bodyOf<PushBody>(second).accepted).toBe(1);
    expect(
      await prisma.customerRelationship.count({ where: { supplierOrganizationId: ORG_A } })
    ).toBe(1);
  });

  it('answers a repeat of a merged row with success and changes nothing (AC-6)', async () => {
    await seedExistingCustomer();
    const batch = { customer_relationships: table({ created: [newCustomer(NEW_1)] }) };

    await push(SELLER, batch);
    const again = await push(SELLER, batch);

    expect(bodyOf<PushBody>(again).rejected).toEqual([]);
    const rows = await prisma.customerRelationship.findMany({
      where: { supplierOrganizationId: ORG_A },
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === NEW_1)?.mergedIntoId).toBe(REL_EXIST);
  });

  it('redirects an edit aimed at a merged duplicate to the survivor', async () => {
    await seedExistingCustomer();
    await push(SELLER, { customer_relationships: table({ created: [newCustomer(NEW_1)] }) });
    await sleep(5);

    const response = await push(SELLER_2, {
      customer_relationships: table({ updated: [{ id: NEW_1, customer_label: 'Paul 2' }] }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const kept = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: REL_EXIST } });
    expect(kept.customerLabel).toBe('Paul 2');
  });

  it('lets two phones add the same customer offline: both batches succeed (AB-1, CWE-400)', async () => {
    const results = [
      await push(SELLER, { customer_relationships: table({ created: [newCustomer(NEW_1)] }) }),
      await push(SELLER_2, { customer_relationships: table({ created: [newCustomer(NEW_2)] }) }),
    ];

    for (const response of results) {
      expect(response.status).toBe(200);
      expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    }
    const live = await prisma.customerRelationship.findMany({
      where: { supplierOrganizationId: ORG_A, deletedAt: null },
    });
    expect(live).toHaveLength(1);
    expect(await prisma.person.count({ where: { phoneNumber: CUSTOMER_PHONE } })).toBe(1);
  });

  it('merges two rows for one number pushed in the same batch (AB-1, C-36)', async () => {
    const response = await push(SELLER, {
      customer_relationships: table({ created: [newCustomer(NEW_1), newCustomer(NEW_2)] }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const second = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: NEW_2 } });
    expect(second.mergedIntoId).toBe(NEW_1);
  });

  it('forbids a created row carrying credit_limit or status ENDED and stores nothing (AB-2, CWE-915)', async () => {
    const response = await push(SELLER, {
      customer_relationships: table({
        created: [
          newCustomer(NEW_1, { credit_limit: 1_000_000 }),
          newCustomer(NEW_2, { status: 'ENDED' }),
        ],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.rejected.map((r) => [r.id, r.code])).toEqual([
      [NEW_1, 'FIELD_NOT_ALLOWED'],
      [NEW_2, 'FIELD_NOT_ALLOWED'],
    ]);
    expect(
      await prisma.customerRelationship.count({ where: { supplierOrganizationId: ORG_A } })
    ).toBe(0);
  });

  it('forbids an update carrying credit_limit or status and keeps the stored values (AB-2)', async () => {
    await seedExistingCustomer();
    await sleep(5);

    const response = await push(SELLER, {
      customer_relationships: table({
        updated: [
          { id: REL_EXIST, customer_label: 'ok', credit_limit: 9_999_999 },
          { id: REL_EXIST, status: 'ENDED' },
        ],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected.map((r) => r.code)).toEqual([
      'FIELD_NOT_ALLOWED',
      'FIELD_NOT_ALLOWED',
    ]);
    const stored = await prisma.customerRelationship.findUniqueOrThrow({
      where: { id: REL_EXIST },
    });
    expect(stored).toMatchObject({ creditLimit: 50000n, status: 'ACTIVE', customerLabel: 'Paul' });
  });

  it('forbids a counter created from a phone with COUNTER_ONLINE_ONLY', async () => {
    const response = await push(SELLER, {
      customer_relationships: table({
        created: [
          {
            id: NEW_1,
            supplier_organization_id: ORG_A,
            customer_label: 'Comptoir',
          },
        ],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([
      expect.objectContaining({ id: NEW_1, code: 'COUNTER_ONLINE_ONLY' }),
    ]);
    expect(
      await prisma.customerRelationship.count({ where: { supplierOrganizationId: ORG_A } })
    ).toBe(0);
  });

  it('does not create a customer for another organization or for a DRIVER', async () => {
    const other = await push(SELLER, {
      customer_relationships: table({
        created: [newCustomer(NEW_1, { supplier_organization_id: ORG_B })],
      }),
    });
    const driver = await push(DRIVER, {
      customer_relationships: table({ created: [newCustomer(NEW_2)] }),
    });

    expect(bodyOf<PushBody>(other).rejected[0]?.code).toBe('OUT_OF_SCOPE');
    expect(bodyOf<PushBody>(driver).rejected[0]?.code).toBe('FIELD_NOT_ALLOWED');
    expect(await prisma.customerRelationship.count()).toBe(0);
    expect(await prisma.person.count({ where: { phoneNumber: CUSTOMER_PHONE } })).toBe(0);
  });

  it('does not overwrite a relationship of another organization sharing the pushed id (AC-6)', async () => {
    await prisma.customerRelationship.create({
      data: {
        id: NEW_1,
        createdById: OWNER_B,
        createdAt: LONG_AGO,
        supplierOrganizationId: ORG_B,
        customerLabel: 'Client B',
      },
    });

    const response = await push(SELLER, {
      customer_relationships: table({ created: [newCustomer(NEW_1)] }),
    });

    expect(bodyOf<PushBody>(response).rejected[0]?.code).toBe('OUT_OF_SCOPE');
    const stored = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: NEW_1 } });
    expect(stored.supplierOrganizationId).toBe(ORG_B);
  });
});
