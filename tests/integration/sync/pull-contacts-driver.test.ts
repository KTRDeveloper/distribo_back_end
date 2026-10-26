import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const P = '0199e042-0000-7000-8000-';
const OWNER = `${P}000000000001`;
const DRIVER = `${P}000000000002`;
const OWNER_CLIENT = `${P}000000000003`;
const OWNER_LATE = `${P}000000000004`;
const OWNER_IDLE = `${P}000000000005`;
const PARTICULAR = `${P}000000000006`;
const OWNER_X = `${P}000000000007`;
const OWNER_Y = `${P}000000000008`;
const ORG_A = `${P}0000000000a1`;
const ORG_CLIENT = `${P}0000000000b1`;
const ORG_LATE = `${P}0000000000b2`;
const ORG_IDLE = `${P}0000000000b3`;
const ORG_X = `${P}0000000000c1`;
const ORG_Y = `${P}0000000000c2`;
const REL_CLIENT = `${P}0000000000d1`;
const REL_LATE = `${P}0000000000d2`;
const REL_IDLE = `${P}0000000000d3`;
const REL_PARTICULAR = `${P}0000000000d4`;
const REL_Y = `${P}0000000000d5`;
const CLIENT_1 = `${P}0000000000e1`;
const CLIENT_2 = `${P}0000000000e2`;
const CLIENT_PENDING = `${P}0000000000e3`;
const LATE_1 = `${P}0000000000e4`;
const LATE_2 = `${P}0000000000e5`;
const IDLE_1 = `${P}0000000000e6`;
const OWN_1 = `${P}0000000000e7`;
const Y_1 = `${P}0000000000e8`;
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
let since = 0;

type Rows = Array<Record<string, unknown>>;
type Changes = { created: Rows; updated: Rows; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const pull = (personId: string, query = '') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/sync/pull${query}`);
const contactsOf = (body: PullBody) => body.changes['organization_contacts'];
const idsOf = (rows: Rows) => rows.map((r) => r['id']).sort();
const firstPull = async (personId: string) => contactsOf(bodyOf<PullBody>(await pull(personId)));
const sincePull = async (personId: string) =>
  contactsOf(bodyOf<PullBody>(await pull(personId, `?last_pulled_at=${since}`)));

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
      id: `${P}0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

async function seedContact(
  id: string,
  org: string,
  slot: number,
  value: string,
  verified: boolean
) {
  await prisma.organizationContact.create({
    data: {
      id,
      organizationId: org,
      kind: 'PHONE',
      slot,
      value,
      verifiedAt: verified ? LONG_AGO : null,
      verificationMethod: verified ? 'CODE' : null,
      createdById: OWNER,
      createdAt: LONG_AGO,
    },
  });
}

async function seedRelationship(
  id: string,
  supplier: string,
  data: { customerPersonId?: string; customerOrganizationId?: string }
) {
  await prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId: supplier,
      customerPersonId: data.customerPersonId ?? null,
      customerOrganizationId: data.customerOrganizationId ?? null,
      createdById: OWNER,
      createdAt: LONG_AGO,
    },
  });
}

async function seedOrder(id: string, relationshipId: string, address: string | null = 'Marche') {
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      placedByParty: 'SUPPLIER',
      enteredById: OWNER,
      totalAmount: 0n,
      status: 'CONFIRMED',
      deliveryAddressApplied: address,
    },
  });
}

