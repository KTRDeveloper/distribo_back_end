import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const jobs: Array<{ channel: string; to: string; message: string }> = [];
/** Counters per limiter key, so the 60-second pause and the hourly cap really bite. */
const counters = new Map<string, number>();

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: (key: string, limit: number) => {
    const used = (counters.get(key) ?? 0) + 1;
    counters.set(key, used);
    return Promise.resolve({ allowed: used <= limit, remaining: Math.max(limit - used, 0) });
  },
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: (d: (typeof jobs)[number]) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));

const { app } = await import('../../../src/app.js');

const OWNER = '0199c026-0000-7000-8000-000000000001';
const MANAGER = '0199c026-0000-7000-8000-000000000002';
const OTHER_OWNER = '0199c026-0000-7000-8000-000000000006';

const ORG_A = '0199c026-0000-7000-8000-0000000000a1';
const ORG_B = '0199c026-0000-7000-8000-0000000000b1';

const CONTACT_A = '0199c026-0000-7000-8000-0000000000d1';
const CONTACT_B = '0199c026-0000-7000-8000-0000000000d2';
const PHONE = '+237677026100';

const REG = new Date('2026-01-01T00:00:00.000Z');

let gestureCounter = 0;
/** A fresh UUIDv7 gesture id for each request, as a real client sends one per attempt. */
function gestureId(): string {
  gestureCounter += 1;
  return `0199c026-0000-7000-8000-${String(gestureCounter).padStart(12, '0').replace(/^0/, 'f')}`;
}

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

