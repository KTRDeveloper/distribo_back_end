import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const { app } = await import('../../../src/app.js');
const { createTotpSecret, encryptSecret, decryptSecret } = await import('../../../src/lib/totp.js');
const { signAdminToken, signAccessToken } = await import('../../../src/lib/jwt.js');
const { seedAccount } = await import('../../helpers/database.js');
const { newId } = await import('../../../src/shared/ids.js');
const { uniquePhone } = await import('../../helpers/phone.js');

type Role = 'MODERATOR' | 'SUPER_ADMIN';
type Body = {
  id?: string;
  role?: string;
  otpauth_uri?: string;
  person_public?: { public_name: string | null; phone_number: string | null; registered: boolean };
  error?: { code: string };
};

async function seedAdmin(role: Role) {
  const person = await seedAccount({
    email: `admin${newId().slice(-8)}@example.test`,
    password: 'fixture-admin-password-1',
    name: 'Fixture Admin',
  });
  const administratorId = newId();
  await prisma.administrator.create({
    data: {
      id: administratorId,
      personId: person.id,
      role,
      totpSecret: encryptSecret(createTotpSecret().secret),
    },
  });
  const token = signAdminToken({ personId: person.id, administratorId, role });
  return { person, administratorId, token };
}

async function seedCandidate() {
  return seedAccount({
    email: `cand${newId().slice(-8)}@example.test`,
    password: 'fixture-candidate-password-1',
    name: 'Fixture Candidate',
  });
}

const appoint = (token: string | null, body: object) => {
  const r = request(app).post('/api/v1/admin/administrators');
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body);
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const counts = async () => ({
  administrators: await prisma.administrator.count(),
  actions: await prisma.adminAction.count(),
});

