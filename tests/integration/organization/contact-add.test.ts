import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const jobs: Array<{ channel: string; to: string; message: string }> = [];
const limiter = { allowed: true };

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: limiter.allowed, remaining: 1 }),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: (d: (typeof jobs)[number]) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));

const { app } = await import('../../../src/app.js');

const OWNER = '0199c024-0000-7000-8000-000000000001';
const MANAGER = '0199c024-0000-7000-8000-000000000002';
const SELLER = '0199c024-0000-7000-8000-000000000003';
const DRIVER = '0199c024-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c024-0000-7000-8000-000000000006';

const ORG_A = '0199c024-0000-7000-8000-0000000000a1';
const ORG_B = '0199c024-0000-7000-8000-0000000000b1';

const REG = new Date('2026-01-01T00:00:00.000Z');
const OWNER_PHONE = '+237600024001';
const OTHER_PHONE = '+237677024100';

const G1 = '0199c024-0000-7000-8000-0000000000c1';
const G2 = '0199c024-0000-7000-8000-0000000000c2';
const G3 = '0199c024-0000-7000-8000-0000000000c3';
const G4 = '0199c024-0000-7000-8000-0000000000c4';

type Contact = {
  id: string;
  kind: string;
  slot: number | null;
  value: string;
  verified_at: string | null;
  verification_method: string | null;
  created_at: string;
};

async function seedPerson(id: string, phone: string, verified = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      ...(verified ? { phoneVerifiedAt: REG } : {}),
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
}

