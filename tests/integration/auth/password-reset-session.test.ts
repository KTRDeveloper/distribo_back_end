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
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: () => Promise.resolve(),
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');
const { hashOtp } = await import('../../../src/lib/otp.js');
const { hashPassword, verifyPassword } = await import('../../../src/lib/password.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');
const { logger } = await import('../../../src/lib/logger.js');

const PHONE = '+237677123470';
const OTHER = '+237677123471';
const OLD = 'old-password-correct-horse';
const NEW = 'brand-new-battery-staple';
const dev = { platform: 'ANDROID' as const, app_version: '1.0.0' };
let personId = '';
let otherId = '';

async function clean() {
  await prisma.$executeRaw`DROP TRIGGER IF EXISTS fail_issue ON devices`;
  await prisma.$executeRaw`DELETE FROM refresh_tokens WHERE person_id IN (SELECT id FROM people WHERE phone_number IN (${PHONE}, ${OTHER}))`;
  await prisma.$executeRaw`DELETE FROM devices WHERE person_id IN (SELECT id FROM people WHERE phone_number IN (${PHONE}, ${OTHER}))`;
  await prisma.$executeRaw`DELETE FROM otp_challenges WHERE target IN (${PHONE}, ${OTHER})`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number IN (${PHONE}, ${OTHER})`;
}
async function mkPerson(phone: string, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
  const id = newId();
  await prisma.person.create({
    data: {
      id,
      phoneNumber: phone,
      fullName: 'Reset Session',
      registeredAt: new Date(),
      passwordHash: await hashPassword(OLD),
      phoneVerifiedAt: new Date(),
      status,
    },
  });
  return id;
}
async function code(
  target = PHONE,
  forId = personId,
  expiresAt = new Date(Date.now() + 600000)
): Promise<void> {
  await prisma.otpChallenge.create({
    data: {
      id: newId(),
      personId: forId,
      target,
      purpose: 'PASSWORD_RESET',
      channel: 'SMS',
      codeHash: await hashOtp('123456'),
      expiresAt,
    },
  });
}
beforeEach(async () => {
  store.clear();
  await clean();
  personId = await mkPerson(PHONE);
});
afterAll(clean);

const confirm = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/auth/password-reset/confirm').send(body);
const good = { phone_number: PHONE, code: '123456', new_password: NEW, device: dev };
const hashOf = async (id = personId) =>
  (await prisma.person.findUniqueOrThrow({ where: { id } })).passwordHash ?? '';
const errCode = (b: unknown) => (b as { error: { code: string } }).error.code;
const deviceCount = (id = personId) => prisma.device.count({ where: { personId: id } });

describe('password reset opens a session', () => {
  it('session opened', async () => {
    const a = await issueSession(personId, dev);
    const b = await issueSession(personId, dev);
    await code();
    const res = await confirm(good);
    expect(res.status).toBe(200);
    const body = res.body as { access_token: unknown; refresh_token: unknown };
    expect(res.body).toMatchObject({
      token_type: 'Bearer',
      person: { id: personId, full_name: 'Reset Session' },
    });
    expect(typeof body.access_token).toBe('string');
    expect(typeof body.refresh_token).toBe('string');
    expect(await verifyPassword(await hashOf(), NEW)).toBe(true);
    for (const s of [a, b]) {
      const t = await prisma.refreshToken.findMany({ where: { deviceId: s.deviceId } });
      expect(t.every((x) => x.revokedReason === 'PASSWORD_RESET')).toBe(true);
    }
    const live = await prisma.device.findMany({ where: { personId, revokedAt: null } });
    expect(live.length).toBe(1);
    expect([a.deviceId, b.deviceId]).not.toContain(live[0]?.id);
    const me = await request(app)
      .get('/api/v1/auth/devices')
      .set('Authorization', `Bearer ${body.access_token as string}`);
    expect(me.status).toBe(200);
    expect((me.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it('suspended', async () => {
    await prisma.person.update({ where: { id: personId }, data: { status: 'SUSPENDED' } });
    const s = await issueSession(personId, dev);
    const before = await hashOf();
    await code();
    const r = await confirm(good);
    expect([r.status, errCode(r.body)]).toEqual([403, 'ACCOUNT_SUSPENDED']);
    expect(await hashOf()).toBe(before);
    const live = await prisma.device.findMany({ where: { personId, revokedAt: null } });
    expect(live.map((d) => d.id)).toEqual([s.deviceId]);
    const again = await confirm(good);
    expect([again.status, errCode(again.body)]).toEqual([400, 'OTP_INVALID']);
  });

  it('refusals', async () => {
    const before = await hashOf();
    await code();
    let r = await confirm({ ...good, code: '000000' });
    expect([r.status, errCode(r.body)]).toEqual([400, 'OTP_INVALID']);

    await prisma.otpChallenge.deleteMany({ where: { target: PHONE } });
    await code(PHONE, personId, new Date(Date.now() - 1000));
    r = await confirm(good);
    expect([r.status, errCode(r.body)]).toEqual([400, 'OTP_EXPIRED']);

    await prisma.otpChallenge.deleteMany({ where: { target: PHONE } });
    await code();
    r = await confirm({ ...good, new_password: '1234567' });
    expect([r.status, errCode(r.body)]).toEqual([400, 'WEAK_PASSWORD']);

    r = await confirm({ ...good, phone_number: '+237677123499' });
    expect([r.status, errCode(r.body)]).toEqual([400, 'OTP_INVALID']);

    const { device: _device, ...noDevice } = good;
    void _device;
    r = await confirm(noDevice);
    expect([r.status, errCode(r.body)]).toEqual([400, 'VALIDATION_ERROR']);

    r = await confirm({ ...good, use_email: true });
    expect([r.status, errCode(r.body)]).toEqual([400, 'VALIDATION_ERROR']);

    expect(await hashOf()).toBe(before);
    expect(await deviceCount()).toBe(0);
  });

  it('invalid device keeps the code and the password', async () => {
    const before = await hashOf();
    await code();
    const r = await confirm({ ...good, device: { platform: 'WINDOWS', app_version: '1' } });
    expect([r.status, errCode(r.body)]).toEqual([400, 'VALIDATION_ERROR']);
    expect(await hashOf()).toBe(before);
    expect(await deviceCount()).toBe(0);
    expect((await confirm(good)).status).toBe(200);
  });

  it('all or nothing', async () => {
    const s = await issueSession(personId, dev);
    const before = await hashOf();
    await code();
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION fail_issue_fn() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql`
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_issue BEFORE INSERT ON devices FOR EACH ROW EXECUTE FUNCTION fail_issue_fn()`
    );
    const r = await confirm(good);
    expect(r.status).toBe(500);
    expect(await hashOf()).toBe(before);
    const live = await prisma.device.findMany({ where: { personId, revokedAt: null } });
    expect(live.map((d) => d.id)).toEqual([s.deviceId]);
  });

  it('other number', async () => {
    otherId = await mkPerson(OTHER);
    await code(PHONE, personId);
    const before = await hashOf(otherId);
    const r = await confirm({ ...good, phone_number: OTHER });
    expect([r.status, errCode(r.body)]).toEqual([400, 'OTP_INVALID']);
    expect(await hashOf(otherId)).toBe(before);
    expect(await deviceCount(otherId)).toBe(0);
  });

  it('suspension hidden', async () => {
    await prisma.person.update({ where: { id: personId }, data: { status: 'SUSPENDED' } });
    await code();
    const r = await confirm({ ...good, code: '000000' });
    expect([r.status, errCode(r.body)]).toEqual([400, 'OTP_INVALID']);
  });

  it('lock cleared and the reset logged with ids only', async () => {
    store.set(`login:fail:${PHONE}`, 5);
    const lines: string[] = [];
    const spy = vi
      .spyOn(logger, 'info')
      .mockImplementation(((...a: unknown[]) => lines.push(JSON.stringify(a))) as never);
    await code();
    const res = await confirm(good);
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(store.get(`login:fail:${PHONE}`) ?? 0).toBe(0);
    const entry = lines.find((l) => l.includes('password_reset"'));
    expect(entry).toContain(personId);
    const live = await prisma.device.findFirstOrThrow({ where: { personId, revokedAt: null } });
    expect(entry).toContain(live.id);
    const all = lines.join('\n');
    expect(all).not.toContain(NEW);
    expect(all).not.toContain('123456');
  });
});
