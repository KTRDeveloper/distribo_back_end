import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { prisma } from '../../setup';

const { app } = await import('../../../src/app.js');
const { createTotpSecret, encryptSecret } = await import('../../../src/lib/totp.js');
const { signAdminToken, signAccessToken } = await import('../../../src/lib/jwt.js');
const { newId } = await import('../../../src/shared/ids.js');

type ActionItem = {
  id: string;
  administrator_id: string;
  action: string;
  target_person_id: string | null;
  target_organization_id: string | null;
  report_id: string | null;
  sync_archive_id: string | null;
  reason: string;
  occurred_at: string;
};
type ListBody = { items: ActionItem[]; next_cursor: string | null };

const REG = new Date('2026-01-01T00:00:00.000Z');
const PERSON_A = '0199d015-0000-7000-8000-000000000001';
const PERSON_B = '0199d015-0000-7000-8000-000000000002';
const ORG_ID = '0199d015-0000-7000-8000-000000000011';

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
}

let adminSeq = 0;
async function seedAdmin(role: 'MODERATOR' | 'SUPER_ADMIN' = 'MODERATOR') {
  const personId = newId();
  adminSeq += 1;
  await seedPerson(personId, `+23760015${String(adminSeq).padStart(4, '0')}`);
  const administratorId = newId();
  await prisma.administrator.create({
    data: {
      id: administratorId,
      personId,
      role,
      totpSecret: encryptSecret(createTotpSecret().secret),
    },
  });
  return { personId, administratorId, token: signAdminToken({ personId, administratorId, role }) };
}

async function seedAction(
  administratorId: string,
  at: string,
  extra: Partial<{
    id: string;
    action: 'SUSPEND' | 'REACTIVATE';
    targetPersonId: string | null;
    targetOrganizationId: string | null;
  }> = {}
) {
  const orgTarget = extra.targetOrganizationId != null;
  return prisma.adminAction.create({
    data: {
      id: extra.id ?? newId(),
      administratorId,
      action: extra.action ?? 'SUSPEND',
      targetPersonId: orgTarget ? null : (extra.targetPersonId ?? PERSON_A),
      targetOrganizationId: extra.targetOrganizationId ?? null,
      reason: 'Fixture reason',
      occurredAt: new Date(at),
    },
  });
}

