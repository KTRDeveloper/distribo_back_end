import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const { app } = await import('../../../src/app.js');
const { issueSession, revokeDevice } = await import(
  '../../../src/modules/auth/session.service.js'
);

const X = '0199c017-0000-7000-8000-000000000001';
const Y = '0199c017-0000-7000-8000-000000000002';
const dev = { platform: 'ANDROID' as const, app_version: '1.0.0' };

async function clean() {
  await prisma.$executeRaw`DELETE FROM refresh_tokens`;
  await prisma.$executeRaw`DELETE FROM devices`;
  await prisma.person.deleteMany({ where: { id: { in: [X, Y] } } });
}
beforeEach(async () => {
  await clean();
  await prisma.person.create({ data: { id: X, fullName: 'Out X', phoneNumber: '+2250700009317' } });
  await prisma.person.create({ data: { id: Y, fullName: 'Out Y', phoneNumber: '+2250700009318' } });
});
afterAll(clean);

const logout = (token: string) =>
  request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`);
const refresh = (t: string) => request(app).post('/api/v1/auth/refresh').send({ refresh_token: t });

describe('logout', () => {
  it('sign out, refresh closed, repeat', async () => {
    const s = await issueSession(X, dev);
    expect((await logout(s.accessToken)).status).toBe(204);
    const d = await prisma.device.findUnique({ where: { id: s.deviceId } });
    expect(d?.revokedAt).not.toBeNull();
    const toks = await prisma.refreshToken.findMany({ where: { deviceId: s.deviceId } });
    expect(toks.length).toBeGreaterThan(0);
    expect(toks.every((t) => t.revokedReason === 'LOGOUT')).toBe(true);
    const r = await refresh(s.refreshToken);
    expect(r.status).toBe(401);
    expect((r.body as { error: { code: string } }).error.code).toBe('INVALID_REFRESH_TOKEN');
    expect((await logout(s.accessToken)).status).toBe(204);
  });

  it('others stay', async () => {
    const a = await issueSession(X, dev);
    const b = await issueSession(X, dev);
    await logout(a.accessToken);
    const d = await prisma.device.findUnique({ where: { id: b.deviceId } });
    expect(d?.revokedAt).toBeNull();
    expect((await refresh(b.refreshToken)).status).toBe(200);
  });

  it('other person device unchanged', async () => {
    const b = await issueSession(Y, dev);
    expect(await revokeDevice(X, b.deviceId, 'LOGOUT')).toBe(false);
    const d = await prisma.device.findUnique({ where: { id: b.deviceId } });
    expect(d?.revokedAt).toBeNull();
    const t = await prisma.refreshToken.findMany({ where: { deviceId: b.deviceId } });
    expect(t.every((x) => x.revokedAt === null)).toBe(true);
  });

  it('no token', async () => {
    expect((await request(app).post('/api/v1/auth/logout')).status).toBe(401);
  });
});
