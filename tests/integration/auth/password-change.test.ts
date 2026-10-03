import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: (key: string, limit: number) => {
    const c = store.get(key) ?? 0;
    if (c >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
    store.set(key, c + 1);
    return Promise.resolve({ allowed: true, remaining: limit - c - 1 });
  },
  getCount: (key: string) => Promise.resolve(store.get(key) ?? 0),
  resetKey: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');
const { hashPassword, verifyPassword } = await import('../../../src/lib/password.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

const PHONE = '+237677123490';
const OLD = 'old-password-correct-horse';
const NEW = 'brand-new-battery-staple';
const dev = { platform: 'ANDROID' as const, app_version: '1.0.0' };
let personId = '';

async function clean() {
  await prisma.$executeRaw`DELETE FROM refresh_tokens WHERE person_id IN (SELECT id FROM people WHERE phone_number = ${PHONE})`;
  await prisma.$executeRaw`DELETE FROM devices WHERE person_id IN (SELECT id FROM people WHERE phone_number = ${PHONE})`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number = ${PHONE}`;
}
beforeEach(async () => {
  store.clear();
  await clean();
  const p = await prisma.person.create({
    data: {
      id: newId(),
      fullName: 'Pw Change',
      phoneNumber: PHONE,
      registeredAt: new Date(),
      phoneVerifiedAt: new Date(),
      passwordHash: await hashPassword(OLD),
    },
  });
  personId = p.id;
});
afterAll(clean);

const post = (token: string | null, body: object) => {
  const r = request(app).post('/api/v1/auth/password/change');
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body);
};
async function stored() {
  return (await prisma.person.findUniqueOrThrow({ where: { id: personId } })).passwordHash ?? '';
}

describe('password change', () => {
  it('change', async () => {
    const s = await issueSession(personId, dev);
    const r = await post(s.accessToken, { current_password: OLD, new_password: NEW });
    expect(r.status).toBe(204);
    expect(await verifyPassword(await stored(), NEW)).toBe(true);
    expect(await verifyPassword(await stored(), OLD)).toBe(false);
  });

  it('other phones', async () => {
    const a = await issueSession(personId, dev);
    const b = await issueSession(personId, dev);
    const c = await issueSession(personId, dev);
    await post(b.accessToken, { current_password: OLD, new_password: NEW });
    const rows = await prisma.refreshToken.findMany({ where: { personId } });
    for (const t of rows) {
      if (t.deviceId === b.deviceId) expect(t.revokedAt).toBeNull();
      else expect(t.revokedReason).toBe('PASSWORD_RESET');
    }
    expect([a, c].length).toBe(2);
  });

  it.each([
    ['wrong', { current_password: 'nope-nope-nope', new_password: NEW }, 401, 'INVALID_CREDENTIALS'],
    ['short', { current_password: OLD, new_password: '1234567' }, 400, 'WEAK_PASSWORD'],
    ['same', { current_password: OLD, new_password: OLD }, 400, 'VALIDATION_ERROR'],
    ['long', { current_password: OLD, new_password: 'a'.repeat(65) }, 400, 'WEAK_PASSWORD'],
  ])('refusal %s', async (_n, body, status, code) => {
    const s = await issueSession(personId, dev);
    const r = await post(s.accessToken, body);
    expect(r.status).toBe(status);
    expect((r.body as { error: { code: string } }).error.code).toBe(code);
    expect(await verifyPassword(await stored(), OLD)).toBe(true);
  });

  it('lock', async () => {
    const s = await issueSession(personId, dev);
    for (let i = 0; i < 5; i++) {
      await post(s.accessToken, { current_password: 'nope-nope-nope', new_password: NEW });
    }
    const r = await post(s.accessToken, { current_password: OLD, new_password: NEW });
    expect(r.status).toBe(429);
    expect((r.body as { error: { code: string } }).error.code).toBe('LOGIN_LOCKED');
  });

  it('stolen session', async () => {
    const s = await issueSession(personId, dev);
    await post(s.accessToken, { current_password: 'wrong-wrong-wrong', new_password: NEW });
    expect(await verifyPassword(await stored(), OLD)).toBe(true);
  });

  it('no token', async () => {
    const r = await post(null, { current_password: OLD, new_password: NEW });
    expect(r.status).toBe(401);
  });
});
