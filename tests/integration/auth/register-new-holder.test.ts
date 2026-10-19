import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const state = vi.hoisted(() => ({ failSession: false }));
const enqueue = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({ enqueueOtpDelivery: enqueue }));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));
vi.mock('../../../src/modules/auth/session.service.js', async (orig) => {
  const real = await orig<typeof import('../../../src/modules/auth/session.service.js')>();
  return {
    ...real,
    issueSession: (...args: Parameters<typeof real.issueSession>) => {
      if (state.failSession) throw new Error('forced failure');
      return real.issueSession(...args);
    },
  };
});

const { app } = await import('../../../src/app.js');
const { hashOtp } = await import('../../../src/lib/otp.js');
const { newId } = await import('../../../src/shared/ids.js');

const PHONE = '+237677123456';
const CODE = '123456';
const device = { platform: 'ANDROID', app_version: '1.0.0' };
const valid = {
  phone_number: PHONE,
  code: CODE,
  full_name: 'Nouveau Titulaire',
  password: 'correct horse battery',
  device,
  new_holder: true,
};
const post = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/auth/register').send(body);

async function seedCode() {
  await prisma.otpChallenge.create({
    data: {
      id: newId(),
      target: PHONE,
      purpose: 'REGISTRATION',
      channel: 'SMS',
      codeHash: await hashOtp(CODE),
      expiresAt: new Date(Date.now() + 600_000),
    },
  });
}
async function seedHolder(email: string | null = null) {
  const id = newId();
  await prisma.person.create({
    data: {
      id,
      phoneNumber: PHONE,
      fullName: 'Ancien Titulaire',
      passwordHash: '$argon2id$x',
      registeredAt: new Date(),
      phoneVerifiedAt: new Date(),
      email,
      emailVerifiedAt: email ? new Date() : null,
    },
  });
  await prisma.device.create({
    data: {
      id: newId(),
      personId: id,
      platform: 'ANDROID',
      appVersion: '1.0.0',
      createdAt: new Date(Date.now() - 400 * 24 * 3600 * 1000),
    },
  });
  return id;
}
const people = `(SELECT id FROM people WHERE phone_number = '${PHONE}' OR released_phone_number = '${PHONE}')`;
async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRawUnsafe(`DELETE FROM notifications WHERE recipient_id IN ${people}`);
  await prisma.$executeRawUnsafe(`DELETE FROM refresh_tokens WHERE person_id IN ${people}`);
  await prisma.$executeRawUnsafe(`DELETE FROM devices WHERE person_id IN ${people}`);
  await prisma.$executeRawUnsafe(
    `DELETE FROM people WHERE phone_number = '${PHONE}' OR released_phone_number = '${PHONE}'`
  );
}
beforeEach(async () => {
  state.failSession = false;
  enqueue.mockClear();
  await clean();
});
afterAll(clean);

describe('register as new holder', () => {
  it('recycled', async () => {
    const p = await seedHolder();
    await seedCode();
    const res = await post(valid);
    expect(res.status).toBe(201);
    const b = res.body as { access_token: string; person: { id: string } };
    expect(typeof b.access_token).toBe('string');
    const old = await prisma.person.findUniqueOrThrow({ where: { id: p } });
    expect(old.phoneNumber).toBeNull();
    expect(old.releasedPhoneNumber).toBe(PHONE);
    expect(old.phoneVerifiedAt).toBeNull();
    expect(old.scopeVersion).toBe(1);
    const fresh = await prisma.person.findFirstOrThrow({ where: { phoneNumber: PHONE } });
    expect(fresh.id).toBe(b.person.id);
    expect(fresh.id).not.toBe(p);
    expect(fresh.registeredAt).not.toBeNull();
  });

  it('previous holder told', async () => {
    const p = await seedHolder('old@example.com');
    await seedCode();
    await post(valid);
    const n = await prisma.notification.findMany({ where: { recipientId: p } });
    expect(n).toHaveLength(1);
    expect(n[0]?.sourceEvent).toBe('phone.taken_over');
    expect(n[0]?.readStatus).toBe('UNREAD');
    expect(enqueue).toHaveBeenCalledTimes(1);
    const job = (enqueue.mock.calls[0] as unknown as [{ channel: string; message: string }])[0];
    expect(job.channel).toBe('EMAIL');
    expect(job.message).not.toContain('677');
  });

  it('no email job when email unverified or absent', async () => {
    await seedHolder();
    await seedCode();
    await post(valid);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('history kept, attacker gets nothing of P', async () => {
    const p = await seedHolder();
    await seedCode();
    const res = await post(valid);
    const b = res.body as { person: { id: string } };
    const old = await prisma.person.findUniqueOrThrow({ where: { id: p } });
    expect(old.fullName).toBe('Ancien Titulaire');
    expect(await prisma.device.count({ where: { personId: p } })).toBe(1);
    expect(await prisma.device.count({ where: { personId: b.person.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { recipientId: b.person.id } })).toBe(0);
  });

  it('no code: nobody released', async () => {
    const p = await seedHolder();
    await seedCode();
    const res = await post({ ...valid, code: '000000' });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('OTP_INVALID');
    const old = await prisma.person.findUniqueOrThrow({ where: { id: p } });
    expect(old.phoneNumber).toBe(PHONE);
    expect(old.scopeVersion).toBe(0);
  });

  it('atomic', async () => {
    const p = await seedHolder();
    await seedCode();
    state.failSession = true;
    const res = await post(valid);
    expect(res.status).toBe(500);
    const old = await prisma.person.findUniqueOrThrow({ where: { id: p } });
    expect(old.phoneNumber).toBe(PHONE);
    expect(old.releasedPhoneNumber).toBeNull();
    expect(old.scopeVersion).toBe(0);
    expect(await prisma.notification.count({ where: { recipientId: p } })).toBe(0);
  });

  it('guest or unused number behaves normally', async () => {
    await seedCode();
    const res = await post(valid);
    expect(res.status).toBe(201);
  });

  it('released number looks unknown', async () => {
    await seedHolder();
    await seedCode();
    await post(valid);
    const { findByActivePhone } = await import('../../../src/modules/person/person.repository.js');
    const holder = await findByActivePhone(PHONE);
    expect(holder?.fullName).toBe('Nouveau Titulaire');
    expect(await prisma.person.count({ where: { phoneNumber: PHONE } })).toBe(1);
  });
});
