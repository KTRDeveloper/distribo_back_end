import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
const jobs: unknown[] = [];
const config: Record<string, number | undefined> = {};
const counterInc = vi.fn<() => void>();

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: (key: string, limit: number) => {
    const c = store.get(key) ?? 0;
    if (c >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
    store.set(key, c + 1);
    return Promise.resolve({ allowed: true, remaining: limit - c - 1 });
  },
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: (d: unknown) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: {
    get: (category: string, key: string) => Promise.resolve(category === 'otp' ? (config[key] ?? null) : null),
  },
}));
vi.mock('../../../src/lib/metrics.js', () => ({
  otpDailyCapReachedTotal: { inc: (): void => void counterInc() },
}));

const { issueCode } = await import('../../../src/modules/auth/otp.service.js');
const { logger } = await import('../../../src/lib/logger.js');

const number = (i: number) => `+2376771${String(10000 + i)}`;
const req = (i: number, keys?: { deviceId?: string; ip?: string }) =>
  issueCode({ personId: null, target: number(i), purpose: 'LOGIN', channel: 'SMS' }, keys);

beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  counterInc.mockClear();
  for (const k of Object.keys(config)) delete config[k];
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
});
afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
});

const limited = { statusCode: 429, code: 'OTP_RATE_LIMITED' };

describe('otp caps', () => {
  it.each([
    ['max_per_device_per_hour', { deviceId: 'd1' }],
    ['max_per_ip_per_hour', { ip: '10.0.0.1' }],
    ['max_per_day', {}],
  ])('caps %s', async (cap, keys) => {
    config[cap] = 2;
    await req(1, keys);
    await req(2, keys);
    await expect(req(3, keys)).rejects.toMatchObject(limited);
  });

  it('unset caps', async () => {
    for (let i = 0; i < 50; i++) await req(i, { deviceId: 'd1', ip: '10.0.0.1' });
    expect(jobs).toHaveLength(50);
  });

  it('alert', async () => {
    config.max_per_day = 1;
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    await req(1);
    await expect(req(2)).rejects.toMatchObject(limited);
    await expect(req(3)).rejects.toMatchObject(limited);
    const calls = spy.mock.calls.filter((c) => JSON.stringify(c).includes('otp_daily_cap_reached'));
    expect(calls).toHaveLength(1);
    expect(counterInc).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('distributed pumping', async () => {
    config.max_per_device_per_hour = 5;
    for (let i = 0; i < 20; i++) await req(i, { deviceId: 'dev' }).catch(() => undefined);
    expect(jobs).toHaveLength(5);
  });
});
