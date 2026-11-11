import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

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
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');
const { hashPassword } = await import('../../../src/lib/password.js');
const { createAuthenticatedRequest } = await import('../../helpers/request.js');

const PASSWORD = 'correct-horse-battery-staple';
const REG = new Date('2026-01-01T00:00:00.000Z');

let passwordHash = '';
let phoneSeq = 0;

async function seedPerson(): Promise<string> {
  const id = newId();
  phoneSeq += 1;
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: `+23767715${String(phoneSeq).padStart(4, '0')}`,
      phoneVerifiedAt: REG,
      preferredLanguage: 'FR',
      passwordHash,
      registeredAt: REG,
    },
  });
  return id;
}

/** A device with a fingerprint and a push token; revoked when `revoked` is set. */
async function seedDevice(personId: string, revoked: boolean): Promise<string> {
  const id = newId();
  await prisma.device.create({
    data: {
      id,
      personId,
      platform: 'ANDROID',
      appVersion: '1.0.0',
      pushToken: `fixture-push-${id}`,
      androidIdHash: `fixture-hash-${id}`,
      revokedAt: revoked ? REG : null,
    },
  });
  return id;
}

const del = (id: string) =>
  createAuthenticatedRequest(app, id).delete('/api/v1/users/me').send({ password: PASSWORD });

beforeEach(async () => {
  store.clear();
  passwordHash = passwordHash || (await hashPassword(PASSWORD));
});

describe('PRIV-006 account deletion and the Android fingerprints', () => {
  it('AC-1: open and revoked devices lose fingerprint and push token', async () => {
    const p = await seedPerson();
    const open = await seedDevice(p, false);
    const revoked = await seedDevice(p, true);

    expect((await del(p)).status).toBe(204);

    const rows = await prisma.device.findMany({ where: { id: { in: [open, revoked] } } });
    expect(rows).toHaveLength(2);
    for (const d of rows) {
      expect(d.androidIdHash).toBeNull();
      expect(d.pushToken).toBeNull();
    }
  });

  it('AB-1: another person keeps their fingerprint', async () => {
    const p = await seedPerson();
    const q = await seedPerson();
    await seedDevice(p, false);
    const qDevice = await seedDevice(q, false);

    expect((await del(p)).status).toBe(204);

    const row = await prisma.device.findUniqueOrThrow({ where: { id: qDevice } });
    expect(row.androidIdHash).toBe(`fixture-hash-${qDevice}`);
    expect(row.pushToken).toBe(`fixture-push-${qDevice}`);
  });
});
