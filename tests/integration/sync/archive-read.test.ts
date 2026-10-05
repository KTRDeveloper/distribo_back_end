import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { signAccessToken, signAdminToken } from '../../../src/lib/jwt.js';
import { createTotpSecret, encryptSecret } from '../../../src/lib/totp.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf } from '../../helpers/body';
import { seedAccount } from '../../helpers/database.js';
import { prisma } from '../../setup.js';

const PERSON_A = '0199e023-0000-7000-8000-000000000001';
const PERSON_B = '0199e023-0000-7000-8000-000000000002';
const CUSTOMER = '0199e023-0000-7000-8000-000000000003';
const DEVICE_A = '0199e023-0000-7000-8000-000000000701';
const DEVICE_B = '0199e023-0000-7000-8000-000000000702';
const DEVICE_C = '0199e023-0000-7000-8000-000000000703';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type Role = 'MODERATOR' | 'SUPER_ADMIN';
type Summary = {
  id: string;
  person_id: string;
  device_id: string;
  received_at: string;
  row_counts: Record<string, { created: number; updated: number; deleted: number }>;
};
type Page = { items: Summary[]; next_cursor: string | null };

const CHANGES = {
  orders: { created: [{ id: 'o1' }, { id: 'o2' }], updated: [{ id: 'o3' }], deleted: [] },
  order_lines: { created: [], updated: [], deleted: ['l1'] },
};

async function seedAdmin(role: Role) {
  const person = await seedAccount({
    email: `admin${newId().slice(-8)}@example.test`,
    password: 'fixture-admin-password-1',
    name: 'Fixture Admin',
  });
  const administratorId = newId();
  await prisma.administrator.create({
    data: {
      id: administratorId,
      personId: person.id,
      role,
      totpSecret: encryptSecret(createTotpSecret().secret),
    },
  });
  return signAdminToken({ personId: person.id, administratorId, role });
}

async function archive(personId: string, deviceId: string, receivedAt: string, changes = CHANGES) {
  const id = newId();
  await prisma.syncArchive.create({
    data: { id, personId, deviceId, receivedAt: new Date(receivedAt), changes: changes as object },
  });
  return id;
}

async function seedPerson(id: string, phone: string, name: string, registered = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: name,
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      ...(registered
        ? {
            email: `${phone.slice(1)}@example.test`,
            passwordHash: 'test-password-hash',
            registeredAt: LONG_AGO,
          }
        : {}),
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
}

