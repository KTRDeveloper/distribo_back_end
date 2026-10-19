import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashOtp } from '../../../src/lib/otp.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: () => Promise.resolve(),
}));

const { app } = await import('../../../src/app.js');

const OWNER = '0199c025-0000-7000-8000-000000000001';
const MANAGER = '0199c025-0000-7000-8000-000000000002';
const OTHER_OWNER = '0199c025-0000-7000-8000-000000000006';

const ORG_A = '0199c025-0000-7000-8000-0000000000a1';
const ORG_B = '0199c025-0000-7000-8000-0000000000b1';

const CONTACT_A = '0199c025-0000-7000-8000-0000000000d1';
const CONTACT_B = '0199c025-0000-7000-8000-0000000000d2';
const PHONE = '+237677025100';
const CODE = '123456';
const WRONG = '654321';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Contact = {
  id: string;
  kind: string;
  slot: number | null;
  value: string;
  verified_at: string | null;
  verification_method: string | null;
  created_at: string;
};

let gestureCounter = 0;
/** A fresh UUIDv7 gesture id for each request, as a real client sends one per attempt. */
function gestureId(): string {
  gestureCounter += 1;
  return `0199c025-0000-7000-8000-${String(gestureCounter).padStart(12, '0').replace(/^0/, 'f')}`;
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

async function seedCode(contactId: string, over: { expiresAt?: Date; code?: string } = {}) {
  await prisma.otpChallenge.create({
    data: {
      id: contactId.replace(/.$/, 'e'),
      personId: null,
      target: PHONE,
      purpose: 'ORG_CONTACT_VERIFICATION',
      channel: 'SMS',
      codeHash: await hashOtp(over.code ?? CODE),
      expiresAt: over.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000),
      organizationContactId: contactId,
    },
  });
}

