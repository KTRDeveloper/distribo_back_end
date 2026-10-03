import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { issueSession, revokeSessions } from '../../../src/modules/auth/session.service';
import { hashRefreshToken } from '../../../src/lib/refresh-token';
import { verifyAccessToken } from '../../../src/lib/jwt';

const X = '0199c008-0000-7000-8000-000000000001';
const Y = '0199c008-0000-7000-8000-000000000002';
const dev = { platform: 'ANDROID' as const, app_version: '1.0.0' };

async function clean() {
  await prisma.$executeRaw`DELETE FROM refresh_tokens`;
  await prisma.$executeRaw`DELETE FROM devices`;
  await prisma.person.deleteMany({ where: { id: { in: [X, Y] } } });
}

beforeEach(async () => {
  await clean();
  await prisma.person.create({ data: { id: X, fullName: 'Sess X', phoneNumber: '+2250700009308' } });
  await prisma.person.create({ data: { id: Y, fullName: 'Sess Y', phoneNumber: '+2250700009309' } });
});
afterAll(clean);

describe('issueSession', () => {
  it('issue', async () => {
    const s = await issueSession(X, dev);
    const devices = await prisma.device.findMany({ where: { personId: X } });
    const tokens = await prisma.refreshToken.findMany({ where: { personId: X } });
    expect(devices).toHaveLength(1);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).toBe(hashRefreshToken(s.refreshToken));
    const days = (tokens[0].expiresAt.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThanOrEqual(90);
    expect(verifyAccessToken(s.accessToken)).toEqual({ personId: X, deviceId: s.deviceId });
    expect(s.expiresIn).toBe(900);
  });

  it('two sessions', async () => {
    await issueSession(X, dev);
    await issueSession(X, dev);
    expect(await prisma.device.count({ where: { personId: X } })).toBe(2);
    expect(await prisma.refreshToken.count({ where: { personId: X } })).toBe(2);
  });

  it('invalid device', async () => {
    await expect(issueSession(X, { ...dev, platform: 'WINDOWS' } as never)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    await expect(issueSession(X, { ...dev, app_version: '' })).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.device.count()).toBe(0);
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('hash only', async () => {
    const s = await issueSession(X, dev);
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM refresh_tokens`;
    for (const r of rows) {
      for (const v of Object.values(r)) expect(v).not.toBe(s.refreshToken);
    }
  });
});

describe('revokeSessions', () => {
  async function three() {
    const a = await issueSession(X, dev);
    const b = await issueSession(X, dev);
    const c = await issueSession(X, dev);
    return { a, b, c };
  }

  it('LOGOUT_ALL ends all', async () => {
    await three();
    expect(await revokeSessions(X, 'LOGOUT_ALL')).toBe(3);
    const t = await prisma.refreshToken.findMany({ where: { personId: X } });
    expect(t.every((r) => r.revokedAt && r.revokedReason === 'LOGOUT_ALL')).toBe(true);
    expect((await prisma.device.findMany({ where: { personId: X } })).every((d) => d.revokedAt)).toBe(true);
  });

  it('PASSWORD_RESET except B', async () => {
    const { b } = await three();
    expect(await revokeSessions(X, 'PASSWORD_RESET', { exceptDeviceId: b.deviceId })).toBe(2);
    const kept = await prisma.refreshToken.findMany({ where: { deviceId: b.deviceId } });
    expect(kept[0].revokedAt).toBeNull();
    expect(kept[0].revokedReason).toBeNull();
    const ended = await prisma.refreshToken.findMany({ where: { personId: X, NOT: { deviceId: b.deviceId } } });
    expect(ended.every((r) => r.revokedReason === 'PASSWORD_RESET')).toBe(true);
  });

  it('other person unchanged', async () => {
    await issueSession(Y, dev);
    await three();
    await revokeSessions(X, 'LOGOUT_ALL');
    expect((await prisma.device.findMany({ where: { personId: Y } }))[0].revokedAt).toBeNull();
    expect((await prisma.refreshToken.findMany({ where: { personId: Y } }))[0].revokedAt).toBeNull();
  });
});