const get = (url: string, token: string | null) => {
  const r = request(app).get(url);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const LIST = '/api/v1/admin/sync-archives';

describe('administrators list and open archived batches (SYNC-023)', () => {
  beforeEach(async () => {
    await seedPerson(PERSON_A, '+237600002301', 'Ann Author');
    await seedPerson(PERSON_B, '+237600002302', 'Ben Author');
    await seedPerson(CUSTOMER, '+237600002303', 'Cora Customer');
    for (const [id, person] of [
      [DEVICE_A, PERSON_A],
      [DEVICE_B, PERSON_B],
      [DEVICE_C, CUSTOMER],
    ]) {
      await prisma.device.create({
        data: { id, personId: person, platform: 'ANDROID', appVersion: '1.0.0' },
      });
    }
  });

  it('list: a moderator gets one person newest first, with row counts and no changes (AC-1)', async () => {
    const token = await seedAdmin('MODERATOR');
    const older = await archive(PERSON_A, DEVICE_A, '2026-09-10T10:00:00.000Z');
    await archive(PERSON_B, DEVICE_B, '2026-09-15T10:00:00.000Z');
    const newer = await archive(PERSON_A, DEVICE_A, '2026-09-20T10:00:00.000Z', {
      orders: { created: [], updated: [], deleted: [] },
    } as typeof CHANGES);

    const res = await get(`${LIST}?person_id=${PERSON_A}`, token);

    expect(res.status).toBe(200);
    const page = bodyOf<Page>(res);
    expect(page.items.map((i) => i.id)).toEqual([newer, older]);
    expect(page.next_cursor).toBeNull();
    expect(page.items[1]).toEqual({
      id: older,
      person_id: PERSON_A,
      device_id: DEVICE_A,
      received_at: '2026-09-10T10:00:00.000Z',
      row_counts: {
        orders: { created: 2, updated: 1, deleted: 0 },
        order_lines: { created: 0, updated: 0, deleted: 1 },
      },
    });
    expect(JSON.stringify(page)).not.toContain('changes');
  });

  it('list: without person_id every person is listed (AC-1)', async () => {
    const token = await seedAdmin('SUPER_ADMIN');
    await archive(PERSON_A, DEVICE_A, '2026-09-10T10:00:00.000Z');
    await archive(PERSON_B, DEVICE_B, '2026-09-15T10:00:00.000Z');
    await archive(PERSON_B, DEVICE_B, '2026-09-16T10:00:00.000Z');

    const res = await get(LIST, token);

    expect(bodyOf<Page>(res).items).toHaveLength(3);
  });

  it('open: a super administrator gets the changes, a moderator 403, an unknown id 404 (AC-2)', async () => {
    const superToken = await seedAdmin('SUPER_ADMIN');
    const moderatorToken = await seedAdmin('MODERATOR');
    const id = await archive(PERSON_A, DEVICE_A, '2026-09-10T10:00:00.000Z');

    const opened = await get(`${LIST}/${id}`, superToken);
    const refused = await get(`${LIST}/${id}`, moderatorToken);
    const unknown = await get(`${LIST}/${newId()}`, superToken);

    expect(opened.status).toBe(200);
    expect(bodyOf<Summary & { changes: unknown }>(opened)).toMatchObject({
      id,
      person_id: PERSON_A,
      device_id: DEVICE_A,
      received_at: '2026-09-10T10:00:00.000Z',
      row_counts: { orders: { created: 2, updated: 1, deleted: 0 } },
      changes: CHANGES,
    });
    expect(opened.headers['cache-control']).toBe('no-store');
    expect(refused.status).toBe(403);
    expect(bodyOf<{ error: { code: string } }>(refused).error.code).toBe('FORBIDDEN');
    expect(JSON.stringify(refused.body)).not.toContain('o1');
    expect(unknown.status).toBe(404);
    expect(bodyOf<{ error: { code: string } }>(unknown).error.code).toBe('NOT_FOUND');
  });

  it('period and paging: from and to filter, limit 1 pages without repeats (AC-3)', async () => {
    const token = await seedAdmin('MODERATOR');
    const ids = [
      await archive(PERSON_A, DEVICE_A, '2026-09-10T23:59:59.000Z'),
      await archive(PERSON_A, DEVICE_A, '2026-09-11T00:00:00.000Z'),
      await archive(PERSON_A, DEVICE_A, '2026-09-12T12:00:00.000Z'),
      await archive(PERSON_A, DEVICE_A, '2026-09-13T00:00:00.000Z'),
    ];

    const period = await get(`${LIST}?from=2026-09-11&to=2026-09-12`, token);
    expect(bodyOf<Page>(period).items.map((i) => i.id)).toEqual([ids[2], ids[1]]);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let turn = 0; turn < 6; turn += 1) {
      const url: string = `${LIST}?limit=1${cursor ? `&cursor=${cursor}` : ''}`;
      const page = bodyOf<Page>(await get(url, token));
      seen.push(...page.items.map((i) => i.id));
      cursor = page.next_cursor;
      if (!cursor) break;
    }
    expect(seen).toEqual([ids[3], ids[2], ids[1], ids[0]]);
  });

  it('list: bad query values answer 400 without echoing input (AC-3)', async () => {
    const token = await seedAdmin('MODERATOR');
    for (const query of [
      'person_id=nope',
      'from=2026-02-30',
      'from=2026-09-12&to=2026-09-11',
      'limit=101',
      'cursor=zzz',
      'extra=1',
    ]) {
      const res = await get(`${LIST}?${query}`, token);
      expect(res.status, query).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain('nope');
    }
    expect((await get(`${LIST}/not-a-uuid`, await seedAdmin('SUPER_ADMIN'))).status).toBe(400);
  });

  it('access: a normal token or none answers 401 on both routes (AC-4)', async () => {
    const id = await archive(PERSON_A, DEVICE_A, '2026-09-10T10:00:00.000Z');
    const normal = signAccessToken({ personId: PERSON_A, deviceId: DEVICE_A });

    for (const url of [LIST, `${LIST}/${id}`]) {
      expect((await get(url, normal)).status).toBe(401);
      expect((await get(url, null)).status).toBe(401);
    }
  });

  describe('security', () => {
    it("a customer's token reads nothing: 401 and no batch content (AB-1, WSTG-ATHZ-03)", async () => {
      const id = await archive(PERSON_A, DEVICE_A, '2026-09-10T10:00:00.000Z');
      const customer = signAccessToken({ personId: CUSTOMER, deviceId: DEVICE_C });

      const list = await get(LIST, customer);
      const open = await get(`${LIST}/${id}`, customer);

      expect(list.status).toBe(401);
      expect(open.status).toBe(401);
      expect(JSON.stringify([list.body, open.body])).not.toContain(PERSON_A);
    });
  });
});