async function seedOrg(id: string, ownerId: string) {
  await prisma.organization.create({
    data: { id, name: 'Org ' + id.slice(-2), status: 'ACTIVE', maxCollaborators: null },
  });
  await prisma.collaboration.create({
    data: {
      id: id.replace(/.$/, '9'),
      personId: ownerId,
      organizationId: id,
      role: 'OWNER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedContact(
  id: string,
  organizationId: string,
  over: { verified?: boolean; deleted?: boolean } = {}
) {
  await prisma.organizationContact.create({
    data: {
      id,
      organizationId,
      kind: 'PHONE',
      slot: 1,
      value: PHONE,
      createdById: organizationId === ORG_A ? OWNER : OTHER_OWNER,
      ...(over.verified ? { verifiedAt: REG, verificationMethod: 'OWNER_PHONE' as const } : {}),
      ...(over.deleted ? { deletedAt: REG } : {}),
    },
  });
}

function resend(
  orgId: string,
  contactId: string,
  body: unknown = { id: gestureId() },
  personId = OWNER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/contacts/${contactId}/resend`)
    .send(body as object);
}

function confirm(orgId: string, contactId: string, code: string) {
  return createAuthenticatedRequest(app, OWNER)
    .post(`/api/v1/organizations/${orgId}/contacts/${contactId}/confirm`)
    .send({ id: gestureId(), code });
}

const codeOf = (job: { message: string }) => /Code (\d{6})\./.exec(job.message)![1];

beforeEach(async () => {
  jobs.length = 0;
  counters.clear();
  await seedPerson(OWNER, '+237600026001');
  await seedPerson(MANAGER, '+237600026002');
  await seedPerson(OTHER_OWNER, '+237600026006');
  await seedOrg(ORG_A, OWNER);
  await prisma.collaboration.create({
    data: {
      id: '0199c026-0000-7000-8000-0000000000a2',
      personId: MANAGER,
      organizationId: ORG_A,
      role: 'MANAGER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  await seedOrg(ORG_B, OTHER_OWNER);
});

describe('POST /api/v1/organizations/:organizationId/contacts/:contactId/resend', () => {
  it('AC-1 sends a new code to the same value', async () => {
    await seedContact(CONTACT_A, ORG_A);

    const response = await resend(ORG_A, CONTACT_A);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ sent: true, expires_in: 600 });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ channel: 'SMS', to: PHONE });
    const challenges = await prisma.otpChallenge.findMany();
    expect(challenges).toHaveLength(1);
    expect(challenges[0]).toMatchObject({
      organizationContactId: CONTACT_A,
      purpose: 'ORG_CONTACT_VERIFICATION',
      target: PHONE,
    });
  });

  it('AC-2 a second request within 60 seconds is 429 OTP_RATE_LIMITED and queues nothing', async () => {
    await seedContact(CONTACT_A, ORG_A);
    expect((await resend(ORG_A, CONTACT_A)).status).toBe(200);

    const second = await resend(ORG_A, CONTACT_A);

    expect(second.status).toBe(429);
    expect(bodyOf<ErrorBody>(second).error.code).toBe('OTP_RATE_LIMITED');
    expect(jobs).toHaveLength(1);
    expect(await prisma.otpChallenge.count()).toBe(1);
  });

  describe('AC-3 refusals', () => {
    it('answers 409 CONTACT_ALREADY_VERIFIED for a verified contact', async () => {
      await seedContact(CONTACT_A, ORG_A, { verified: true });

      const response = await resend(ORG_A, CONTACT_A);

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('CONTACT_ALREADY_VERIFIED');
      expect(jobs).toHaveLength(0);
    });

    it('answers 404 NOT_FOUND for a deleted contact', async () => {
      await seedContact(CONTACT_A, ORG_A, { deleted: true });

      const response = await resend(ORG_A, CONTACT_A);

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(jobs).toHaveLength(0);
    });

    it('answers 404 NOT_FOUND for a contact of another business', async () => {
      await seedContact(CONTACT_B, ORG_B);

      const response = await resend(ORG_A, CONTACT_B);

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(jobs).toHaveLength(0);
    });

    it.each([
      ['an unknown field', { id: gestureId(), extra: 1 }],
      ['no id', {}],
    ])('answers 400 VALIDATION_ERROR for %s and queues nothing', async (_label, body) => {
      await seedContact(CONTACT_A, ORG_A);

      const response = await resend(ORG_A, CONTACT_A, body);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(jobs).toHaveLength(0);
    });
  });

  it('AC-4 the first code is dead once a second one was sent', async () => {
    await seedContact(CONTACT_A, ORG_A);
    expect((await resend(ORG_A, CONTACT_A)).status).toBe(200);
    // The 60-second pause passes: only the pause counter is reset, the hourly one stays.
    for (const key of [...counters.keys()])
      if (key.startsWith('otp:cooldown:')) counters.delete(key);
    expect((await resend(ORG_A, CONTACT_A)).status).toBe(200);
    expect(jobs).toHaveLength(2);
    const [first, second] = jobs.map(codeOf);
    expect(first).not.toBe(second);

    const old = await confirm(ORG_A, CONTACT_A, first);

    expect(old.status).toBe(400);
    expect(bodyOf<ErrorBody>(old).error.code).toBe('OTP_INVALID');
    const row = await prisma.organizationContact.findUniqueOrThrow({ where: { id: CONTACT_A } });
    expect(row.verifiedAt).toBeNull();

    const fresh = await confirm(ORG_A, CONTACT_A, second);
    expect(fresh.status).toBe(200);
  });

  it('AB-1 a MANAGER gets 403 FORBIDDEN and nothing is queued', async () => {
    await seedContact(CONTACT_A, ORG_A);

    const response = await resend(ORG_A, CONTACT_A, undefined, MANAGER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(jobs).toHaveLength(0);
    expect(await prisma.otpChallenge.count()).toBe(0);
  });

  it('answers 404 to a person who is not a member of the business', async () => {
    await seedContact(CONTACT_A, ORG_A);

    const response = await resend(ORG_A, CONTACT_A, undefined, OTHER_OWNER);

    expect(response.status).toBe(404);
    expect(jobs).toHaveLength(0);
  });

  it('a repeat with the same gesture id returns the first answer and queues one job', async () => {
    await seedContact(CONTACT_A, ORG_A);
    const body = { id: gestureId() };

    const first = await resend(ORG_A, CONTACT_A, body);
    const second = await resend(ORG_A, CONTACT_A, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(jobs).toHaveLength(1);
  });
});
