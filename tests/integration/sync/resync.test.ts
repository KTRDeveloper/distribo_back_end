import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { createAuthenticatedRequest, TEST_DEVICE_ID } from '../../helpers/request';
import { prisma } from '../../setup.js';

const PERSON = '0199e008-0000-7000-8000-000000000001';
const OTHER = '0199e008-0000-7000-8000-000000000002';
const OTHER_DEVICE = '0199e008-0000-7000-8000-0000000000d2';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type PullBody = {
  changes?: Record<string, unknown>;
  timestamp: number;
  scope_version: number;
  resync_required?: boolean;
};

const pull = (query = '', version?: string, personId = PERSON, deviceId = TEST_DEVICE_ID) => {
  const req = createAuthenticatedRequest(app, personId, deviceId).get(`/api/v1/sync/pull${query}`);
  return version === undefined ? req : req.set('X-Scope-Version', version);
};

async function seedPerson(id: string, phone: string, scopeVersion: number) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Resync Person',
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${phone.slice(1)}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
      scopeVersion,
    },
  });
}

async function seedDevice(id: string, personId: string, revokedAt: Date | null = null) {
  await prisma.device.create({
    data: { id, personId, platform: 'ANDROID', appVersion: '1.0.0', revokedAt },
  });
}

const device = (id: string) => prisma.device.findUniqueOrThrow({ where: { id } });

describe('GET /api/v1/sync/pull (device tracking and resync)', () => {
  beforeEach(async () => {
    await seedPerson(PERSON, '+237600000801', 5);
    await seedPerson(OTHER, '+237600000802', 5);
    await seedDevice(TEST_DEVICE_ID, PERSON);
    await seedDevice(OTHER_DEVICE, OTHER);
  });

  it('asks for a resync when the phone version is lower (AC-1)', async () => {
    const response = await pull(`?last_pulled_at=${Date.now() - 1000}`, '4');

    expect(response.status).toBe(200);
    const body = bodyOf<PullBody>(response);
    expect(body.resync_required).toBe(true);
    expect(body).not.toHaveProperty('changes');
    expect(body.scope_version).toBe(5);
    expect(typeof body.timestamp).toBe('number');
  });

  it('records the version on a full pull (AC-2)', async () => {
    const before = await pull(`?last_pulled_at=${Date.now() - 1000}`, '4');
    expect(bodyOf<PullBody>(before).resync_required).toBe(true);
    expect((await device(TEST_DEVICE_ID)).scopeVersionSeen).toBe(0);

    const response = await pull('', '4');

    expect(response.status).toBe(200);
    const body = bodyOf<PullBody>(response);
    expect(body.resync_required).toBeUndefined();
    expect(body.changes).toBeDefined();
    expect(body.scope_version).toBe(5);
    expect((await device(TEST_DEVICE_ID)).scopeVersionSeen).toBe(5);
  });

  it('returns a normal incremental pull when up to date (AC-3)', async () => {
    const response = await pull(`?last_pulled_at=${Date.now() - 1000}`, '5');

    expect(response.status).toBe(200);
    const body = bodyOf<PullBody>(response);
    expect(body.resync_required).toBeUndefined();
    expect(body.changes).toBeDefined();
    expect(body.scope_version).toBe(5);
    expect((await device(TEST_DEVICE_ID)).scopeVersionSeen).toBe(0);
  });

  it('sets last_synced_at to server time on every pull (AC-4)', async () => {
    const t0 = Date.now();
    await pull(`?last_pulled_at=${t0 - 1000}`, '5');
    const first = (await device(TEST_DEVICE_ID)).lastSyncedAt;
    expect(first).not.toBeNull();
    expect(first!.getTime()).toBeGreaterThanOrEqual(t0 - 5);
    expect(first!.getTime()).toBeLessThanOrEqual(Date.now());

    await new Promise((resolve) => setTimeout(resolve, 15));
    await pull(`?last_pulled_at=${t0 - 1000}`, '4');
    const second = (await device(TEST_DEVICE_ID)).lastSyncedAt;
    expect(second!.getTime()).toBeGreaterThan(first!.getTime());
  });

  it('answers 401 SESSION_REVOKED for a revoked device (AC-5)', async () => {
    await prisma.device.update({ where: { id: TEST_DEVICE_ID }, data: { revokedAt: new Date() } });

    const incremental = await pull(`?last_pulled_at=${Date.now() - 1000}`, '5');
    const full = await pull('', '5');

    for (const response of [incremental, full]) {
      expect(response.status).toBe(401);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('SESSION_REVOKED');
    }
    expect((await device(TEST_DEVICE_ID)).lastSyncedAt).toBeNull();
  });

  it('does not trust a phone claiming a newer version (AB-1)', async () => {
    const incremental = await pull(`?last_pulled_at=${Date.now() - 1000}`, '999');
    expect(incremental.status).toBe(200);
    expect(bodyOf<PullBody>(incremental).changes).toBeDefined();
    expect(bodyOf<PullBody>(incremental).scope_version).toBe(5);

    const full = await pull('', '999');
    expect(full.status).toBe(200);
    expect((await device(TEST_DEVICE_ID)).scopeVersionSeen).toBe(5);
  });

  it('never writes another person device (scope)', async () => {
    await pull('', '5');

    const other = await device(OTHER_DEVICE);
    expect(other.lastSyncedAt).toBeNull();
    expect(other.scopeVersionSeen).toBe(0);
  });

  it('does not let a person pull with another person device id (scope)', async () => {
    const response = await pull('', '5', PERSON, OTHER_DEVICE);

    expect(response.status).toBe(200);
    const other = await device(OTHER_DEVICE);
    expect(other.lastSyncedAt).toBeNull();
    expect(other.scopeVersionSeen).toBe(0);
  });

  it('rejects a malformed X-Scope-Version with 400 (boundary validation)', async () => {
    for (const value of ['abc', '-1', '1.5', '99999999999999']) {
      const response = await pull('', value);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('treats a missing header as version 0 on an incremental pull (fail closed)', async () => {
    const response = await pull(`?last_pulled_at=${Date.now() - 1000}`);

    expect(response.status).toBe(200);
    expect(bodyOf<PullBody>(response).resync_required).toBe(true);
  });
});
