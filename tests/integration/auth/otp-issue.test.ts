import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, { count: number; expires: number }>();
let now = 1_000_000;
const jobs: Array<{ channel: string; to: string; message: string; subject?: string }> = [];

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: (key: string, limit: number, windowSeconds: number) => {
    const e = store.get(key);
    const cur = e && e.expires > now ? e : { count: 0, expires: now + windowSeconds * 1000 };
    if (cur.count >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
    cur.count += 1;
    store.set(key, cur);
    return Promise.resolve({ allowed: true, remaining: limit - cur.count });
  },
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: (d: (typeof jobs)[number]) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));

const { issueCode } = await import('../../../src/modules/auth/otp.service.js');
const { logger } = await import('../../../src/lib/logger.js');

const T = '+237677123456';
const input = { personId: null, target: T, purpose: 'LOGIN', channel: 'SMS' } as const;

beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  now = 1_000_000;
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
});
afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
});

const count = () => prisma.otpChallenge.count();

describe('issueCode', () => {
  it('issue', async () => {
    const before = Date.now();
    const r = await issueCode(input);
    const row = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: r.challengeId } });
    expect(row.attempts).toBe(0);
    expect(row.codeHash).toBeTruthy();
    expect(Math.abs(row.expiresAt.getTime() - (before + 600_000))).toBeLessThan(5000);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.to).toBe(T);
    expect(jobs[0]?.message).toMatch(/Votre code Distribo : \d{6}\. Il expire dans 10 minutes\./);
  });

  it('limits', async () => {
    await issueCode(input);
    now += 30_000;
    await expect(issueCode(input)).rejects.toMatchObject({ statusCode: 429, code: 'OTP_RATE_LIMITED' });
    now += 31_000;
    await expect(issueCode(input)).resolves.toBeDefined();
    now += 61_000;
    await expect(issueCode(input)).resolves.toBeDefined();
    now += 61_000;
    await expect(issueCode(input)).rejects.toMatchObject({ statusCode: 429, code: 'OTP_RATE_LIMITED' });
    expect(await count()).toBe(3);
  });

  it('foreign number', async () => {
    await expect(issueCode({ ...input, target: '+33612345678' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'UNSUPPORTED_NUMBER',
    });
    expect(await count()).toBe(0);
    expect(jobs).toHaveLength(0);
  });

  it('hash only', async () => {
    await issueCode(input);
    const row = await prisma.otpChallenge.findFirstOrThrow();
    const code = /(\d{6})/.exec(jobs[0]?.message ?? '')?.[1];
    expect(row.codeHash.startsWith('$argon2id$')).toBe(true);
    expect(row.codeHash).not.toBe(code);
  });

  it('sms pumping', async () => {
    for (let i = 0; i < 100; i++) {
      await expect(
        issueCode({ ...input, target: `+3361234${String(i).padStart(4, '0')}` })
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_NUMBER' });
    }
    expect(jobs).toHaveLength(0);
  });

  it('no code in logs', async () => {
    const lines: string[] = [];
    const spies = (['info', 'warn', 'debug', 'error'] as const).map((m) =>
      vi.spyOn(logger, m).mockImplementation(((...a: unknown[]) => {
        lines.push(JSON.stringify(a));
      }) as never)
    );
    await issueCode(input);
    const code = /(\d{6})/.exec(jobs[0]?.message ?? '')?.[1] ?? 'x';
    spies.forEach((s) => s.mockRestore());
    const out = lines.join('\n');
    expect(out).not.toContain(code);
    expect(out).not.toContain(T);
  });
});