describe('GET /api/v1/sync/pull (organization contacts of the driver)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600004201', 'Owner A');
    await seedPerson(DRIVER, '+237600004202', 'Driver A');
    await seedPerson(OWNER_CLIENT, '+237600004203', 'Owner Client');
    await seedPerson(OWNER_LATE, '+237600004204', 'Owner Late');
    await seedPerson(OWNER_IDLE, '+237600004205', 'Owner Idle');
    await seedPerson(PARTICULAR, '+237600004206', 'Particular');
    await seedPerson(OWNER_X, '+237600004207', 'Owner X');
    await seedPerson(OWNER_Y, '+237600004208', 'Owner Y');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_CLIENT, 'Org Client'],
      [ORG_LATE, 'Org Late'],
      [ORG_IDLE, 'Org Idle'],
      [ORG_X, 'Org X'],
      [ORG_Y, 'Org Y'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedCollaboration('01', OWNER, ORG_A, 'OWNER');
    await seedCollaboration('02', DRIVER, ORG_A, 'DRIVER');
    await seedCollaboration('03', OWNER_CLIENT, ORG_CLIENT, 'OWNER');
    await seedCollaboration('04', OWNER_LATE, ORG_LATE, 'OWNER');
    await seedCollaboration('05', OWNER_IDLE, ORG_IDLE, 'OWNER');
    await seedCollaboration('06', OWNER_X, ORG_X, 'OWNER');
    await seedCollaboration('07', OWNER_Y, ORG_Y, 'OWNER');

    await seedContact(CLIENT_1, ORG_CLIENT, 1, '+237677004201', true);
    await seedContact(CLIENT_2, ORG_CLIENT, 2, '+237677004202', true);
    await seedContact(CLIENT_PENDING, ORG_CLIENT, 3, '+237677004203', false);
    await seedContact(LATE_1, ORG_LATE, 1, '+237677004204', true);
    await seedContact(LATE_2, ORG_LATE, 2, '+237677004205', true);
    await seedContact(IDLE_1, ORG_IDLE, 1, '+237677004206', true);
    await seedContact(OWN_1, ORG_A, 1, '+237677004207', true);
    await seedContact(Y_1, ORG_Y, 1, '+237677004208', true);

    await seedRelationship(REL_CLIENT, ORG_A, { customerOrganizationId: ORG_CLIENT });
    await seedRelationship(REL_LATE, ORG_A, { customerOrganizationId: ORG_LATE });
    await seedRelationship(REL_IDLE, ORG_A, { customerOrganizationId: ORG_IDLE });
    await seedRelationship(REL_PARTICULAR, ORG_A, { customerPersonId: PARTICULAR });
    await seedRelationship(REL_Y, ORG_X, { customerOrganizationId: ORG_Y });
    await seedOrder(`${P}0000000002a1`, REL_CLIENT);
    await seedOrder(`${P}0000000002a2`, REL_PARTICULAR);
    await seedOrder(`${P}0000000002a3`, REL_Y);
    since = await pulledAtAfterSeeding();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

  it('client business: the two verified contacts, not the pending one (AC-1)', async () => {
    const changes = await firstPull(DRIVER);
    expect(idsOf(changes.created)).toEqual([CLIENT_1, CLIENT_2].sort());
    expect(idsOf(changes.created)).not.toContain(CLIENT_PENDING);
    expect(changes.updated).toEqual([]);
    expect(changes.deleted).toEqual([]);
    expect(Object.keys(changes.created[0] ?? {}).sort()).toEqual(
      [
        'created_at',
        'id',
        'kind',
        'organization_id',
        'server_updated_at',
        'slot',
        'value',
        'verification_method',
        'verified_at',
      ].sort()
    );
  });

  it('nothing else: no business without an order, no particular customer, no own contact (AC-2)', async () => {
    const full = JSON.stringify(await firstPull(DRIVER));
    for (const id of [LATE_1, LATE_2, IDLE_1, OWN_1, CLIENT_PENDING])
      expect(full).not.toContain(id);
    expect(full).not.toContain(PARTICULAR);
    const incremental = await sincePull(DRIVER);
    expect(incremental).toEqual({ created: [], updated: [], deleted: [] });
  });

  it('new order: the verified contacts of the customer arrive whole (AC-3, C-35)', async () => {
    await seedOrder(`${P}0000000002b1`, REL_LATE);
    const changes = await sincePull(DRIVER);
    expect(idsOf(changes.created)).toEqual([LATE_1, LATE_2].sort());
    expect(changes.updated).toEqual([]);
    expect(changes.deleted).toEqual([]);
    // The business that already had its order is not repeated.
    expect(JSON.stringify(changes)).not.toContain(CLIENT_1);
  });

  it('pending again: the id is in deleted for the driver (AC-4, C-35)', async () => {
    await prisma.organizationContact.update({
      where: { id: CLIENT_1 },
      data: { verifiedAt: null, verificationMethod: null },
    });
    const changes = await sincePull(DRIVER);
    expect(changes.deleted).toEqual([CLIENT_1]);
    expect(changes.created).toEqual([]);
    expect(changes.updated).toEqual([]);
  });

  it('a verified contact changed after the last pull is updated (C-35)', async () => {
    await prisma.organizationContact.update({
      where: { id: CLIENT_2 },
      data: { value: '+237677004299' },
    });
    const changes = await sincePull(DRIVER);
    expect(idsOf(changes.updated)).toEqual([CLIENT_2]);
    expect(changes.created).toEqual([]);
  });

  it('other business: the contacts of a customer of another supplier are absent (AB-1, CWE-639)', async () => {
    const full = JSON.stringify(await firstPull(DRIVER));
    expect(full).not.toContain(Y_1);
    expect(full).not.toContain(ORG_Y);
    await seedOrder(`${P}0000000002b2`, REL_Y);
    expect(JSON.stringify(await sincePull(DRIVER))).not.toContain(Y_1);
  });

  it('a driver of nowhere else gets nothing for a relationship ended by deletion', async () => {
    await prisma.customerRelationship.update({
      where: { id: REL_CLIENT },
      data: { deletedAt: new Date() },
    });
    expect((await firstPull(DRIVER)).created).toEqual([]);
  });
});
