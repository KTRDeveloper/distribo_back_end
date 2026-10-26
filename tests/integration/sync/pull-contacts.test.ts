import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest, TEST_DEVICE_ID } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const OWNER = '0199e036-0000-7000-8000-000000000001';
const MANAGER = '0199e036-0000-7000-8000-000000000002';
const SELLER = '0199e036-0000-7000-8000-000000000003';
const DRIVER = '0199e036-0000-7000-8000-000000000004';
const OWNER_B = '0199e036-0000-7000-8000-000000000005';
const CUSTOMER = '0199e036-0000-7000-8000-000000000006';
const OWNER_X = '0199e036-0000-7000-8000-000000000007';
const OUTSIDER = '0199e036-0000-7000-8000-000000000008';
const LATE_CUSTOMER = '0199e036-0000-7000-8000-000000000009';
const ORG_A = '0199e036-0000-7000-8000-0000000000a1';
const ORG_B = '0199e036-0000-7000-8000-0000000000b1';
const ORG_X = '0199e036-0000-7000-8000-0000000000c1';
const REL_B = '0199e036-0000-7000-8000-0000000000d1';
const REL_CUSTOMER = '0199e036-0000-7000-8000-0000000000d2';
const A_PHONE = '0199e036-0000-7000-8000-0000000000e1';
const A_EMAIL = '0199e036-0000-7000-8000-0000000000e2';
const A_PENDING = '0199e036-0000-7000-8000-0000000000e3';
const B_PHONE = '0199e036-0000-7000-8000-0000000000e4';
const X_PHONE = '0199e036-0000-7000-8000-0000000000e5';
const X_PENDING = '0199e036-0000-7000-8000-0000000000e6';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
/** The phone's last pull: set once the fixtures are seeded, since the database stamps `server_updated_at` itself. */
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
      id: `0199e036-0000-7000-8000-0000000001${suffix}`,
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
  data: { kind?: 'PHONE' | 'EMAIL'; slot?: number | null; value: string; verified: boolean }
) {
  const kind = data.kind ?? 'PHONE';
  await prisma.organizationContact.create({
    data: {
      id,
      organizationId: org,
      kind,
      slot: kind === 'EMAIL' ? null : (data.slot ?? 1),
      value: data.value,
      verifiedAt: data.verified ? LONG_AGO : null,
      verificationMethod: data.verified ? 'CODE' : null,
      createdById: OWNER,
      createdAt: LONG_AGO,
    },
  });
}

async function seedRelationship(
  id: string,
  data: { customerPersonId?: string; customerOrganizationId?: string; createdAt?: Date }
) {
  await prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId: ORG_A,
      customerPersonId: data.customerPersonId ?? null,
      customerOrganizationId: data.customerOrganizationId ?? null,
      createdById: OWNER,
      createdAt: data.createdAt ?? LONG_AGO,
    },
  });
}

