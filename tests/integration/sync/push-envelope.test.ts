import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { organizationsAdapter } from '../../../src/modules/sync/adapters/identity.adapter.js';
import { ordersAdapter } from '../../../src/modules/sync/adapters/order.adapter.js';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { createAuthenticatedRequest, TEST_DEVICE_ID } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const minVersion = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: {
    get: (category: string, key: string) =>
      Promise.resolve(category === 'sync' && key === 'min_app_version' ? minVersion.value : null),
  },
}));

const PERSON = '0199e009-0000-7000-8000-000000000001';
const OTHER = '0199e009-0000-7000-8000-000000000002';
const ORG_A = '0199e009-0000-7000-8000-0000000000a1';
const ORG_B = '0199e009-0000-7000-8000-0000000000b1';
const NEW_ORG = '0199e009-0000-7000-8000-0000000000c1';
const ORDER_ID = '0199e009-0000-7000-8000-0000000000d1';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
  clock_skew: boolean;
  resync_required: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const push = async (
  changes: unknown,
  options: { query?: string; headers?: Record<string, string>; personId?: string } = {}
) => {
  const query = options.query ?? `?last_pulled_at=${await pulledAtAfterSeeding()}`;
  const req = createAuthenticatedRequest(app, options.personId ?? PERSON)
    .post(`/api/v1/sync/push${query}`)
    .set(options.headers ?? {});
  return req.send({ changes });
};

const emptyTable = { created: [], updated: [], deleted: [] };
const validOrder = { id: ORDER_ID, status: 'DRAFT' };
const archives = () => prisma.syncArchive.findMany();
const device = () => prisma.device.findUniqueOrThrow({ where: { id: TEST_DEVICE_ID } });

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Push Person',
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${phone.slice(1)}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
}

