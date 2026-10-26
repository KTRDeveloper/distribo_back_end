import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { signAccessToken, signAdminToken } from '../../../src/lib/jwt.js';
import { createTotpSecret, encryptSecret } from '../../../src/lib/totp.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf } from '../../helpers/body';
import { seedAccount } from '../../helpers/database.js';
import { prisma } from '../../setup.js';

const SELLER = '0199e022-0000-7000-8000-000000000001';
const OWNER_A = '0199e022-0000-7000-8000-000000000004';
const OWNER_B = '0199e022-0000-7000-8000-000000000005';
const CUSTOMER = '0199e022-0000-7000-8000-000000000006';
const ORG_A = '0199e022-0000-7000-8000-0000000000a1';
const ORG_B = '0199e022-0000-7000-8000-0000000000b1';
const REL = '0199e022-0000-7000-8000-0000000000c1';
const PRODUCT = '0199e022-0000-7000-8000-0000000000d1';
const DEVICE = '0199e022-0000-7000-8000-000000000701';
const ORDER = '0199e022-0000-7000-8000-000000000501';
const LINE = '0199e022-0000-7000-8000-000000000601';
const RECEIVED_AT = new Date('2026-09-20T10:00:00.000Z');
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type Role = 'MODERATOR' | 'SUPER_ADMIN';
type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
  resync_required: boolean;
};

const table = (part: Partial<{ created: unknown[]; updated: unknown[]; deleted: string[] }>) => ({
  created: [],
  updated: [],
  deleted: [],
  ...part,
});

const saleBatch = () => ({
  orders: table({
    created: [
      {
        id: ORDER,
        customer_relationship_id: REL,
        delivery_address_applied: 'Rue 1',
        delivery_cost: 0,
        desired_delivery_date: null,
        customer_note: null,
        created_at: Date.now() - 1000,
      },
    ],
  }),
  order_lines: table({
    created: [
      {
        id: LINE,
        order_id: ORDER,
        product_variant_id: PRODUCT,
        quantity: '10',
        reference_price: 3000,
        unit_price_applied: 3000,
      },
    ],
  }),
});

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
  const token = signAdminToken({ personId: person.id, administratorId, role });
  return { person, administratorId, token };
}

async function archive(changes: unknown = saleBatch(), personId = SELLER) {
  const id = newId();
  await prisma.syncArchive.create({
    data: { id, personId, deviceId: DEVICE, receivedAt: RECEIVED_AT, changes: changes as object },
  });
  return id;
}

const replay = (token: string | null, archiveId: string, body: unknown = { reason: 'Fixed' }) => {
  const r = request(app).post(`/api/v1/admin/sync-archives/${archiveId}/replay`);
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body as object);
};

const nothingChanged = async () => {
  expect(await prisma.adminAction.count()).toBe(0);
  expect(await prisma.order.count()).toBe(0);
  expect(await prisma.notification.count({ where: { sourceEvent: 'sync.replayed' } })).toBe(0);
};

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

