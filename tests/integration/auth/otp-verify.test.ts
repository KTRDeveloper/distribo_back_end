import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: () => Promise.resolve(),
}));

const { verifyCode } = await import('../../../src/modules/auth/otp.service.js');
const { hashOtp } = await import('../../../src/lib/otp.js');
const { newId } = await import('../../../src/shared/ids.js');

const T = '+237677123456';
const base = { target: T, purpose: 'LOGIN' } as const;
const RIGHT = '123456';

async function seed(code = RIGHT, over: { expiresAt?: Date; createdAt?: Date } = {}) {
  const id = newId();
  await prisma.otpChallenge.create({
    data: {
      id,
      target: T,
      purpose: 'LOGIN',
      channel: 'SMS',
      codeHash: await hashOtp(code),
      expiresAt: over.expiresAt ?? new Date(Date.now() + 600_000),
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
    },
  });
  return id;
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string }) => e.code
  );

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
});
afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
});

describe('verifyCode', () => {
  it('right code', async () => {
    const id = await seed();
    const r = await verifyCode({ ...base, code: RIGHT });
    expect(r).toEqual({ challengeId: id, personId: null });
    expect((await prisma.otpChallenge.findUniqueOrThrow({ where: { id } })).consumedAt).not.toBeNull();
  });
  it('single use', async () => {
    await seed();
    await verifyCode({ ...base, code: RIGHT });
    expect(await code(verifyCode({ ...base, code: RIGHT }))).toBe('OTP_INVALID');
  });
  it('expiry', async () => {
    const id = await seed(RIGHT, { expiresAt: new Date(Date.now() - 1000) });
    expect(await code(verifyCode({ ...base, code: RIGHT }))).toBe('OTP_EXPIRED');
    expect((await prisma.otpChallenge.findUniqueOrThrow({ where: { id } })).consumedAt).toBeNull();
  });
  it('attempts', async () => {
    const id = await seed();
    for (let i = 0; i < 5; i++) {
      expect(await code(verifyCode({ ...base, code: '000000' }))).toBe('OTP_INVALID');
    }
    expect(await code(verifyCode({ ...base, code: RIGHT }))).toBe('OTP_LOCKED');
    const row = await prisma.otpChallenge.findUniqueOrThrow({ where: { id } });
    expect(row.attempts).toBe(5);
    expect(row.consumedAt).toBeNull();
  });
  it('newest only', async () => {
    await seed('111111', { createdAt: new Date(Date.now() - 5000) });
    await seed('222222');
    expect(await code(verifyCode({ ...base, code: '111111' }))).toBe('OTP_INVALID');
  });
  it('guessing', async () => {
    const id = await seed();
    const res = await Promise.all(
      Array.from({ length: 1000 }, () => code(verifyCode({ ...base, code: '000000' })))
    );
    expect(res.filter((r) => r === 'OTP_INVALID')).toHaveLength(5);
    expect(res.filter((r) => r === 'OTP_LOCKED')).toHaveLength(995);
    const row = await prisma.otpChallenge.findUniqueOrThrow({ where: { id } });
    expect(row.attempts).toBe(5);
    expect(row.consumedAt).toBeNull();
  });
  it('parallel use', async () => {
    await seed();
    const res = await Promise.all([
      code(verifyCode({ ...base, code: RIGHT })),
      code(verifyCode({ ...base, code: RIGHT })),
    ]);
    expect(res.filter((r) => r === 'ok')).toHaveLength(1);
  });
});
