import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const jobs: Array<{ channel: string; to: string; message: string; subject?: string }> = [];

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: (d: (typeof jobs)[number]) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));

const { app } = await import('../../../src/app.js');

const OWNER = '0199c042-0000-7000-8000-000000000001';
const MANAGER = '0199c042-0000-7000-8000-000000000002';
const OTHER_OWNER = '0199c042-0000-7000-8000-000000000006';
const ORG_A = '0199c042-0000-7000-8000-0000000000a1';
const ORG_B = '0199c042-0000-7000-8000-0000000000b1';
const REG = new Date('2026-01-01T00:00:00.000Z');

const G1 = '0199c042-0000-7000-8000-0000000000c1';
const G2 = '0199c042-0000-7000-8000-0000000000c2';

type Contact = {
  id: string;
  kind: string;
  slot: number | null;
  value: string;
  verified_at: string | null;
  verification_method: string | null;
  created_at: string;
};

async function seedPerson(id: string, phone: string, email?: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      ...(email ? { email, emailVerifiedAt: REG } : {}),
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
}

async function seedOrg(id: string, ownerId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({
      data: { id, name: 'Shop ' + id.slice(-2), status: 'ACTIVE', maxCollaborators: null },
    });
    await tx.collaboration.create({
      data: {
        id: id.replace(/.$/, '9'),
        personId: ownerId,
        organizationId: id,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  });
}

function add(orgId: string, body: unknown, personId = OWNER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/contacts`)
    .send(body as object);
}

const emailBody = (over: Record<string, unknown> = {}) => ({
  id: G1,
  kind: 'EMAIL',
  value: 'Shop@Example.cm',
  ...over,
});

const contactCount = (orgId = ORG_A) =>
  prisma.organizationContact.count({ where: { organizationId: orgId } });

beforeEach(async () => {
  jobs.length = 0;
  await seedPerson(OWNER, '+237600042001', 'owner@example.cm');
  await seedPerson(MANAGER, '+237600042002');
  await seedPerson(OTHER_OWNER, '+237600042006');
  await seedOrg(ORG_A, OWNER);
  await seedOrg(ORG_B, OTHER_OWNER);
  await prisma.collaboration.create({
    data: {
      id: '0199c042-0000-7000-8000-0000000000a2',
      personId: MANAGER,
      organizationId: ORG_A,
      role: 'MANAGER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
});

describe('POST /api/v1/organizations/:organizationId/contacts with an email', () => {
  it('AC-1 stores the email in lower case, pending, and sends one email code tied to it', async () => {
    const response = await add(ORG_A, emailBody());

    expect(response.status).toBe(201);
    const body = bodyOf<Contact>(response);
    expect(Object.keys(body).sort()).toEqual([
      'created_at',
      'id',
      'kind',
      'slot',
      'value',
      'verification_method',
      'verified_at',
    ]);
    expect(body).toMatchObject({
      id: G1,
      kind: 'EMAIL',
      slot: null,
      value: 'shop@example.cm',
      verified_at: null,
      verification_method: null,
    });
    const row = await prisma.organizationContact.findUniqueOrThrow({ where: { id: G1 } });
    expect(row).toMatchObject({ createdById: OWNER, value: 'shop@example.cm', slot: null });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ channel: 'EMAIL', to: 'shop@example.cm' });
    const challenges = await prisma.otpChallenge.findMany();
    expect(challenges).toHaveLength(1);
    expect(challenges[0]).toMatchObject({
      organizationContactId: G1,
      purpose: 'ORG_CONTACT_VERIFICATION',
      target: 'shop@example.cm',
      channel: 'EMAIL',
    });
  });

  it('trims the address before storing it', async () => {
    const response = await add(ORG_A, emailBody({ value: '  Shop@Example.cm  ' }));

    expect(response.status).toBe(201);
    expect(bodyOf<Contact>(response).value).toBe('shop@example.cm');
  });

  it('AC-2 does not trust the owner own verified email: pending and a code is sent', async () => {
    const response = await add(ORG_A, emailBody({ value: 'owner@example.cm' }));

    expect(response.status).toBe(201);
    expect(bodyOf<Contact>(response)).toMatchObject({
      verified_at: null,
      verification_method: null,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ channel: 'EMAIL', to: 'owner@example.cm' });
  });

  describe('AC-3 refusals', () => {
    it('answers 409 CONTACT_SLOT_TAKEN for a second email', async () => {
      expect((await add(ORG_A, emailBody())).status).toBe(201);
      jobs.length = 0;

      const response = await add(ORG_A, emailBody({ id: G2, value: 'other@example.cm' }));

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('CONTACT_SLOT_TAKEN');
      expect(await contactCount()).toBe(1);
      expect(jobs).toHaveLength(0);
    });

    it('answers 409 CONTACT_ALREADY_EXISTS for the same address written in capitals', async () => {
      expect((await add(ORG_A, emailBody())).status).toBe(201);
      jobs.length = 0;

      const response = await add(ORG_A, emailBody({ id: G2, value: 'SHOP@EXAMPLE.CM' }));

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('CONTACT_ALREADY_EXISTS');
      expect(await contactCount()).toBe(1);
      expect(jobs).toHaveLength(0);
    });

    it.each([
      ['not-an-address', (b: Record<string, unknown>) => ({ ...b, value: 'not-an-address' })],
      ['an email with a slot', (b: Record<string, unknown>) => ({ ...b, slot: 1 })],
      [
        'an address over 254 characters',
        (b: Record<string, unknown>) => ({ ...b, value: `${'a'.repeat(250)}@example.cm` }),
      ],
      ['an unknown field', (b: Record<string, unknown>) => ({ ...b, verified_at: '2026-01-01' })],
    ])('answers 400 VALIDATION_ERROR for %s', async (_label, mutate) => {
      const response = await add(ORG_A, mutate(emailBody()));

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await contactCount()).toBe(0);
      expect(jobs).toHaveLength(0);
    });

    it('lets a deleted email free its place', async () => {
      await add(ORG_A, emailBody());
      await prisma.organizationContact.update({
        where: { id: G1 },
        data: { deletedAt: new Date() },
      });

      const response = await add(ORG_A, emailBody({ id: G2 }));

      expect(response.status).toBe(201);
    });

    it('lets two businesses list the same email', async () => {
      await add(ORG_A, emailBody());

      const response = await add(ORG_B, emailBody({ id: G2 }), OTHER_OWNER);

      expect(response.status).toBe(201);
    });

    it('refuses a non owner with 403 and stores nothing', async () => {
      const response = await add(ORG_A, emailBody(), MANAGER);

      expect(response.status).toBe(403);
      expect(await contactCount()).toBe(0);
      expect(jobs).toHaveLength(0);
    });
  });

  it('answers the same refusal when two requests race for the one email place', async () => {
    const [a, b] = await Promise.all([
      add(ORG_A, emailBody({ id: G1, value: 'one@example.cm' })),
      add(ORG_A, emailBody({ id: G2, value: 'two@example.cm' })),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(bodyOf<ErrorBody>(loser).error.code).toBe('CONTACT_SLOT_TAKEN');
    expect(await contactCount()).toBe(1);
  });

  it('AB-1 an address never confirmed stays pending and unverified', async () => {
    const forged = await add(ORG_A, emailBody({ verified_at: '2026-01-01T00:00:00.000Z' }));
    expect(forged.status).toBe(400);

    const ok = await add(ORG_A, emailBody({ value: 'someone-else@example.cm' }));
    expect(ok.status).toBe(201);

    const row = await prisma.organizationContact.findUniqueOrThrow({ where: { id: G1 } });
    expect(row.verifiedAt).toBeNull();
    expect(row.verificationMethod).toBeNull();
  });
});
