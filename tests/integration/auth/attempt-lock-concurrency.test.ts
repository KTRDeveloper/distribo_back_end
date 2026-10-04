import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

// The counter is atomic like the real Redis script: a call reads and writes in one step.
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
const { hashPassword } = await import('../../../src/lib/password.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

const PHONE = '+237677123492';
const PASSWORD = 'old-password-correct-horse';
const PARALLEL = 20;
let personId = '';

async function clean() {
  await prisma.$executeRaw`DELETE FROM refresh_tokens WHERE person_id IN (SELECT id FROM people WHERE phone_number = ${PHONE})`;
  await prisma.$executeRaw`DELETE FROM devices WHERE person_id IN (SELECT id FROM people WHERE phone_number = ${PHONE})`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number = ${PHONE}`;
}
beforeEach(async () => {
  store.clear();
  await clean();
  personId = newId();
  await prisma.person.create({
    data: {
      id: personId,
      fullName: 'Lock Race',
      phoneNumber: PHONE,
      registeredAt: new Date(),
      phoneVerifiedAt: new Date(),
      passwordHash: await hashPassword(PASSWORD),
    },
  });
});
afterAll(clean);

const tally = (statuses: number[]) => ({
  unauthorized: statuses.filter((s) => s === 401).length,
  locked: statuses.filter((s) => s === 429).length,
});

describe('attempt lock under parallel guesses', () => {
  it('password change: only 5 wrong guesses are tried', async () => {
    const s = await issueSession(personId, {
      platform: 'ANDROID' as const,
      app_version: '1.0.0',
    });
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        request(app)
          .post('/api/v1/auth/password/change')
          .set('Authorization', `Bearer ${s.accessToken}`)
          .send({ current_password: 'wrong-wrong-wrong', new_password: 'brand-new-battery-staple' })
      )
    );
    expect(tally(results.map((r) => r.status))).toEqual({
      unauthorized: 5,
      locked: PARALLEL - 5,
    });
  });

  it('login by number: only 5 wrong guesses are tried', async () => {
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        request(app)
          .post('/api/v1/auth/login')
          .send({ phone_number: PHONE, password: 'wrong-wrong-wrong' })
      )
    );
    expect(tally(results.map((r) => r.status))).toEqual({
      unauthorized: 5,
      locked: PARALLEL - 5,
    });
  });
});