describe('super administrator appoints an administrator', () => {
  it('appoint: creates the administrator, the journal row and returns the URI once (AC-1, C-29)', async () => {
    const caller = await seedAdmin('SUPER_ADMIN');
    const candidate = await seedCandidate();
    const id = newId();

    const res = await appoint(caller.token, {
      id,
      phone_number: candidate.phoneNumber,
      role: 'MODERATOR',
      reason: 'renfort',
    });

    expect(res.status).toBe(201);
    const body = bodyOf(res);
    expect(body.id).toBe(id);
    expect(body.role).toBe('MODERATOR');
    expect(body.person_public).toEqual({
      public_name: 'Fixture Candidate',
      phone_number: candidate.phoneNumber,
      registered: true,
    });
    expect(body.otpauth_uri).toMatch(/^otpauth:\/\/totp\//);
    expect(Object.keys(body).sort()).toEqual(['id', 'otpauth_uri', 'person_public', 'role']);

    const row = await prisma.administrator.findUniqueOrThrow({ where: { id } });
    expect(row.personId).toBe(candidate.id);
    expect(row.role).toBe('MODERATOR');
    expect(row.removedAt).toBeNull();
    const plain = new URL(body.otpauth_uri!).searchParams.get('secret')!;
    expect(row.totpSecret).not.toContain(plain);
    expect(decryptSecret(row.totpSecret)).toBe(plain);

    const journal = await prisma.adminAction.findMany({ where: { targetPersonId: candidate.id } });
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      action: 'APPOINT_ADMIN',
      administratorId: caller.administratorId,
      reason: 'renfort',
      targetOrganizationId: null,
      syncArchiveId: null,
    });
  });

  it('appoint: a SUPER_ADMIN can be appointed too', async () => {
    const caller = await seedAdmin('SUPER_ADMIN');
    const candidate = await seedCandidate();

    const res = await appoint(caller.token, {
      id: newId(),
      phone_number: candidate.phoneNumber,
      role: 'SUPER_ADMIN',
      reason: 'direction',
    });

    expect(res.status).toBe(201);
    expect(bodyOf(res).role).toBe('SUPER_ADMIN');
  });

  describe('refusals store nothing (AC-2)', () => {
    it('a guest number: 404 NOT_FOUND', async () => {
      const caller = await seedAdmin('SUPER_ADMIN');
      const phone = uniquePhone();
      await prisma.person.create({ data: { id: newId(), phoneNumber: phone } });
      const before = await counts();

      const res = await appoint(caller.token, {
        id: newId(),
        phone_number: phone,
        role: 'MODERATOR',
        reason: 'renfort',
      });

      expect(res.status).toBe(404);
      expect(bodyOf(res).error?.code).toBe('NOT_FOUND');
      expect(await counts()).toEqual(before);
    });

    it('an unknown number: 404 NOT_FOUND', async () => {
      const caller = await seedAdmin('SUPER_ADMIN');
      const before = await counts();

      const res = await appoint(caller.token, {
        id: newId(),
        phone_number: uniquePhone(),
        role: 'MODERATOR',
        reason: 'renfort',
      });

      expect(res.status).toBe(404);
      expect(bodyOf(res).error?.code).toBe('NOT_FOUND');
      expect(await counts()).toEqual(before);
    });

    it('a person who is already an administrator: 409 ALREADY_ADMINISTRATOR', async () => {
      const caller = await seedAdmin('SUPER_ADMIN');
      const other = await seedAdmin('MODERATOR');
      const before = await counts();

      const res = await appoint(caller.token, {
        id: newId(),
        phone_number: other.person.phoneNumber,
        role: 'SUPER_ADMIN',
        reason: 'promotion',
      });

      expect(res.status).toBe(409);
      expect(bodyOf(res).error?.code).toBe('ALREADY_ADMINISTRATOR');
      expect(await counts()).toEqual(before);
    });

    it('a removed administrator can be appointed again', async () => {
      const caller = await seedAdmin('SUPER_ADMIN');
      const other = await seedAdmin('MODERATOR');
      await prisma.administrator.update({
        where: { id: other.administratorId },
        data: { removedAt: new Date() },
      });

      const res = await appoint(caller.token, {
        id: newId(),
        phone_number: other.person.phoneNumber,
        role: 'MODERATOR',
        reason: 'retour',
      });

      expect(res.status).toBe(201);
    });

    it.each([
      ['reason empty', { reason: '' }],
      ['reason only spaces', { reason: '   ' }],
      ['role OWNER', { role: 'OWNER' }],
      ['missing role', { role: undefined }],
      ['id not a UUIDv7', { id: 'not-a-uuid' }],
      ['unknown field', { extra: true }],
      ['invalid phone number', { phone_number: 'abc' }],
    ])('%s: 400 VALIDATION_ERROR', async (_name, override) => {
      const caller = await seedAdmin('SUPER_ADMIN');
      const candidate = await seedCandidate();
      const before = await counts();

      const res = await appoint(caller.token, {
        id: newId(),
        phone_number: candidate.phoneNumber,
        role: 'MODERATOR',
        reason: 'renfort',
        ...override,
      });

      expect(res.status).toBe(400);
      expect(bodyOf(res).error?.code).toBe('VALIDATION_ERROR');
      expect(await counts()).toEqual(before);
    });

    it('a MODERATOR caller: 403 FORBIDDEN', async () => {
      const caller = await seedAdmin('MODERATOR');
      const candidate = await seedCandidate();
      const before = await counts();

      const res = await appoint(caller.token, {
        id: newId(),
        phone_number: candidate.phoneNumber,
        role: 'MODERATOR',
        reason: 'renfort',
      });

      expect(res.status).toBe(403);
      expect(bodyOf(res).error?.code).toBe('FORBIDDEN');
      expect(await counts()).toEqual(before);
    });

    it('no token, or an ordinary access token: 401', async () => {
      const candidate = await seedCandidate();
      const before = await counts();
      const body = {
        id: newId(),
        phone_number: candidate.phoneNumber,
        role: 'MODERATOR',
        reason: 'renfort',
      };

      expect((await appoint(null, body)).status).toBe(401);
      expect(
        (await appoint(signAccessToken({ personId: candidate.id, deviceId: newId() }), body)).status
      ).toBe(401);
      expect(await counts()).toEqual(before);
    });
  });

  it('secret once: the URI and the secret appear nowhere else (AC-3)', async () => {
    const caller = await seedAdmin('SUPER_ADMIN');
    const candidate = await seedCandidate();
    const input = {
      id: newId(),
      phone_number: candidate.phoneNumber,
      role: 'MODERATOR',
      reason: 'renfort',
    };
    const first = await appoint(caller.token, input);
    const secret = new URL(bodyOf(first).otpauth_uri!).searchParams.get('secret')!;

    const repeat = await appoint(caller.token, input);

    expect(repeat.status).toBe(409);
    expect(JSON.stringify(repeat.body)).not.toContain(secret);
    expect(JSON.stringify(repeat.body)).not.toContain('otpauth');
    const journal = await prisma.adminAction.findMany({ where: { targetPersonId: candidate.id } });
    expect(JSON.stringify(journal)).not.toContain(secret);
    const people = await prisma.person.findFirstOrThrow({ where: { id: candidate.id } });
    expect(JSON.stringify(people)).not.toContain(secret);
    const keys = await prisma.idempotencyKey.count({ where: { personId: caller.person.id } });
    expect(keys).toBe(0);
  });

  it('concurrent appointments of one person: exactly one succeeds, the other is 409', async () => {
    const caller = await seedAdmin('SUPER_ADMIN');
    const candidate = await seedCandidate();
    const send = () =>
      appoint(caller.token, {
        id: newId(),
        phone_number: candidate.phoneNumber,
        role: 'MODERATOR',
        reason: 'renfort',
      });

    const results = await Promise.all([send(), send()]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.administrator.count({ where: { personId: candidate.id } })).toBe(1);
    expect(await prisma.adminAction.count({ where: { targetPersonId: candidate.id } })).toBe(1);
  });

  it('moderator: a MODERATOR cannot appoint staff (AB-1, WSTG-ATHZ-03)', async () => {
    const caller = await seedAdmin('MODERATOR');
    const candidate = await seedCandidate();
    const before = await counts();

    const res = await appoint(caller.token, {
      id: newId(),
      phone_number: candidate.phoneNumber,
      role: 'SUPER_ADMIN',
      reason: 'escalade',
    });

    expect(res.status).toBe(403);
    expect(await counts()).toEqual(before);
    expect(await prisma.administrator.count({ where: { personId: candidate.id } })).toBe(0);
  });
});