function confirm(
  orgId: string,
  contactId: string,
  body: unknown = { id: gestureId(), code: CODE },
  personId = OWNER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/contacts/${contactId}/confirm`)
    .send(body as object);
}

const stored = (id: string) => prisma.organizationContact.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await seedPerson(OWNER, '+237600025001');
  await seedPerson(MANAGER, '+237600025002');
  await seedPerson(OTHER_OWNER, '+237600025006');
  await seedOrg(ORG_A, OWNER);
  await prisma.collaboration.create({
    data: {
      id: '0199c025-0000-7000-8000-0000000000a2',
      personId: MANAGER,
      organizationId: ORG_A,
      role: 'MANAGER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  await seedOrg(ORG_B, OTHER_OWNER);
});

describe('POST /api/v1/organizations/:organizationId/contacts/:contactId/confirm', () => {
  it('AC-1 the right code publishes the contact with server time and method CODE', async () => {
    await seedContact(CONTACT_A, ORG_A);
    await seedCode(CONTACT_A);
    const before = Date.now();

    const response = await confirm(ORG_A, CONTACT_A);

    expect(response.status).toBe(200);
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
      id: CONTACT_A,
      value: PHONE,
      slot: 1,
      verification_method: 'CODE',
    });
    expect(new Date(body.verified_at!).getTime()).toBeGreaterThanOrEqual(before - 1000);
    const row = await stored(CONTACT_A);
    expect(row.verifiedAt).not.toBeNull();
    expect(row.verificationMethod).toBe('CODE');
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { organizationContactId: CONTACT_A },
    });
    expect(challenge.consumedAt).not.toBeNull();
  });

  describe('AC-2 refusals', () => {
    it('answers 400 OTP_INVALID for a wrong code', async () => {
      await seedContact(CONTACT_A, ORG_A);
      await seedCode(CONTACT_A);

      const response = await confirm(ORG_A, CONTACT_A, { id: gestureId(), code: WRONG });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OTP_INVALID');
      expect((await stored(CONTACT_A)).verifiedAt).toBeNull();
    });

    it('answers 400 OTP_EXPIRED for an expired code', async () => {
      await seedContact(CONTACT_A, ORG_A);
      await seedCode(CONTACT_A, { expiresAt: new Date(Date.now() - 1000) });

      const response = await confirm(ORG_A, CONTACT_A);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OTP_EXPIRED');
      expect((await stored(CONTACT_A)).verifiedAt).toBeNull();
    });

    it('answers 409 CONTACT_ALREADY_VERIFIED and consumes no code', async () => {
      await seedContact(CONTACT_A, ORG_A, { verified: true });
      await seedCode(CONTACT_A);

      const response = await confirm(ORG_A, CONTACT_A);

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('CONTACT_ALREADY_VERIFIED');
      const challenge = await prisma.otpChallenge.findFirstOrThrow({
        where: { organizationContactId: CONTACT_A },
      });
      expect(challenge).toMatchObject({ attempts: 0, consumedAt: null });
      expect((await stored(CONTACT_A)).verificationMethod).toBe('OWNER_PHONE');
    });

    it('answers 404 NOT_FOUND for a deleted contact and consumes no code', async () => {
      await seedContact(CONTACT_A, ORG_A, { deleted: true });
      await seedCode(CONTACT_A);

      const response = await confirm(ORG_A, CONTACT_A);

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect((await stored(CONTACT_A)).verifiedAt).toBeNull();
      const challenge = await prisma.otpChallenge.findFirstOrThrow({
        where: { organizationContactId: CONTACT_A },
      });
      expect(challenge.attempts).toBe(0);
    });

    it('answers 404 NOT_FOUND for a contact of another business and consumes no code', async () => {
      await seedContact(CONTACT_B, ORG_B);
      await seedCode(CONTACT_B);

      const response = await confirm(ORG_A, CONTACT_B);

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect((await stored(CONTACT_B)).verifiedAt).toBeNull();
      const challenge = await prisma.otpChallenge.findFirstOrThrow({
        where: { organizationContactId: CONTACT_B },
      });
      expect(challenge.attempts).toBe(0);
    });

    it('answers 404 NOT_FOUND for an unknown contact', async () => {
      const response = await confirm(ORG_A, CONTACT_B);

      expect(response.status).toBe(404);
    });

    it.each([
      ['an unknown field', (b: Record<string, unknown>) => ({ ...b, verified_at: '2026-01-01' })],
      ['a code of five digits', (b: Record<string, unknown>) => ({ ...b, code: '12345' })],
      ['a code with letters', (b: Record<string, unknown>) => ({ ...b, code: '12345a' })],
      ['no id', ({ id: _id, ...b }: Record<string, unknown>) => b],
      ['no code', ({ code: _code, ...b }: Record<string, unknown>) => b],
    ])('answers 400 VALIDATION_ERROR for %s and uses no attempt', async (_label, mutate) => {
      await seedContact(CONTACT_A, ORG_A);
      await seedCode(CONTACT_A);

      const response = await confirm(ORG_A, CONTACT_A, mutate({ id: gestureId(), code: CODE }));

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect((await stored(CONTACT_A)).verifiedAt).toBeNull();
      const challenge = await prisma.otpChallenge.findFirstOrThrow({
        where: { organizationContactId: CONTACT_A },
      });
      expect(challenge.attempts).toBe(0);
    });

    it('answers 400 VALIDATION_ERROR for a malformed contact id', async () => {
      const response = await confirm(ORG_A, 'not-a-uuid');

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    });
  });

  it('AC-3 a repeat with the same id returns the first answer', async () => {
    await seedContact(CONTACT_A, ORG_A);
    await seedCode(CONTACT_A);
    const body = { id: gestureId(), code: CODE };

    const first = await confirm(ORG_A, CONTACT_A, body);
    const second = await confirm(ORG_A, CONTACT_A, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { organizationContactId: CONTACT_A },
    });
    expect(challenge.attempts).toBe(1);
  });

  it('AC-4 refuses a MANAGER with 403 FORBIDDEN and uses no attempt', async () => {
    await seedContact(CONTACT_A, ORG_A);
    await seedCode(CONTACT_A);

    const response = await confirm(ORG_A, CONTACT_A, undefined, MANAGER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect((await stored(CONTACT_A)).verifiedAt).toBeNull();
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { organizationContactId: CONTACT_A },
    });
    expect(challenge.attempts).toBe(0);
  });

  it('answers 404 to a person who is not a member of the business', async () => {
    await seedContact(CONTACT_A, ORG_A);
    await seedCode(CONTACT_A);

    const response = await confirm(ORG_A, CONTACT_A, undefined, OTHER_OWNER);

    expect(response.status).toBe(404);
    expect((await stored(CONTACT_A)).verifiedAt).toBeNull();
  });

  it('AB-1 six wrong codes lock the contact: the sixth is 429 OTP_LOCKED, even the right code then', async () => {
    await seedContact(CONTACT_A, ORG_A);
    await seedCode(CONTACT_A);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const wrong = await confirm(ORG_A, CONTACT_A, { id: gestureId(), code: WRONG });
      expect(wrong.status).toBe(400);
      expect(bodyOf<ErrorBody>(wrong).error.code).toBe('OTP_INVALID');
    }
    const sixth = await confirm(ORG_A, CONTACT_A, { id: gestureId(), code: WRONG });
    expect(sixth.status).toBe(429);
    expect(bodyOf<ErrorBody>(sixth).error.code).toBe('OTP_LOCKED');

    const right = await confirm(ORG_A, CONTACT_A, { id: gestureId(), code: CODE });
    expect(right.status).toBe(429);
    expect(bodyOf<ErrorBody>(right).error.code).toBe('OTP_LOCKED');
    const row = await stored(CONTACT_A);
    expect(row.verifiedAt).toBeNull();
    expect(row.verificationMethod).toBeNull();
  });

  it('AB-2 the code issued for the same number in another business does not confirm this contact', async () => {
    await seedContact(CONTACT_A, ORG_A);
    await seedContact(CONTACT_B, ORG_B);
    await seedCode(CONTACT_A);

    const response = await confirm(ORG_B, CONTACT_B, { id: gestureId(), code: CODE }, OTHER_OWNER);

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('OTP_INVALID');
    expect((await stored(CONTACT_B)).verifiedAt).toBeNull();
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { organizationContactId: CONTACT_A },
    });
    expect(challenge).toMatchObject({ attempts: 0, consumedAt: null });
  });
});
