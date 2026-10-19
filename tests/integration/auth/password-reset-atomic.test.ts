import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
  getCount: () => Promise.resolve(0),
  resetKey: () => Promise.resolve(),
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

const PHONE = '+237677123491';
const OLD = 'old-password-correct-horse';
const NEW = 'brand-new-battery-staple';
const dev = { platform: 'ANDROID' as const, app_version: '1.0.0' };
let personId = '';

async function clean() {
  await prisma.$executeRaw`DROP TRIGGER IF EXISTS fail_revoke ON refresh_tokens`;
  await prisma.$executeRaw`DELETE FROM refresh_tokens WHERE person_id IN (SELECT id FROM people WHERE phone_number = ${PHONE})`;
  await prisma.$executeRaw`DELETE FROM devices WHERE person_id IN (SELECT id FROM people WHERE phone_number = ${PHONE})`;
  await prisma.$executeRaw`DELETE FROM otp_challenges WHERE target = ${PHONE}`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number = ${PHONE}`;
}
beforeEach(async () => {
  await clean();
  personId = newId();
  await prisma.person.create({
    data: {
      id: personId,
      phoneNumber: PHONE,
      fullName: 'Reset Atomic',
      registeredAt: new Date(),
      passwordHash: await hashPassword(OLD),
      phoneVerifiedAt: new Date(),
    },
  });
});
afterAll(clean);

describe('password reset confirm atomicity', () => {
  it('failed revocation keeps the old password', async () => {
    const s = await issueSession(personId, dev);
    await prisma.otpChallenge.create({
      data: {
        id: newId(),
        personId,
        target: PHONE,
        purpose: 'PASSWORD_RESET',
        channel: 'SMS',
        codeHash: await hashOtp('123456'),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION fail_revoke_fn() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql`
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_revoke BEFORE UPDATE ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION fail_revoke_fn()`
    );

    const r = await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({ phone_number: PHONE, code: '123456', new_password: NEW, device: dev });

    expect(r.status).toBe(500);
    const stored = (await prisma.person.findUniqueOrThrow({ where: { id: personId } }))
      .passwordHash;
    expect(await verifyPassword(stored ?? '', OLD)).toBe(true);
    const live = await prisma.device.findMany({ where: { personId, revokedAt: null } });
    expect(live.map((d) => d.id)).toEqual([s.deviceId]);
  });
});
