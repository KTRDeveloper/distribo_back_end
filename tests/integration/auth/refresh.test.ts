import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const { app } = await import('../../../src/app.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');
const { hashRefreshToken } = await import('../../../src/lib/refresh-token.js');

const X = '0199c016-0000-7000-8000-000000000001';
const dev = { platform: 'ANDROID' as const, app_version: '1.0.0' };

async function clean() {
  await prisma.$executeRaw`DELETE FROM refresh_tokens`;
  await prisma.$executeRaw`DELETE FROM devices`;
  await prisma.person.deleteMany({ where: { id: X } });
}
beforeEach(async () => {
  await clean();
  await prisma.person.create({ data: { id: X, fullName: 'Ref X', phoneNumber: '+2250700009316' } });
});
afterAll(clean);

type Body = {
  error: { code: string };
  refresh_token: string;
  token_type: string;
  expires_in: number;
};
const bd = (r: { body: unknown }) => r.body as Body;
const refresh = (t: unknown) =>
  request(app).post('/api/v1/auth/refresh').send({ refresh_token: t });

describe('refresh', () => {
  it('rotation', async () => {
    const s = await issueSession(X, dev);
    const res = await refresh(s.refreshToken);
    expect(res.status).toBe(200);
    expect(bd(res).token_type).toBe('Bearer');
    expect(bd(res).expires_in).toBe(900);
    expect(bd(res).refresh_token).not.toBe(s.refreshToken);
    const old = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(s.refreshToken) },
    });
    expect(old?.rotatedAt).not.toBeNull();
    const nu = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(bd(res).refresh_token) },
    });
    expect(nu?.deviceId).toBe(s.deviceId);
    expect((nu!.expiresAt.getTime() - Date.now()) / 86400000).toBeGreaterThan(89.9);
  });

  it('rejections', async () => {
    expect(bd(await refresh('unknown-token')).error.code).toBe('INVALID_REFRESH_TOKEN');
    const a = await issueSession(X, dev);
    await prisma.refreshToken.updateMany({
      where: { deviceId: a.deviceId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const e = await refresh(a.refreshToken);
    expect(e.status).toBe(401);
    expect(bd(e).error.code).toBe('INVALID_REFRESH_TOKEN');
    const b = await issueSession(X, dev);
    await prisma.refreshToken.updateMany({
      where: { deviceId: b.deviceId },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
    });
    expect(bd(await refresh(b.refreshToken)).error.code).toBe('INVALID_REFRESH_TOKEN');
    const c = await issueSession(X, dev);
    await prisma.device.update({ where: { id: c.deviceId }, data: { revokedAt: new Date() } });
    const r = await refresh(c.refreshToken);
    expect(r.status).toBe(401);
    expect(bd(r).error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('reuse', async () => {
    const a = await issueSession(X, dev);
    const other = await issueSession(X, dev);
    const first = await refresh(a.refreshToken);
    const second = await refresh(a.refreshToken);
    expect(second.status).toBe(401);
    expect(bd(second).error.code).toBe('SESSION_REVOKED');
    const d = await prisma.device.findUnique({ where: { id: a.deviceId } });
    expect(d?.revokedAt).not.toBeNull();
    const newest = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(bd(first).refresh_token) },
    });
    expect(newest?.revokedAt).not.toBeNull();
    expect(newest?.revokedReason).toBe('REUSE_DETECTED');
    expect((await refresh(bd(first).refresh_token)).status).toBe(401);
    expect((await refresh(other.refreshToken)).status).toBe(200);
  });

  it('suspended', async () => {
    const a = await issueSession(X, dev);
    const b = await issueSession(X, dev);
    await prisma.person.update({ where: { id: X }, data: { status: 'SUSPENDED' } });
    const res = await refresh(a.refreshToken);
    expect(res.status).toBe(401);
    expect(bd(res).error.code).toBe('SESSION_REVOKED');
    expect(await prisma.device.count({ where: { personId: X, revokedAt: null } })).toBe(0);
    const t = await prisma.refreshToken.findMany({ where: { personId: X, revokedAt: null } });
    expect(t).toHaveLength(0);
    expect((await refresh(b.refreshToken)).status).toBe(401);
  });

  it('parallel', async () => {
    const a = await issueSession(X, dev);
    const [r1, r2] = await Promise.all([refresh(a.refreshToken), refresh(a.refreshToken)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 401]);
    const bad = r1.status === 401 ? r1 : r2;
    expect(bd(bad).error.code).toBe('SESSION_REVOKED');
  });

  it('replay', async () => {
    const a = await issueSession(X, dev);
    const thief = await refresh(a.refreshToken);
    const owner = await refresh(a.refreshToken);
    expect(thief.status).toBe(200);
    expect(owner.status).toBe(401);
    expect((await refresh(bd(thief).refresh_token)).status).toBe(401);
    expect((await refresh(a.refreshToken)).status).toBe(401);
  });

  it('wrong token type', async () => {
    const a = await issueSession(X, dev);
    const res = await refresh(a.accessToken);
    expect(res.status).toBe(401);
    expect(bd(res).error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('strict body', async () => {
    expect(
      (await request(app).post('/api/v1/auth/refresh').send({ refresh_token: 'x', a: 1 })).status
    ).toBe(400);
  });
});
