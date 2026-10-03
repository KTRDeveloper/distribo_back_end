import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

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
const NEW = '+237677124458';
const dev = { platform: 'ANDROID' as const, app_version: '1.0.0' };
const appPrisma = getAppRolePrisma();

async function clean() {
  await prisma.$executeRaw`DROP TRIGGER IF EXISTS fail_log ON phone_number_change_logs`;
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM refresh_tokens`;
  await prisma.$executeRaw`DELETE FROM devices`;
  await prisma.$executeRaw`DELETE FROM phone_number_change_logs WHERE new_phone_number = ${NEW}`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number IN (${PHONE}, ${PHONE2}, ${NEW}) OR released_phone_number = ${PHONE}`;
}
async function setup(phone: string | null = PHONE, data: Record<string, unknown> = {}) {
  const p = await prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: phone,
      fullName: 'Eve Mbarga',
      registeredAt: new Date(),
      phoneVerifiedAt: phone ? new Date() : null,
      passwordHash: 'x',
      ...data,
    },
  });
  const s = await issueSession(p.id, dev);
  return { id: p.id, token: s.accessToken };
}
const auth = (r: request.Test, t: string | null) => (t ? r.set('Authorization', `Bearer ${t}`) : r);
const ask = (t: string, n = NEW) =>
  auth(request(app).post('/api/v1/auth/phone/change/request'), t).send({ new_phone_number: n });
const confirm = (t: string | null, code: string, n = NEW) =>
  auth(request(app).post('/api/v1/auth/phone/change/confirm'), t).send({
    new_phone_number: n,
    code,
  });
const codeSent = () => /(\d{6})/.exec(jobs[jobs.length - 1]?.message ?? '')?.[1] ?? '';
const errCode = (b: unknown) => (b as { error: { code: string } }).error.code;
const person = (id: string) => prisma.person.findUniqueOrThrow({ where: { id } });
const logs = (id: string) => prisma.phoneNumberChangeLog.findMany({ where: { personId: id } });

beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  await clean();
});
afterAll(async () => {
  await clean();
  await appPrisma.$disconnect();
});

describe('phone change confirm', () => {
  it('change', async () => {
    const a = await setup();
    await ask(a.token);
    const res = await confirm(a.token, codeSent());
    expect(res.status).toBe(204);
    const p = await person(a.id);
    expect(p.phoneNumber).toBe(NEW);
    expect(p.phoneVerifiedAt).not.toBeNull();
    const l = await logs(a.id);
    expect(l).toHaveLength(1);
    expect(l[0]?.oldPhoneNumber).toBe(PHONE);
    expect(l[0]?.newPhoneNumber).toBe(NEW);
  });

  it('after taken number', async () => {
    const a = await setup(null, { releasedPhoneNumber: PHONE });
    await setup(PHONE2);
    await ask(a.token);
    const res = await confirm(a.token, codeSent());
    expect(res.status).toBe(204);
    const p = await person(a.id);
    expect(p.phoneNumber).toBe(NEW);
    expect(p.releasedPhoneNumber).toBeNull();
    expect((await logs(a.id))[0]?.oldPhoneNumber).toBe(PHONE);
  });

  it('bad code', async () => {
    const a = await setup();
    await ask(a.token);
    const bad = codeSent() === '000000' ? '111111' : '000000';
    const res = await confirm(a.token, bad);
    expect(errCode(res.body)).toBe('OTP_INVALID');
    expect((await person(a.id)).phoneNumber).toBe(PHONE);
    expect(await logs(a.id)).toHaveLength(0);
  });

  it('expired', async () => {
    const a = await setup();
    await ask(a.token);
    await prisma.$executeRaw`UPDATE otp_challenges SET expires_at = now() - interval '1 minute'`;
    const res = await confirm(a.token, codeSent());
    expect(errCode(res.body)).toBe('OTP_EXPIRED');
    expect((await person(a.id)).phoneNumber).toBe(PHONE);
  });

  it('code sent to another number', async () => {
    const a = await setup();
    await ask(a.token, PHONE2.replace('7', '8'));
    const res = await confirm(a.token, codeSent());
    expect(res.status).toBe(400);
    expect((await person(a.id)).phoneNumber).toBe(PHONE);
  });

  it('taken meanwhile', async () => {
    const a = await setup();
    await ask(a.token);
    const code = codeSent();
    const b = await setup(NEW);
    const res = await confirm(a.token, code);
    expect(res.status).toBe(409);
    expect(errCode(res.body)).toBe('PHONE_TAKEN');
    expect((await person(a.id)).phoneNumber).toBe(PHONE);
    expect(await logs(a.id)).toHaveLength(0);
    expect((await person(b.id)).phoneNumber).toBe(NEW);
  });

  it('atomic', async () => {
    const a = await setup();
    await ask(a.token);
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION fail_log_fn() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql`
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_log BEFORE INSERT ON phone_number_change_logs FOR EACH ROW EXECUTE FUNCTION fail_log_fn()`
    );
    const res = await confirm(a.token, codeSent());
    expect(res.status).toBe(500);
    expect((await person(a.id)).phoneNumber).toBe(PHONE);
  });
});

describe('phone change confirm security', () => {
  it('no code', async () => {
    const a = await setup();
    const res = await confirm(a.token, '123456');
    expect(res.status).toBe(400);
    expect((await person(a.id)).phoneNumber).toBe(PHONE);
  });

  it('no token', async () => {
    expect((await confirm(null, '123456')).status).toBe(401);
  });

  it('journal immutable', async () => {
    const a = await setup();
    await ask(a.token);
    await confirm(a.token, codeSent());
    await expect(
      appPrisma.$executeRaw`UPDATE phone_number_change_logs SET old_phone_number = ${PHONE2} WHERE person_id = ${a.id}::uuid`
    ).rejects.toThrow();
    await expect(
      appPrisma.$executeRaw`DELETE FROM phone_number_change_logs WHERE person_id = ${a.id}::uuid`
    ).rejects.toThrow();
  });
});
