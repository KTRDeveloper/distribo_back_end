import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const { app } = await import('../../../src/app.js');
const { createTotpSecret, encryptSecret } = await import('../../../src/lib/totp.js');
const { signAdminToken, signAccessToken } = await import('../../../src/lib/jwt.js');
const { seedAccount } = await import('../../helpers/database.js');
const { newId } = await import('../../../src/shared/ids.js');

type Role = 'MODERATOR' | 'SUPER_ADMIN';
type Body = { error?: { code: string } };

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

const remove = (token: string | null, administratorId: string, body: object = { reason: 'x' }) => {
  const r = request(app).delete(`/api/v1/admin/administrators/${administratorId}`);
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body);
};
const errorCode = (res: { body: unknown }) => (res.body as Body).error?.code;
const counts = async () => ({
  live: await prisma.administrator.count({ where: { removedAt: null } }),
  actions: await prisma.adminAction.count(),
});
const probe = (token: string) =>
  request(app)
    .post('/api/v1/admin/recovery-email/request')
    .set('Authorization', `Bearer ${token}`)
    .send({ email: 'probe@example.test' });

describe('super administrator removes an administrator', () => {
  it('remove: sets removed_at, writes REMOVE_ADMIN, and the next admin call is 401 (AC-1, C-29)', async () => {
    const caller = await seedAdmin('SUPER_ADMIN');
    const moderator = await seedAdmin('MODERATOR');
    expect((await probe(moderator.token)).status).not.toBe(401);

    const res = await remove(caller.token, moderator.administratorId, { reason: 'départ' });

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const row = await prisma.administrator.findUniqueOrThrow({
      where: { id: moderator.administratorId },
    });
    expect(row.removedAt).not.toBeNull();
    const journal = await prisma.adminAction.findMany({
      where: { targetPersonId: moderator.person.id, action: 'REMOVE_ADMIN' },
    });
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      administratorId: caller.administratorId,
      reason: 'départ',
      targetOrganizationId: null,
      syncArchiveId: null,
    });
    expect((await probe(moderator.token)).status).toBe(401);
  });

  it('remove: a SUPER_ADMIN can be removed while another one stays live', async () => {
    const caller = await seedAdmin('SUPER_ADMIN');
    const other = await seedAdmin('SUPER_ADMIN');

    const res = await remove(caller.token, other.administratorId);

    expect(res.status).toBe(204);
    const row = await prisma.administrator.findUniqueOrThrow({
      where: { id: other.administratorId },
    });
    expect(row.removedAt).not.toBeNull();
  });

  describe('refusals change nothing (AC-2)', () => {
    it('the last live SUPER_ADMIN: 409 LAST_SUPER_ADMIN', async () => {
      const caller = await seedAdmin('SUPER_ADMIN');
      await seedAdmin('MODERATOR');
      const before = await counts();

      const res = await remove(caller.token, caller.administratorId);

      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('LAST_SUPER_ADMIN');
      expect(await counts()).toEqual(before);
    });

    it('a removed SUPER_ADMIN does not count as live for the last-one rule', async () => {
      const caller = await seedAdmin('SUPER_ADMIN');
      const gone = await seedAdmin('SUPER_ADMIN');
      await prisma.administrator.update({
        where: { id: gone.administratorId },
        data: { removedAt: new Date() },
      });

      const res = await remove(caller.token, caller.administratorId);

      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('LAST_SUPER_ADMIN');
    });

    it('an administrator already removed: 404 NOT_FOUND', async () => {
      const caller = await seedAdmin('SUPER_ADMIN');
      const moderator = await seedAdmin('MODERATOR');
      expect((await remove(caller.token, moderator.administratorId)).status).toBe(204);
      const before = await counts();

      const res = await remove(caller.token, moderator.administratorId);

      expect(res.status).toBe(404);
      expect(errorCode(res)).toBe('NOT_FOUND');
      expect(await counts()).toEqual(before);
    });

    it('an unknown administrator: 404 NOT_FOUND', async () => {
      const caller = await seedAdmin('SUPER_ADMIN');
      const before = await counts();

      const res = await remove(caller.token, newId());

      expect(res.status).toBe(404);
      expect(errorCode(res)).toBe('NOT_FOUND');
      expect(await counts()).toEqual(before);
    });

    it.each([
      ['empty', { reason: '' }],
      ['blank', { reason: '   ' }],
      ['missing', {}],
      ['too long', { reason: 'x'.repeat(501) }],
      ['unknown field', { reason: 'x', role: 'MODERATOR' }],
    ])('reason %s: 400 VALIDATION_ERROR', async (_name, body) => {
      const caller = await seedAdmin('SUPER_ADMIN');
      const moderator = await seedAdmin('MODERATOR');
      const before = await counts();

      const res = await remove(caller.token, moderator.administratorId, body);

      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
      expect(await counts()).toEqual(before);
    });

    it('an id that is not a UUIDv7: 400 VALIDATION_ERROR', async () => {
      const caller = await seedAdmin('SUPER_ADMIN');

      const res = await remove(caller.token, 'not-an-id');

      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
    });

    it('a MODERATOR caller: 403 FORBIDDEN', async () => {
      const caller = await seedAdmin('MODERATOR');
      const other = await seedAdmin('MODERATOR');
      const before = await counts();

      const res = await remove(caller.token, other.administratorId);

      expect(res.status).toBe(403);
      expect(errorCode(res)).toBe('FORBIDDEN');
      expect(await counts()).toEqual(before);
    });

    it('no token, or an ordinary access token: 401', async () => {
      await seedAdmin('SUPER_ADMIN');
      const moderator = await seedAdmin('MODERATOR');
      const user = await seedAccount({
        email: `user${newId().slice(-8)}@example.test`,
        password: 'fixture-user-password-1',
        name: 'Fixture User',
      });
      const before = await counts();

      expect((await remove(null, moderator.administratorId)).status).toBe(401);
      const ordinary = signAccessToken({ personId: user.id, deviceId: newId() });
      expect((await remove(ordinary, moderator.administratorId)).status).toBe(401);
      expect(await counts()).toEqual(before);
    });
  });

  it('history: earlier journal rows of the removed administrator are kept (AC-3)', async () => {
    const caller = await seedAdmin('SUPER_ADMIN');
    const moderator = await seedAdmin('MODERATOR');
    const target = await seedAccount({
      email: `t${newId().slice(-8)}@example.test`,
      password: 'fixture-target-password-1',
      name: 'Fixture Target',
    });
    const earlier = newId();
    await prisma.adminAction.create({
      data: {
        id: earlier,
        administratorId: moderator.administratorId,
        action: 'SUSPEND',
        targetPersonId: target.id,
        reason: 'fixture',
      },
    });

    expect((await remove(caller.token, moderator.administratorId)).status).toBe(204);

    const kept = await prisma.adminAction.findUnique({ where: { id: earlier } });
    expect(kept?.administratorId).toBe(moderator.administratorId);
    expect(await prisma.administrator.count({ where: { id: moderator.administratorId } })).toBe(1);
  });

  it('concurrent removals of the two live SUPER_ADMINs: one succeeds, one is refused', async () => {
    const a = await seedAdmin('SUPER_ADMIN');
    const b = await seedAdmin('SUPER_ADMIN');

    const [r1, r2] = await Promise.all([
      remove(a.token, b.administratorId),
      remove(b.token, a.administratorId),
    ]);

    // The loser is 409 when it passed authentication before the winner committed, 401 after.
    const statuses = [r1.status, r2.status];
    expect(statuses.filter((status) => status === 204)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409 || status === 401)).toHaveLength(1);
    expect(await prisma.administrator.count({ where: { removedAt: null } })).toBe(1);
    expect(await prisma.adminAction.count({ where: { action: 'REMOVE_ADMIN' } })).toBe(1);
  });

  it('moderator: a MODERATOR cannot remove a super administrator (AB-1, WSTG-ATHZ-03)', async () => {
    const moderator = await seedAdmin('MODERATOR');
    const superAdmin = await seedAdmin('SUPER_ADMIN');

    const res = await remove(moderator.token, superAdmin.administratorId);

    expect(res.status).toBe(403);
    const row = await prisma.administrator.findUniqueOrThrow({
      where: { id: superAdmin.administratorId },
    });
    expect(row.removedAt).toBeNull();
    expect(await prisma.adminAction.count({ where: { action: 'REMOVE_ADMIN' } })).toBe(0);
  });
});