async function seedOrg(
  id: string,
  ownerId: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' = 'ACTIVE'
) {
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({
      data: { id, name: 'Org ' + id.slice(-2), status, maxCollaborators: null },
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

async function seedMember(
  orgId: string,
  personId: string,
  role: 'MANAGER' | 'SELLER' | 'DRIVER',
  idEnd: string
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c024-0000-7000-8000-0000000000${idEnd}`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

function add(orgId: string, body: unknown, personId = OWNER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/contacts`)
    .send(body as object);
}

const goodBody = (over: Record<string, unknown> = {}) => ({
  id: G1,
  kind: 'PHONE',
  slot: 1,
  value: OTHER_PHONE,
  ...over,
});

const contactCount = (orgId = ORG_A) =>
  prisma.organizationContact.count({ where: { organizationId: orgId } });

beforeEach(async () => {
  jobs.length = 0;
  limiter.allowed = true;
  await seedPerson(OWNER, OWNER_PHONE);
  await seedPerson(MANAGER, '+237600024002');
  await seedPerson(SELLER, '+237600024003');
  await seedPerson(DRIVER, '+237600024004');
  await seedPerson(OTHER_OWNER, '+237600024006');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, MANAGER, 'MANAGER', 'a2');
  await seedMember(ORG_A, SELLER, 'SELLER', 'a3');
  await seedMember(ORG_A, DRIVER, 'DRIVER', 'a4');
  await seedOrg(ORG_B, OTHER_OWNER);
});

describe('POST /api/v1/organizations/:organizationId/contacts', () => {
  it('AC-1 stores the owner own verified number as verified at once, with no code', async () => {
    const response = await add(ORG_A, goodBody({ value: OWNER_PHONE }));

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
      kind: 'PHONE',
      slot: 1,
      value: OWNER_PHONE,
      verification_method: 'OWNER_PHONE',
    });
    expect(body.verified_at).not.toBeNull();
    const row = await prisma.organizationContact.findUniqueOrThrow({ where: { id: G1 } });
    expect(row).toMatchObject({ createdById: OWNER, verificationMethod: 'OWNER_PHONE' });
    expect(row.verifiedAt).not.toBeNull();
    expect(jobs).toHaveLength(0);
    expect(await prisma.otpChallenge.count()).toBe(0);
  });

  it('does not verify at once the number of another registered person', async () => {
    const response = await add(ORG_A, goodBody({ value: '+237600024002' }));

    expect(response.status).toBe(201);
    expect(bodyOf<Contact>(response).verified_at).toBeNull();
    expect(jobs).toHaveLength(1);
  });

  it('AC-2 stores another number as pending and sends one code tied to the contact', async () => {
    const response = await add(ORG_A, goodBody({ value: '677 02 41 00' }));

    expect(response.status).toBe(201);
    expect(bodyOf<Contact>(response)).toMatchObject({
      id: G1,
      value: OTHER_PHONE,
      verified_at: null,
      verification_method: null,
    });
    const row = await prisma.organizationContact.findUniqueOrThrow({ where: { id: G1 } });
    expect(row).toMatchObject({ verifiedAt: null, verificationMethod: null, createdById: OWNER });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ channel: 'SMS', to: OTHER_PHONE });
    const challenges = await prisma.otpChallenge.findMany();
    expect(challenges).toHaveLength(1);
    expect(challenges[0]).toMatchObject({
      organizationContactId: G1,
      purpose: 'ORG_CONTACT_VERIFICATION',
      target: OTHER_PHONE,
    });
  });

  it('keeps the contact pending and answers 429 when the code cannot be sent', async () => {
    limiter.allowed = false;

    const response = await add(ORG_A, goodBody());

    expect(response.status).toBe(429);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('OTP_RATE_LIMITED');
    const row = await prisma.organizationContact.findUniqueOrThrow({ where: { id: G1 } });
    expect(row.verifiedAt).toBeNull();
    expect(jobs).toHaveLength(0);
  });

  describe('AC-3 refusals', () => {
    it('answers 409 CONTACT_SLOT_TAKEN for a taken slot', async () => {
      expect((await add(ORG_A, goodBody())).status).toBe(201);

      const response = await add(ORG_A, goodBody({ id: G2, value: '+237677024101' }));

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('CONTACT_SLOT_TAKEN');
      expect(await contactCount()).toBe(1);
    });

    it('answers 409 CONTACT_SLOT_TAKEN for a fourth number: the three slots are held, pending ones included', async () => {
      await add(ORG_A, goodBody());
      await add(ORG_A, goodBody({ id: G2, slot: 2, value: '+237677024101' }));
      await add(ORG_A, goodBody({ id: G3, slot: 3, value: '+237677024102' }));
      jobs.length = 0;

      const response = await add(ORG_A, goodBody({ id: G4, slot: 3, value: '+237677024103' }));

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('CONTACT_SLOT_TAKEN');
      expect(await contactCount()).toBe(3);
      expect(jobs).toHaveLength(0);
    });

    it('answers 409 CONTACT_ALREADY_EXISTS for a number already listed, in another slot', async () => {
      await add(ORG_A, goodBody());
      jobs.length = 0;

      const response = await add(ORG_A, goodBody({ id: G2, slot: 2 }));

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('CONTACT_ALREADY_EXISTS');
      expect(await contactCount()).toBe(1);
      expect(jobs).toHaveLength(0);
    });

    it('lets a deleted contact free its slot and its number', async () => {
      await add(ORG_A, goodBody());
      await prisma.organizationContact.update({
        where: { id: G1 },
        data: { deletedAt: new Date() },
      });

      const response = await add(ORG_A, goodBody({ id: G2 }));

      expect(response.status).toBe(201);
    });

    it('lets two businesses list the same number', async () => {
      await add(ORG_A, goodBody());

      const response = await add(ORG_B, goodBody({ id: G2 }), OTHER_OWNER);

      expect(response.status).toBe(201);
    });

    it.each([
      ['a number outside Cameroon', '+33612345678'],
      ['a Cameroon landline', '+237222123456'],
    ])('answers 400 UNSUPPORTED_NUMBER for %s and stores nothing', async (_label, value) => {
      const response = await add(ORG_A, goodBody({ value }));

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('UNSUPPORTED_NUMBER');
      expect(JSON.stringify(response.body)).not.toContain(value.slice(-8));
      expect(await contactCount()).toBe(0);
      expect(jobs).toHaveLength(0);
    });

    it.each([
      ['an unknown field', (b: Record<string, unknown>) => ({ ...b, verified_at: '2026-01-01' })],
      ['no slot', ({ slot: _slot, ...b }: Record<string, unknown>) => b],
      ['slot 4', (b: Record<string, unknown>) => ({ ...b, slot: 4 })],
      ['slot 0', (b: Record<string, unknown>) => ({ ...b, slot: 0 })],
      ['kind EMAIL', (b: Record<string, unknown>) => ({ ...b, kind: 'EMAIL' })],
      ['no id', ({ id: _id, ...b }: Record<string, unknown>) => b],
      ['a text that is no number', (b: Record<string, unknown>) => ({ ...b, value: 'abc' })],
    ])('answers 400 VALIDATION_ERROR for %s', async (_label, mutate) => {
      const response = await add(ORG_A, mutate(goodBody()));

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await contactCount()).toBe(0);
      expect(jobs).toHaveLength(0);
    });

    it.each(['SUSPENDED', 'CLOSED'] as const)(
      'answers 409 ORGANIZATION_NOT_ACTIVE for a %s business',
      async (status) => {
        const org = '0199c024-0000-7000-8000-0000000000e1';
        await seedOrg(org, OWNER, status);

        const response = await add(org, goodBody());

        expect(response.status).toBe(409);
        expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
        expect(await contactCount(org)).toBe(0);
        expect(jobs).toHaveLength(0);
      }
    );

    it('answers 404 for a person who is not a member', async () => {
      const response = await add(ORG_A, goodBody(), OTHER_OWNER);

      expect(response.status).toBe(404);
      expect(await contactCount()).toBe(0);
    });
  });

  it('AC-4 a repeat with the same id returns the first answer and keeps one contact', async () => {
    const first = await add(ORG_A, goodBody());
    const second = await add(ORG_A, goodBody());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await contactCount()).toBe(1);
    expect(jobs).toHaveLength(1);
  });

  it('answers the same refusal when two requests race for the same slot', async () => {
    const [a, b] = await Promise.all([
      add(ORG_A, goodBody({ id: G1, value: '+237677024101' })),
      add(ORG_A, goodBody({ id: G2, value: '+237677024102' })),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(bodyOf<ErrorBody>(loser).error.code).toBe('CONTACT_SLOT_TAKEN');
    expect(await contactCount()).toBe(1);
  });

  it('AB-1 a number that is not the owner and never confirmed stays pending and finds nothing', async () => {
    const response = await add(ORG_A, goodBody({ verified_at: '2026-01-01T00:00:00.000Z' }));
    expect(response.status).toBe(400);

    const ok = await add(ORG_A, goodBody());
    expect(ok.status).toBe(201);
    const row = await prisma.organizationContact.findUniqueOrThrow({ where: { id: G1 } });
    expect(row.verifiedAt).toBeNull();
    expect(row.verificationMethod).toBeNull();

    const lookup = await createAuthenticatedRequest(app, SELLER).get(
      `/api/v1/organizations/lookup?phone=${encodeURIComponent(OTHER_PHONE)}`
    );
    expect(JSON.stringify(lookup.body)).not.toContain(ORG_A);
  });

  it.each([
    ['MANAGER', MANAGER],
    ['SELLER', SELLER],
    ['DRIVER', DRIVER],
  ])('AB-2 refuses a %s with 403 FORBIDDEN and stores and sends nothing', async (_role, who) => {
    const response = await add(ORG_A, goodBody(), who);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await contactCount()).toBe(0);
    expect(jobs).toHaveLength(0);
    expect(await prisma.otpChallenge.count()).toBe(0);
  });
});