const get = (url: string, token: string | null) => {
  const r = request(app).get(url);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

const customerToken = () =>
  signAccessToken({ personId: PERSON_A, deviceId: '018f0000-0000-7000-8000-000000000001' });

beforeEach(async () => {
  await seedPerson(PERSON_A, '+237600015001');
  await seedPerson(PERSON_B, '+237600015002');
  await prisma.organization.create({ data: { id: ORG_ID, name: 'Fixture Org' } });
});

describe('GET /api/v1/admin/actions', () => {
  it('list: 5 rows come back newest first with the listed fields (AC-1)', async () => {
    const admin = await seedAdmin();
    const rows = [];
    for (let day = 1; day <= 5; day += 1) {
      rows.push(await seedAction(admin.administratorId, `2026-03-0${day}T00:00:00.000Z`));
    }

    const res = await get('/api/v1/admin/actions', admin.token);

    expect(res.status).toBe(200);
    const body = bodyOf<ListBody>(res);
    expect(body.items.map((i) => i.id)).toEqual(rows.map((r) => r.id).reverse());
    expect(body.next_cursor).toBeNull();
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
      'action',
      'administrator_id',
      'id',
      'occurred_at',
      'reason',
      'report_id',
      'sync_archive_id',
      'target_organization_id',
      'target_person_id',
    ]);
    expect(body.items[0]).toMatchObject({
      administrator_id: admin.administratorId,
      action: 'SUSPEND',
      target_person_id: PERSON_A,
      target_organization_id: null,
      report_id: null,
      sync_archive_id: null,
      reason: 'Fixture reason',
      occurred_at: '2026-03-05T00:00:00.000Z',
    });
  });

  it('filters: action, administrator_id, target_person_id and target_organization_id (AC-2)', async () => {
    const one = await seedAdmin();
    const two = await seedAdmin('SUPER_ADMIN');
    const suspendA = await seedAction(one.administratorId, '2026-03-01T00:00:00.000Z');
    const reactivateA = await seedAction(two.administratorId, '2026-03-02T00:00:00.000Z', {
      action: 'REACTIVATE',
    });
    const suspendB = await seedAction(two.administratorId, '2026-03-03T00:00:00.000Z', {
      targetPersonId: PERSON_B,
    });
    const suspendOrg = await seedAction(one.administratorId, '2026-03-04T00:00:00.000Z', {
      targetOrganizationId: ORG_ID,
    });

    const ids = async (qs: string) => {
      const res = await get(`/api/v1/admin/actions?${qs}`, two.token);
      expect(res.status, qs).toBe(200);
      return bodyOf<ListBody>(res).items.map((i) => i.id);
    };

    expect(await ids('action=REACTIVATE')).toEqual([reactivateA.id]);
    expect(await ids('action=SUSPEND')).toEqual([suspendOrg.id, suspendB.id, suspendA.id]);
    expect(await ids(`administrator_id=${one.administratorId}`)).toEqual([
      suspendOrg.id,
      suspendA.id,
    ]);
    expect(await ids(`target_person_id=${PERSON_B}`)).toEqual([suspendB.id]);
    expect(await ids(`target_person_id=${PERSON_A}`)).toEqual([reactivateA.id, suspendA.id]);
    expect(await ids(`target_organization_id=${ORG_ID}`)).toEqual([suspendOrg.id]);
    expect(await ids(`action=SUSPEND&target_person_id=${PERSON_A}`)).toEqual([suspendA.id]);
  });

  it('paging: limit 2 with the cursor gives pages of 2, 2 and 1 (AC-3)', async () => {
    const admin = await seedAdmin();
    const rows = [];
    for (let day = 1; day <= 5; day += 1) {
      rows.push(await seedAction(admin.administratorId, `2026-03-0${day}T00:00:00.000Z`));
    }
    const expected = rows.map((r) => r.id).reverse();

    const sizes: number[] = [];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/api/v1/admin/actions?limit=2${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      }`;
      const res = await get(url, admin.token);
      expect(res.status).toBe(200);
      const body = bodyOf<ListBody>(res);
      sizes.push(body.items.length);
      seen.push(...body.items.map((i) => i.id));
      cursor = body.next_cursor;
    } while (cursor);

    expect(sizes).toEqual([2, 2, 1]);
    expect(seen).toEqual(expected);
  });

  it('paging: rows with the same occurred_at are neither skipped nor repeated', async () => {
    const admin = await seedAdmin();
    const rows = [];
    for (let i = 0; i < 3; i += 1) {
      rows.push(await seedAction(admin.administratorId, '2026-03-01T00:00:00.000Z'));
    }

    const first = bodyOf<ListBody>(await get('/api/v1/admin/actions?limit=2', admin.token));
    const second = bodyOf<ListBody>(
      await get(
        `/api/v1/admin/actions?limit=2&cursor=${encodeURIComponent(first.next_cursor ?? '')}`,
        admin.token
      )
    );

    const seen = [...first.items, ...second.items].map((i) => i.id);
    expect(seen).toHaveLength(3);
    expect(new Set(seen)).toEqual(new Set(rows.map((r) => r.id)));
    expect(second.next_cursor).toBeNull();
  });

  it('a bad filter, limit, cursor or an unknown parameter is 400', async () => {
    const admin = await seedAdmin();
    for (const qs of [
      'action=OTHER',
      'administrator_id=nope',
      'target_person_id=nope',
      'target_organization_id=nope',
      'limit=101',
      'limit=0',
      'cursor=!!',
      'foo=1',
    ]) {
      const res = await get(`/api/v1/admin/actions?${qs}`, admin.token);
      expect(res.status, qs).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('access', () => {
  it.each([
    ['a moderator token', 200],
    ['a super administrator token', 200],
    ['a normal access token', 401],
    ['no token', 401],
  ])('%s: the journal answers %i (AC-4)', async (label, status) => {
    const moderator = await seedAdmin();
    const superAdmin = await seedAdmin('SUPER_ADMIN');
    const token =
      label === 'a moderator token'
        ? moderator.token
        : label === 'a super administrator token'
          ? superAdmin.token
          : label === 'no token'
            ? null
            : customerToken();

    const res = await get('/api/v1/admin/actions', token);

    expect(res.status).toBe(status);
  });

  it('a removed administrator is refused at once (v5.0.0-8.2.1)', async () => {
    const admin = await seedAdmin();
    await prisma.administrator.update({
      where: { id: admin.administratorId },
      data: { removedAt: new Date() },
    });

    const res = await get('/api/v1/admin/actions', admin.token);

    expect(res.status).toBe(401);
  });

  it('a customer token never returns a journal row (AB-1, WSTG-ATHZ-03)', async () => {
    const admin = await seedAdmin();
    await seedAction(admin.administratorId, '2026-03-01T00:00:00.000Z');

    const res = await get('/api/v1/admin/actions', customerToken());

    expect(res.status).toBe(401);
    expect(res.text).not.toContain('Fixture reason');
    expect(res.text).not.toContain('items');
  });
});
