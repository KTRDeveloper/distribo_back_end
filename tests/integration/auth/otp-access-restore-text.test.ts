import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const jobs: Array<{ channel: string; to: string; message: string; subject?: string }> = [];

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: (d: (typeof jobs)[number]) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));

const { issueCode } = await import('../../../src/modules/auth/otp.service.js');

const PERSON_FR = '0199c018-0000-7000-8000-0000000000f1';
const PERSON_EN = '0199c018-0000-7000-8000-0000000000e1';
const PHONE = '+237677000018';
const EMAIL = 'restore-fixture@example.com';

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges WHERE target IN (${PHONE}, ${EMAIL})`;
  await prisma.$executeRaw`DELETE FROM people WHERE id IN (${PERSON_FR}::uuid, ${PERSON_EN}::uuid)`;
}

beforeEach(async () => {
  jobs.length = 0;
  await clean();
  await prisma.$executeRaw`
    INSERT INTO people (id, phone_number, full_name, password_hash, phone_verified_at, registered_at, preferred_language, created_at, server_updated_at)
    VALUES (${PERSON_FR}::uuid, '+237677099018', 'Fixture One', 'hash', now(), now(), 'FR'::"Language", now(), now()),
           (${PERSON_EN}::uuid, '+237677099019', 'Fixture Two', 'hash', now(), now(), 'EN'::"Language", now(), now())`;
});
afterAll(clean);

const FR = (c: string) =>
  `Code ${c}. Ne le donnez qu'à l'agent du support que vous avez contacté vous-même.`;
const EN = (c: string) => `Code ${c}. Only give it to the support agent you contacted yourself.`;
const sentCode = () => /(\d{6})/.exec(jobs[jobs.length - 1]?.message ?? '')?.[1] ?? 'x';

const restore = (personId: string, channel: 'SMS' | 'EMAIL') =>
  issueCode({
    personId,
    target: channel === 'SMS' ? PHONE : EMAIL,
    purpose: 'ACCESS_RESTORE',
    channel,
  });

describe('access restore code: fixed text', () => {
  it('FR and EN, by SMS and by email', async () => {
    for (const channel of ['SMS', 'EMAIL'] as const) {
      await restore(PERSON_FR, channel);
      expect(jobs[jobs.length - 1]?.message).toBe(FR(sentCode()));
      expect(sentCode()).toMatch(/^\d{6}$/);
    }
    jobs.length = 0;
    await prisma.$executeRaw`DELETE FROM otp_challenges WHERE target IN (${PHONE}, ${EMAIL})`;
    for (const channel of ['SMS', 'EMAIL'] as const) {
      await restore(PERSON_EN, channel);
      expect(jobs[jobs.length - 1]?.message).toBe(EN(sentCode()));
    }
    expect(jobs).toHaveLength(2);
  });

  it('keeps the earlier text for REGISTRATION', async () => {
    await issueCode({ personId: PERSON_FR, target: PHONE, purpose: 'REGISTRATION', channel: 'SMS' });
    expect(jobs[0]?.message).toBe(
      `Votre code Distribo : ${sentCode()}. Il expire dans 10 minutes.`
    );
    jobs.length = 0;
    await issueCode({ personId: PERSON_EN, target: EMAIL, purpose: 'REGISTRATION', channel: 'EMAIL' });
    expect(jobs[0]?.message).toBe(`Your Distribo code: ${sentCode()}. It expires in 10 minutes.`);
  });

  it('AB-1 holds only the code and the sentence, no name, email or number', async () => {
    await restore(PERSON_FR, 'SMS');
    await restore(PERSON_EN, 'EMAIL');
    for (const job of jobs) {
      const rest = job.message.replace(/Code \d{6}\. /, '');
      expect(rest).not.toMatch(/\d/);
      for (const secret of ['Fixture', '@', 'example.com', '+237', '677']) {
        expect(job.message).not.toContain(secret);
      }
      expect(job.message).not.toContain('expire');
    }
  });
});
