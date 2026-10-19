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

const PHONE = '+237677124466';
const PHONE2 = '+237677124467';
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

describe('verified email uniqueness ignores letter case', () => {
  it('other case', async () => {
    await setup(PHONE2, { email: 'Shop.Owner@example.com', emailVerifiedAt: new Date() });
    const b = await setup(PHONE, { email: 'shop.owner@example.com' });
    await ask(b.token);
    const res = await confirm(b.token, codeSent());
    expect(res.status).toBe(409);
    expect(errCode(res.body)).toBe('EMAIL_TAKEN');
    expect(await verifiedAt(b.id)).toBeNull();
  });

  it('other address', async () => {
    await setup(PHONE2, { email: 'shop.owner@example.com', emailVerifiedAt: new Date() });
    const b = await setup(PHONE, { email: 'other.owner@example.com' });
    await ask(b.token);
    const res = await confirm(b.token, codeSent());
    expect(res.status).toBe(204);
    expect(await verifiedAt(b.id)).not.toBeNull();
  });
});

describe('verified email uniqueness security', () => {
  it('capitals trick', async () => {
    await setup(PHONE2, { email: 'shop.owner@example.com', emailVerifiedAt: new Date() });
    const b = await setup(PHONE, { email: 'SHOP.OWNER@EXAMPLE.COM' });
    await ask(b.token);
    await confirm(b.token, codeSent());
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM people
      WHERE lower(email) = 'shop.owner@example.com' AND email_verified_at IS NOT NULL`;
    expect(Number(rows[0]?.n)).toBe(1);
    expect(await verifiedAt(b.id)).toBeNull();
  });
});