describe('POST /api/v1/sync/push (envelope)', () => {
  beforeEach(async () => {
    minVersion.value = null;
    await seedPerson(PERSON, '+237600000901');
    await seedPerson(OTHER, '+237600000902');
    await prisma.device.create({
      data: { id: TEST_DEVICE_ID, personId: PERSON, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    for (const id of [ORG_A, ORG_B]) {
      await prisma.organization.create({ data: { id, name: `Org ${id}`, createdAt: LONG_AGO } });
    }
    await prisma.collaboration.create({
      data: {
        id: '0199e009-0000-7000-8000-0000000000e1',
        personId: PERSON,
        organizationId: ORG_A,
        role: 'OWNER',
        status: 'ACTIVE',
        invitedAt: LONG_AGO,
        acceptedAt: LONG_AGO,
      },
    });
    await sleep(5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('archives the batch exactly as received (AC-1)', async () => {
    const changes = {
      widgets: { created: [{ id: 'w1', note: null, n: 1.5 }], updated: [], deleted: [] },
      orders: { created: [validOrder], updated: [], deleted: [ORDER_ID] },
    };

    const response = await push(changes);

    expect(response.status).toBe(200);
    const rows = await archives();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.changes).toEqual(changes);
    expect(rows[0]?.personId).toBe(PERSON);
    expect(rows[0]?.deviceId).toBe(TEST_DEVICE_ID);
  });

  it('archives the batch whatever the outcome: version refusal and conflict (AC-1)', async () => {
    minVersion.value = '2.0.0';
    const refused = await push({ orders: emptyTable }, { headers: { 'X-App-Version': '1.0.0' } });
    expect(refused.status).toBe(426);
    minVersion.value = null;

    const conflict = await push(
      { organizations: { created: [], updated: [{ id: ORG_A }], deleted: [] } },
      { query: `?last_pulled_at=${Date.now() - 60_000}` }
    );
    expect(conflict.status).toBe(409);

    expect(await archives()).toHaveLength(2);
  });

  it('refuses an app version below the minimum with 426 and keeps it archived (AC-2)', async () => {
    minVersion.value = '1.2.0';
    const spy = vi.spyOn(ordersAdapter, 'push');

    const response = await push(
      { orders: { created: [validOrder], updated: [], deleted: [] } },
      { headers: { 'X-App-Version': '1.1.9' } }
    );

    expect(response.status).toBe(426);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('APP_UPDATE_REQUIRED');
    expect(spy).not.toHaveBeenCalled();
    expect(await archives()).toHaveLength(1);
    expect((await device()).lastSyncedAt).toBeNull();
  });

  it.each([
    ['1.2.0', 200],
    ['1.2', 200],
    ['1.10.0', 200],
    ['2.0.0', 200],
    ['1.1.99', 426],
    ['0.9', 426],
  ])('compares dotted numbers: %s against minimum 1.2.0 -> %i (AC-2)', async (version, status) => {
    minVersion.value = '1.2.0';

    const response = await push({ orders: emptyTable }, { headers: { 'X-App-Version': version } });

    expect(response.status).toBe(status);
  });

  it('refuses a missing X-App-Version when a minimum is configured (fail closed)', async () => {
    minVersion.value = '1.0.0';

    const response = await push({ orders: emptyTable });

    expect(response.status).toBe(426);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('APP_UPDATE_REQUIRED');
  });

  it('processes any version when no minimum is configured (AC-2)', async () => {
    const response = await push({ orders: emptyTable }, { headers: { 'X-App-Version': '0.0.1' } });

    expect(response.status).toBe(200);
  });

  it('rejects a malformed X-App-Version or X-Client-Time with 400 and archives nothing', async () => {
    for (const headers of [{ 'X-App-Version': '1.x' }, { 'X-Client-Time': 'yesterday' }]) {
      const response = await push({ orders: emptyTable }, { headers });
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    expect(await archives()).toHaveLength(0);
  });

  it.each([
    ['6 minutes ahead', 6 * 60_000, true],
    ['6 minutes behind', -6 * 60_000, true],
    ['4 minutes ahead', 4 * 60_000, false],
    ['4 minutes behind', -4 * 60_000, false],
  ])('reports clock skew: %s (AC-2)', async (_name, offsetMs, skew) => {
    const clientTime = new Date(Date.now() + offsetMs).toISOString();

    const response = await push(
      { orders: emptyTable },
      { headers: { 'X-Client-Time': clientTime } }
    );

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response).clock_skew).toBe(skew);
  });

  it('accepts X-Client-Time as epoch milliseconds and reports no skew without it (AC-2)', async () => {
    const epoch = String(Date.now() - 10 * 60_000);
    const skewed = await push({ orders: emptyTable }, { headers: { 'X-Client-Time': epoch } });
    const absent = await push({ orders: emptyTable });

    expect(bodyOf<PushBody>(skewed).clock_skew).toBe(true);
    expect(bodyOf<PushBody>(absent).clock_skew).toBe(false);
  });

  it('answers 409 SYNC_CONFLICT and applies nothing when a pushed update is newer on the server (AC-3)', async () => {
    const orgSpy = vi.spyOn(organizationsAdapter, 'push');
    const ordersSpy = vi.spyOn(ordersAdapter, 'push');

    const response = await push(
      {
        orders: { created: [validOrder], updated: [], deleted: [] },
        organizations: { created: [], updated: [{ id: ORG_A, name: 'New name' }], deleted: [] },
      },
      { query: `?last_pulled_at=${Date.now() - 60_000}` }
    );

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('SYNC_CONFLICT');
    expect(orgSpy).not.toHaveBeenCalled();
    expect(ordersSpy).not.toHaveBeenCalled();
    expect((await device()).lastSyncedAt).toBeNull();
  });

  it('does not conflict when the phone pulled after the server change (AC-3)', async () => {
    const response = await push({
      organizations: { created: [], updated: [{ id: ORG_A }], deleted: [] },
    });

    expect(response.status).toBe(200);
  });

  it('does not reveal a row outside the viewer scope through 409 (v5.0.0-8.2.2)', async () => {
    const response = await push(
      { organizations: { created: [], updated: [{ id: ORG_B }], deleted: [] } },
      { query: `?last_pulled_at=${Date.now() - 60_000}` }
    );

    expect(response.status).toBe(200);
  });

  it('sets aside an unknown table and processes the valid line (AC-4)', async () => {
    vi.spyOn(ordersAdapter, 'push').mockResolvedValue([
      { table: 'orders', id: ORDER_ID, kind: 'accepted' },
    ]);

    const response = await push({
      widgets: { created: [{ id: 'w1' }], updated: [], deleted: [] },
      orders: { created: [validOrder], updated: [], deleted: [] },
    });

    expect(response.status).toBe(200);
    const body = bodyOf<PushBody>(response);
    expect(body.aside).toBe(1);
    expect(body.accepted).toBe(1);
    expect(body.rejected).toEqual([]);
    expect(body.resync_required).toBe(false);
  });

  it('lists a forbidden line in rejected with its code (SYNC-018 hand-off)', async () => {
    const response = await push({
      organizations: { created: [{ id: NEW_ORG }], updated: [], deleted: [] },
    });

    expect(response.status).toBe(200);
    const body = bodyOf<PushBody>(response);
    expect(body.accepted).toBe(0);
    expect(body.rejected).toEqual([
      expect.objectContaining({
        table: 'organizations',
        id: NEW_ORG,
        code: 'SYNC_TABLE_READ_ONLY',
      }),
    ]);
  });

  it('refuses more than 2000 rows with 400 and archives nothing (AC-5)', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => ({ id: `r${i}` }));

    const response = await push({ widgets: { created: rows, updated: [], deleted: [] } });

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await archives()).toHaveLength(0);
  });

  it('counts rows across tables and lists, and accepts exactly 2000 (AC-5)', async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
    const over = await push({
      widgets: { created: rows(1000), updated: rows(500), deleted: [] },
      gadgets: { created: rows(500), updated: [], deleted: ['x'] },
    });
    const exact = await push({
      widgets: { created: rows(1000), updated: rows(500), deleted: [] },
      gadgets: { created: rows(500), updated: [], deleted: [] },
    });

    expect(over.status).toBe(400);
    expect(exact.status).toBe(200);
    expect(bodyOf<PushBody>(exact).aside).toBe(2000);
  });

  it('validates the query and the body shape strictly (v5.0.0-2.2.1)', async () => {
    const send = (query: string, body: unknown) =>
      createAuthenticatedRequest(app, PERSON).post(`/api/v1/sync/push${query}`).send(body);
    const ok = `?last_pulled_at=${Date.now() - 1000}`;
    const responses = [
      await send('', { changes: {} }),
      await send('?last_pulled_at=', { changes: {} }),
      await send(`?last_pulled_at=${Date.now() + 3_600_000}`, { changes: {} }),
      await send(`${ok}&extra=1`, { changes: {} }),
      await send(ok, { changes: {}, extra: 1 }),
      await send(ok, {}),
      await send(ok, { changes: { orders: { created: [] } } }),
      await send(ok, { changes: { orders: { ...emptyTable, extra: [] } } }),
      await send(ok, { changes: { orders: { created: ['not-a-row'], updated: [], deleted: [] } } }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    expect(await archives()).toHaveLength(0);
  });

  it('sets last_synced_at to server time after a processed push (AC-6)', async () => {
    const before = Date.now();

    const response = await push({ orders: emptyTable });

    expect(response.status).toBe(200);
    const syncedAt = (await device()).lastSyncedAt;
    expect(syncedAt).not.toBeNull();
    expect(syncedAt!.getTime()).toBeGreaterThanOrEqual(before - 5);
    expect(syncedAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('is never blocked by an unknown table next to a line that breaks a uniqueness rule (AB-1)', async () => {
    const response = await push({
      widgets: { created: [{ id: 'w1' }], updated: [], deleted: [] },
      organizations: { created: [{ id: ORG_A, name: 'Duplicate' }], updated: [], deleted: [] },
    });

    expect(response.status).toBe(200);
    const body = bodyOf<PushBody>(response);
    expect(body.aside).toBe(1);
    expect(body.rejected).toHaveLength(1);
  });

  it('applies the judged batch in one transaction: a failing adapter rolls everything back (v5.0.0-2.3.3)', async () => {
    vi.spyOn(organizationsAdapter, 'push').mockImplementation(async (ctx) => {
      await ctx.tx.organization.create({ data: { id: NEW_ORG, name: 'Written then rolled back' } });
      return [{ table: 'organizations', id: NEW_ORG, kind: 'accepted' }];
    });
    vi.spyOn(ordersAdapter, 'push').mockRejectedValue(new Error('boom'));

    const response = await push({
      organizations: { created: [{ id: NEW_ORG }], updated: [], deleted: [] },
      orders: { created: [validOrder], updated: [], deleted: [] },
    });

    expect(response.status).toBe(500);
    expect(await prisma.organization.findUnique({ where: { id: NEW_ORG } })).toBeNull();
    expect(await archives()).toHaveLength(1);
    expect((await device()).lastSyncedAt).toBeNull();
  });

  it('refuses a revoked device and archives nothing', async () => {
    await prisma.device.update({ where: { id: TEST_DEVICE_ID }, data: { revokedAt: new Date() } });

    const response = await push({ orders: emptyTable });

    expect(response.status).toBe(401);
    expect(await archives()).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const { default: request } = await import('supertest');

    const response = await request(app).post('/api/v1/sync/push').send({ changes: {} });

    expect(response.status).toBe(401);
  });
});
