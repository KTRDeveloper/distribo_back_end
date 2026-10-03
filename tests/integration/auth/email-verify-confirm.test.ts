import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
const jobs: { to: string; message: string }[] = [];

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
  enqueueOtpDelivery: (d: { to: string; message: string }) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

const PHONE = '+237677124456';
const PHONE2 = '+237677124457';
const dev = { platform: 'ANDROID' as const, app_version: '1.0.0' };

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM refresh_tokens`;
  await prisma.$executeRaw`DELETE FROM devices`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number IN (${PHONE}, ${PHONE2})`;
}
async function setup(phone = PHONE, data: Record<string, unknown> = {}) {
  const p = await prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: phone,
      fullName: 'Eve Mbarga',
      registeredAt: new Date(),
      phoneVerifiedAt: new Date(),
      passwordHash: 'x',
      email: 'eve@example.com',
      ...data,
    },
  });
  const s = await issueSession(p.id, dev);
  return { id: p.id, token: s.accessToken };
}
const auth = (r: request.Test, t: string | null) => (t ? r.set('Authorization', `Bearer ${t}`) : r);
const ask = (t: string) => auth(request(app).post('/api/v1/auth/email/verify/request'), t).send({});
const confirm = (t: string | null, code: string) =>
  auth(request(app).post('/api/v1/auth/email/verify/confirm'), t).send({ code });
const codeSent = () => /(\d{6})/.exec(jobs[jobs.length - 1]?.message ?? '')?.[1] ?? '';
const errCode = (b: unknown) => (b as { error: { code: string } }).error.code;
const verifiedAt = async (id: string) =>
  (await prisma.person.findUniqueOrThrow({ where: { id } })).emailVerifiedAt;

beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  await clean();
});
afterAll(clean);

describe('email verification confirm', () => {
  it('confirm', async () => {
    const a = await setup();
    await ask(a.token);
    const res = await confirm(a.token, codeSent());
    expect(res.status).toBe(204);
    expect(await verifiedAt(a.id)).not.toBeNull();
  });

  it('bad code', async () => {
    const a = await setup();
    await ask(a.token);
    const res = await confirm(a.token, codeSent() === '000000' ? '111111' : '000000');
    expect(res.status).toBe(400);
    expect(errCode(res.body)).toBe('OTP_INVALID');
    expect(await verifiedAt(a.id)).toBeNull();
  });

  it('expired', async () => {
    const a = await setup();
    await ask(a.token);
    await prisma.$executeRaw`UPDATE otp_challenges SET expires_at = now() - interval '1 minute'`;
    const res = await confirm(a.token, codeSent());
    expect(errCode(res.body)).toBe('OTP_EXPIRED');
    expect(await verifiedAt(a.id)).toBeNull();
  });

  it('changed address', async () => {
    const a = await setup();
    await ask(a.token);
    const code = codeSent();
    await prisma.person.update({ where: { id: a.id }, data: { email: 'new@example.com' } });
    const res = await confirm(a.token, code);
    expect(res.status).toBe(400);
    expect(errCode(res.body)).toBe('OTP_INVALID');
    expect(await verifiedAt(a.id)).toBeNull();
  });

  it('taken', async () => {
    await setup(PHONE2, { emailVerifiedAt: new Date() });
    const a = await setup();
    await ask(a.token);
    const res = await confirm(a.token, codeSent());
    expect(res.status).toBe(409);
    expect(errCode(res.body)).toBe('EMAIL_TAKEN');
    expect(await verifiedAt(a.id)).toBeNull();
    const rows = await prisma.$queryRaw<
      { consumed_at: Date | null }[]
    >`SELECT consumed_at FROM otp_challenges`;
    expect(rows[0]?.consumed_at).toBeNull();
  });
});

describe('email verification confirm security', () => {
  it('other person code', async () => {
    const a = await setup();
    const b = await setup(PHONE2, { email: 'bob@example.com' });
    await ask(b.token);
    const res = await confirm(a.token, codeSent());
    expect(errCode(res.body)).toBe('OTP_INVALID');
    expect(await verifiedAt(a.id)).toBeNull();
  });

  it('no token', async () => {
    expect((await confirm(null, '123456')).status).toBe(401);
  });
});