describe('GET /api/v1/sync/pull (organization contacts)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600003601', 'Owner A');
    await seedPerson(MANAGER, '+237600003602', 'Manager A');
    await seedPerson(SELLER, '+237600003603', 'Seller A');
    await seedPerson(DRIVER, '+237600003604', 'Driver A');
    await seedPerson(OWNER_B, '+237600003605', 'Owner B');
    await seedPerson(CUSTOMER, '+237600003606', 'Customer');
    await seedPerson(OWNER_X, '+237600003607', 'Owner X');
    await seedPerson(OUTSIDER, '+237600003608', 'Outsider');
    await seedPerson(LATE_CUSTOMER, '+237600003609', 'Late Customer');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
      [ORG_X, 'Org X'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedCollaboration('01', OWNER, ORG_A, 'OWNER');
    await seedCollaboration('02', MANAGER, ORG_A, 'MANAGER');
    await seedCollaboration('03', SELLER, ORG_A, 'SELLER');
    await seedCollaboration('04', DRIVER, ORG_A, 'DRIVER');
    await seedCollaboration('05', OWNER_B, ORG_B, 'OWNER');
    await seedCollaboration('06', OWNER_X, ORG_X, 'OWNER');

    await seedContact(A_PHONE, ORG_A, { value: '+237677000001', slot: 1, verified: true });
    await seedContact(A_EMAIL, ORG_A, { kind: 'EMAIL', value: 'a@example.test', verified: true });
    await seedContact(A_PENDING, ORG_A, { value: '+237677000002', slot: 2, verified: false });
    await seedContact(B_PHONE, ORG_B, { value: '+237677000003', slot: 1, verified: true });
    await seedContact(X_PHONE, ORG_X, { value: '+237677000004', slot: 1, verified: true });
    await seedContact(X_PENDING, ORG_X, { value: '+237677000005', slot: 2, verified: false });

    await seedRelationship(REL_B, { customerOrganizationId: ORG_B });
    await seedRelationship(REL_CUSTOMER, { customerPersonId: CUSTOMER });
    since = await pulledAtAfterSeeding();
    // Every later write lands clearly after the phone's last pull.
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

  it('team: an owner, a manager and a seller each get the three contacts, pending included (AC-1)', async () => {
    for (const person of [OWNER, MANAGER, SELLER]) {
      const own = (await firstPull(person)).created.filter((r) => r['organization_id'] === ORG_A);
      expect(idsOf(own)).toEqual([A_PHONE, A_EMAIL, A_PENDING].sort());
      const pending = own.find((r) => r['id'] === A_PENDING);
      expect(pending?.['verified_at']).toBeNull();
      expect(pending?.['verification_method']).toBeNull();
      expect(own.find((r) => r['id'] === A_PHONE)?.['verified_at']).toBe(LONG_AGO.getTime());
    }
  });

  it('team: a row is an explicit list, without the author (ASVS v5.0.0-15.3.1)', async () => {
    const row = (await firstPull(OWNER)).created.find((r) => r['id'] === A_PHONE);
    expect(Object.keys(row ?? {}).sort()).toEqual(
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
    expect(row).toMatchObject({ kind: 'PHONE', slot: 1, value: '+237677000001' });
  });

  it('other side: a customer business and a particular customer get the verified contacts only (AC-2)', async () => {
    const business = await firstPull(OWNER_B);
    expect(idsOf(business.created.filter((r) => r['organization_id'] === ORG_A))).toEqual(
      [A_PHONE, A_EMAIL].sort()
    );
    const person = await firstPull(CUSTOMER);
    expect(idsOf(person.created)).toEqual([A_PHONE, A_EMAIL].sort());
    for (const changes of [business, person]) {
      expect(idsOf(changes.created)).not.toContain(A_PENDING);
      expect(changes.deleted).toEqual([]);
    }
  });

  it('other side: the supplier side gets the verified contacts of its customer business (AC-2)', async () => {
    const mine = (await firstPull(OWNER)).created.filter((r) => r['organization_id'] === ORG_B);
    expect(idsOf(mine)).toEqual([B_PHONE]);
  });

  it('closed supplier: customers still get its contacts, its team those of the customer (AC-3)', async () => {
    await prisma.organization.update({ where: { id: ORG_A }, data: { status: 'CLOSED' } });
    expect(idsOf((await firstPull(CUSTOMER)).created)).toEqual([A_PHONE, A_EMAIL].sort());
    expect(idsOf((await firstPull(OWNER_B)).created)).toContain(A_PHONE);

    await prisma.organization.update({ where: { id: ORG_B }, data: { status: 'SUSPENDED' } });
    const team = (await firstPull(SELLER)).created.filter((r) => r['organization_id'] === ORG_B);
    expect(idsOf(team)).toEqual([B_PHONE]);
  });

  it('pending again: the team gets it updated, the other side gets its id in deleted (AC-4, C-35)', async () => {
    await prisma.organizationContact.update({
      where: { id: A_PHONE },
      data: { verifiedAt: null, verificationMethod: null },
    });
    const team = await sincePull(OWNER);
    expect(idsOf(team.updated)).toEqual([A_PHONE]);
    expect(team.updated[0]?.['verified_at']).toBeNull();
    expect(team.deleted).toEqual([]);

    for (const person of [OWNER_B, CUSTOMER]) {
      const other = await sincePull(person);
      expect(other.deleted).toEqual([A_PHONE]);
      expect(other.created).toEqual([]);
      expect(other.updated).toEqual([]);
    }
  });

  it('a contact that is deleted: ids only, in deleted on both sides (C-35)', async () => {
    await prisma.organizationContact.update({
      where: { id: A_EMAIL },
      data: { deletedAt: new Date() },
    });
    expect((await sincePull(MANAGER)).deleted).toEqual([A_EMAIL]);
    expect((await sincePull(CUSTOMER)).deleted).toEqual([A_EMAIL]);
    expect(idsOf((await firstPull(CUSTOMER)).created)).toEqual([A_PHONE]);
  });

  it('a change after the last pull is sent once as updated or created', async () => {
    await prisma.organizationContact.update({
      where: { id: A_EMAIL },
      data: { value: 'a2@example.test' },
    });
    await seedContact('0199e036-0000-7000-8000-0000000000e9', ORG_A, {
      value: '+237677000009',
      slot: 3,
      verified: true,
    });
    await prisma.$executeRaw`UPDATE organization_contacts SET created_at = now(), server_updated_at = now() WHERE id = '0199e036-0000-7000-8000-0000000000e9'::uuid`;
    const other = await sincePull(CUSTOMER);
    expect(idsOf(other.created)).toEqual(['0199e036-0000-7000-8000-0000000000e9']);
    expect(idsOf(other.updated)).toEqual([A_EMAIL]);
    expect(other.deleted).toEqual([]);
    const team = await sincePull(OWNER);
    expect(idsOf(team.updated)).toEqual([A_EMAIL]);
    expect(idsOf(team.created)).toEqual(['0199e036-0000-7000-8000-0000000000e9']);
  });

  it("new relationship: the other side's unchanged verified contacts are sent whole (AC-5)", async () => {
    expect((await sincePull(LATE_CUSTOMER)).created).toEqual([]);
    await seedRelationship('0199e036-0000-7000-8000-0000000000d3', {
      customerPersonId: LATE_CUSTOMER,
      createdAt: new Date(),
    });
    const changes = await sincePull(LATE_CUSTOMER);
    expect(idsOf(changes.created)).toEqual([A_PHONE, A_EMAIL].sort());
    expect(changes.updated).toEqual([]);
    expect(changes.deleted).toEqual([]);
    expect(idsOf(changes.created)).not.toContain(A_PENDING);
    // Already related before the last pull: nothing is repeated.
    expect((await sincePull(CUSTOMER)).created).toEqual([]);
  });

  it('a driver gets no contact of its own business here (SYNC-042)', async () => {
    const changes = await firstPull(DRIVER);
    expect(changes).toEqual({ created: [], updated: [], deleted: [] });
  });

  it('no push: a phone cannot write a contact (AC-6)', async () => {
    await prisma.device.create({
      data: { id: TEST_DEVICE_ID, personId: OWNER, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    const lastPulledAt = await pulledAtAfterSeeding();
    const created = '0199e036-0000-7000-8000-0000000000f1';
    const response = await createAuthenticatedRequest(app, OWNER)
      .post(`/api/v1/sync/push?last_pulled_at=${lastPulledAt}`)
      .send({
        changes: {
          organization_contacts: {
            created: [
              { id: created, organization_id: ORG_A, kind: 'PHONE', value: '+237677999999' },
            ],
            updated: [{ id: A_PHONE, value: '+237677888888' }],
            deleted: [A_EMAIL],
          },
        },
      });
    expect(response.status).toBe(200);
    const body = bodyOf<{ accepted: number; rejected: Array<{ table: string; code: string }> }>(
      response
    );
    expect(body.accepted).toBe(0);
    expect(body.rejected).toHaveLength(3);
    expect(body.rejected.every((r) => r.code === 'SYNC_TABLE_READ_ONLY')).toBe(true);
    expect(await prisma.organizationContact.count({ where: { id: created } })).toBe(0);
    const phone = await prisma.organizationContact.findUniqueOrThrow({ where: { id: A_PHONE } });
    expect(phone.value).toBe('+237677000001');
    const email = await prisma.organizationContact.findUniqueOrThrow({ where: { id: A_EMAIL } });
    expect(email.deletedAt).toBeNull();
  });

  it('no pending leak: no pending or deleted contact of another business is in the answer (AB-1, CWE-200)', async () => {
    await prisma.organizationContact.update({
      where: { id: A_EMAIL },
      data: { deletedAt: new Date() },
    });
    for (const person of [OWNER_B, CUSTOMER]) {
      const full = JSON.stringify(await firstPull(person));
      expect(full).not.toContain('+237677000002');
      expect(full).not.toContain('a@example.test');
      const incremental = JSON.stringify(await sincePull(person));
      expect(incremental).not.toContain('+237677000002');
      expect(incremental).not.toContain('a@example.test');
    }
  });

  it('no pending leak: a pending contact created after the last pull is not even named (AB-1)', async () => {
    await prisma.$executeRaw`UPDATE organization_contacts SET created_at = now(), server_updated_at = now() WHERE id = ${A_PENDING}::uuid`;
    const other = await sincePull(CUSTOMER);
    expect(JSON.stringify(other)).not.toContain(A_PENDING);
  });

  it('no relationship: a business nobody deals with gives nothing to others (AB-2, CWE-639)', async () => {
    const outsider = await firstPull(OUTSIDER);
    expect(outsider).toEqual({ created: [], updated: [], deleted: [] });
    expect(await sincePull(OUTSIDER)).toEqual({ created: [], updated: [], deleted: [] });
    for (const person of [OWNER, OWNER_B, CUSTOMER]) {
      const full = JSON.stringify(await firstPull(person));
      expect(full).not.toContain(X_PHONE);
      expect(full).not.toContain(X_PENDING);
    }
    const x = await firstPull(OWNER_X);
    expect(idsOf(x.created)).toEqual([X_PHONE, X_PENDING].sort());
  });

  it('a relationship ended by deletion no longer gives contacts on a full pull (REL-001 predicate)', async () => {
    await prisma.customerRelationship.update({
      where: { id: REL_CUSTOMER },
      data: { deletedAt: new Date() },
    });
    expect((await firstPull(CUSTOMER)).created).toEqual([]);
  });
});