async function seedMember(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e022-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

describe('super administrator replays an archived batch (SYNC-022)', () => {
  beforeEach(async () => {
    await seedPerson(SELLER, '+237600002201', 'Sam Seller');
    await seedPerson(OWNER_A, '+237600002204', 'Olga Owner');
    await seedPerson(OWNER_B, '+237600002205', 'Otto Owner');
    await seedPerson(CUSTOMER, '+237600002206', 'Cora Customer', false);
    await prisma.device.create({
      data: { id: DEVICE, personId: SELLER, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedMember('04', OWNER_A, ORG_A, 'OWNER');
    await seedMember('05', OWNER_B, ORG_B, 'OWNER');
    await seedMember('01', SELLER, ORG_A, 'SELLER');
    await prisma.product.create({
      data: { id: PRODUCT, organizationId: ORG_A, name: 'Riz', unit: 'sac', price: 3000n },
    });
    await prisma.customerRelationship.create({
      data: {
        id: REL,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        customerLabel: 'Chez Client',
        createdById: OWNER_A,
        createdAt: LONG_AGO,
        status: 'ACTIVE',
        deliveryAddress: 'Rue 1',
        creditLimit: 50000n,
      },
    });
  });

  it('replay: stores the sale, journals REPLAY_SYNC and tells the author and the owner (AC-1, CM-32, C-29)', async () => {
    const admin = await seedAdmin('SUPER_ADMIN');
    const archiveId = await archive();

    const res = await replay(admin.token, archiveId, { reason: 'Cause fixed' });

    expect(res.status).toBe(200);
    expect(bodyOf<PushBody>(res)).toMatchObject({ accepted: 2, rejected: [], aside: 0 });
    expect(await prisma.order.count({ where: { id: ORDER } })).toBe(1);
    expect(await prisma.orderLine.count({ where: { id: LINE } })).toBe(1);
    const journal = await prisma.adminAction.findMany();
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      administratorId: admin.administratorId,
      action: 'REPLAY_SYNC',
      targetPersonId: SELLER,
      targetOrganizationId: null,
      syncArchiveId: archiveId,
      reason: 'Cause fixed',
    });
    const notices = await prisma.notification.findMany({ where: { sourceEvent: 'sync.replayed' } });
    expect(notices.map((n) => n.recipientId).sort()).toEqual([SELLER, OWNER_A].sort());
    for (const notice of notices) {
      expect(notice.content).toContain('2026-09-20');
      expect(notice.content).toContain("ont été réintégrées par l'équipe de la plateforme");
    }
  });

  it("author's rights: judges the batch with the author's current rights, not the administrator's (AC-2)", async () => {
    const admin = await seedAdmin('SUPER_ADMIN');
    const archiveId = await archive();
    await prisma.collaboration.updateMany({
      where: { personId: SELLER, organizationId: ORG_A },
      data: { role: 'DRIVER' },
    });

    const res = await replay(admin.token, archiveId);

    expect(res.status).toBe(200);
    const body = bodyOf<PushBody>(res);
    expect(body.rejected.length).toBeGreaterThan(0);
    expect(body.resync_required).toBe(true);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.adminAction.count()).toBe(1);
  });

  it('idempotent: replaying twice writes the sale once (AC-3)', async () => {
    const admin = await seedAdmin('SUPER_ADMIN');
    const archiveId = await archive();

    const first = await replay(admin.token, archiveId);
    const second = await replay(admin.token, archiveId);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await prisma.order.count({ where: { id: ORDER } })).toBe(1);
    expect(await prisma.orderLine.count({ where: { id: LINE } })).toBe(1);
    expect(await prisma.notification.count({ where: { sourceEvent: 'sync.refused' } })).toBe(0);
  });

  describe('refusals (AC-4)', () => {
    it('refuses a MODERATOR with 403 FORBIDDEN and changes nothing', async () => {
      const moderator = await seedAdmin('MODERATOR');
      const archiveId = await archive();

      const res = await replay(moderator.token, archiveId);

      expect(res.status).toBe(403);
      expect(bodyOf<{ error: { code: string } }>(res).error.code).toBe('FORBIDDEN');
      await nothingChanged();
    });

    it.each([
      ['an empty reason', { reason: '' }],
      ['a blank reason', { reason: '   ' }],
      ['no reason', {}],
      ['a reason over 2000 characters', { reason: 'x'.repeat(2001) }],
      ['an unknown field', { reason: 'ok', administrator_id: SELLER }],
    ])('refuses %s with 400 VALIDATION_ERROR and changes nothing', async (_name, body) => {
      const admin = await seedAdmin('SUPER_ADMIN');
      const archiveId = await archive();

      const res = await replay(admin.token, archiveId, body);

      expect(res.status).toBe(400);
      expect(bodyOf<{ error: { code: string } }>(res).error.code).toBe('VALIDATION_ERROR');
      await nothingChanged();
    });

    it('refuses an unknown archive with 404 NOT_FOUND and changes nothing', async () => {
      const admin = await seedAdmin('SUPER_ADMIN');
      await archive();

      const res = await replay(admin.token, newId());

      expect(res.status).toBe(404);
      expect(bodyOf<{ error: { code: string } }>(res).error.code).toBe('NOT_FOUND');
      await nothingChanged();
    });

    it('refuses a normal access token and no token with 401 UNAUTHORIZED', async () => {
      const archiveId = await archive();
      const normal = signAccessToken({ personId: OWNER_A, deviceId: DEVICE });

      const withNormal = await replay(normal, archiveId);
      const withNone = await replay(null, archiveId);

      expect(withNormal.status).toBe(401);
      expect(withNone.status).toBe(401);
      expect(bodyOf<{ error: { code: string } }>(withNormal).error.code).toBe('UNAUTHORIZED');
      await nothingChanged();
    });
  });

  it('atomic: applies no line when the journal insert fails (AC-5, CWE-362)', async () => {
    // The route guard is bypassed on purpose: the database refuses a REPLAY_SYNC row of a moderator.
    const moderator = await seedAdmin('MODERATOR');
    const archiveId = await archive();
    const { replayArchive } = await import('../../../src/modules/sync/sync.service.js');

    await expect(
      replayArchive(
        {
          personId: moderator.person.id,
          administratorId: moderator.administratorId,
          role: 'SUPER_ADMIN',
        },
        archiveId,
        { reason: 'Forced' }
      )
    ).rejects.toThrow();

    await nothingChanged();
  });

  it('admin power: refuses a manager-only line because the seller rights apply (AB-1, CWE-269)', async () => {
    const admin = await seedAdmin('SUPER_ADMIN');
    const archiveId = await archive({
      customer_relationships: table({ updated: [{ id: REL, credit_limit: 1_000_000 }] }),
    });

    const res = await replay(admin.token, archiveId);

    expect(res.status).toBe(200);
    expect(bodyOf<PushBody>(res).rejected).toEqual([
      expect.objectContaining({
        table: 'customer_relationships',
        id: REL,
        code: 'FIELD_NOT_ALLOWED',
      }),
    ]);
    const stored = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: REL } });
    expect(stored.creditLimit).toBe(50000n);
  });

  it('traced: a replay with every line refused still leaves a journal row (AB-2, CWE-778)', async () => {
    const admin = await seedAdmin('SUPER_ADMIN');
    const archiveId = await archive({
      customer_relationships: table({ updated: [{ id: REL, credit_limit: 1_000_000 }] }),
    });

    await replay(admin.token, archiveId, { reason: 'Trace me' });

    const journal = await prisma.adminAction.findMany({ where: { syncArchiveId: archiveId } });
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ action: 'REPLAY_SYNC', reason: 'Trace me' });
  });

  it("does not move the author's device last_synced_at: a replay is not a sync (CM-32)", async () => {
    const admin = await seedAdmin('SUPER_ADMIN');
    const archiveId = await archive();

    await replay(admin.token, archiveId);

    const device = await prisma.device.findUniqueOrThrow({ where: { id: DEVICE } });
    expect(device.lastSyncedAt).toBeNull();
  });
});
