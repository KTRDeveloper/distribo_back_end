import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { productsAdapter } from '../../../src/modules/sync/adapters/catalog.adapter.js';
import type { TableChange, Viewer } from '../../../src/modules/sync/sync.types.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const OWNER_A = '0199e031-0000-7000-8000-000000000001';
const OWNER_B = '0199e031-0000-7000-8000-000000000002';
const ORG_A = '0199e031-0000-7000-8000-0000000000a1';
const ORG_B = '0199e031-0000-7000-8000-0000000000b1';
const PRODUCT_A = '0199e031-0000-7000-8000-0000000000d1';
const PRODUCT_B = '0199e031-0000-7000-8000-0000000000d2';
const NEW_1 = '0199e031-0000-7000-8000-000000000401';
const NEW_2 = '0199e031-0000-7000-8000-000000000402';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const PAUSED = new Date('2026-02-01T00:00:00.000Z');

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
};

const devices: Record<string, string> = {};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const push = async (personId: string, changes: unknown) =>
  createAuthenticatedRequest(app, personId, devices[personId])
    .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
    .send({ changes });

const table = (part: Partial<{ created: unknown[]; updated: unknown[]; deleted: string[] }>) => ({
  created: [],
  updated: [],
  deleted: [],
  ...part,
});

const ownerViewer: Viewer = {
  personId: OWNER_A,
  deviceId: 'device',
  memberships: [{ organizationId: ORG_A, role: 'OWNER', status: 'ACTIVE' }],
  scopeVersion: 0,
  isOnline: false,
};

/** Runs the products adapter alone on already judged lines and returns its outcomes. */
function pushToAdapter(change: Partial<TableChange>) {
  return prisma.$transaction((tx) =>
    productsAdapter.push(
      { viewer: ownerViewer, tx },
      { table: 'products', created: [], updated: [], deleted: [], ...change }
    )
  );
}

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Product Person',
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${phone.slice(1)}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
  devices[id] = `0199e031-0000-7000-8000-0000000007${phone.slice(-2)}`;
  await prisma.device.create({
    data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
  });
}

async function seedMember(suffix: string, personId: string, org: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e031-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

describe('the owner pushes products (SYNC-031)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER_A, '+237600003101');
    await seedPerson(OWNER_B, '+237600003102');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedMember('01', OWNER_A, ORG_A);
    await seedMember('02', OWNER_B, ORG_B);
    await prisma.product.create({
      data: {
        id: PRODUCT_A,
        organizationId: ORG_A,
        name: 'Eau',
        description: 'Eau minérale',
        category: 'Boissons',
        pausedAt: PAUSED,
        imageKeys: ['photo-a'],
      },
    });
    await prisma.product.create({
      data: { id: PRODUCT_B, organizationId: ORG_B, name: 'Jus', description: 'De B' },
    });
    await sleep(5);
  });

  it('stores a new product with an empty unit, no pause and no photo (AC-1)', async () => {
    const response = await push(OWNER_A, {
      products: table({
        created: [
          {
            id: NEW_1,
            organization_id: ORG_A,
            name: 'Riz parfumé',
            description: 'Sac de 25 kg',
            category: 'Céréales',
          },
        ],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([]);
    expect(body.accepted).toBe(1);
    const stored = await prisma.product.findUniqueOrThrow({ where: { id: NEW_1 } });
    expect(stored).toMatchObject({
      organizationId: ORG_A,
      name: 'Riz parfumé',
      description: 'Sac de 25 kg',
      category: 'Céréales',
      pausedAt: null,
      deletedAt: null,
      imageKeys: [],
    });
  });

  it('changes the name on an edit and leaves a repeat unchanged (AC-2)', async () => {
    const edit = {
      id: PRODUCT_A,
      organization_id: ORG_A,
      name: 'Eau pure',
      description: 'Eau minérale',
      category: 'Boissons',
    };
    const first = await push(OWNER_A, { products: table({ updated: [edit] }) });
    expect(bodyOf<PushBody>(first)).toMatchObject({ accepted: 1, rejected: [] });
    const afterFirst = await prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_A } });
    expect(afterFirst.name).toBe('Eau pure');

    await sleep(5);
    const repeat = await pushToAdapter({ updated: [edit] });

    expect(repeat).toEqual([{ table: 'products', id: PRODUCT_A, kind: 'accepted' }]);
    const afterRepeat = await prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_A } });
    expect(afterRepeat.serverUpdatedAt).toEqual(afterFirst.serverUpdatedAt);
  });

  it('writes none of paused_at, image_keys, unit and price (AC-3, C-46)', async () => {
    const response = await push(OWNER_A, {
      products: table({
        created: [
          {
            id: NEW_1,
            organization_id: ORG_A,
            name: 'Riz',
            paused_at: 5,
            image_keys: ['k1'],
            unit: 'sac',
            price: 9000,
          },
        ],
        updated: [
          {
            id: PRODUCT_A,
            organization_id: ORG_A,
            name: 'Eau pure',
            description: 'Eau minérale',
            category: 'Boissons',
            paused_at: null,
            image_keys: ['k2'],
            unit: 'litre',
            price: 100,
          },
        ],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const created = await prisma.product.findUniqueOrThrow({ where: { id: NEW_1 } });
    expect(created).toMatchObject({ pausedAt: null, imageKeys: [] });
    const updated = await prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_A } });
    expect(updated).toMatchObject({
      name: 'Eau pure',
      pausedAt: PAUSED,
      imageKeys: ['photo-a'],
    });
  });

  it('sets aside a name of 101 characters and lets the other lines pass (AC-4)', async () => {
    const response = await push(OWNER_A, {
      products: table({
        created: [
          { id: NEW_1, organization_id: ORG_A, name: 'x'.repeat(101) },
          { id: NEW_2, organization_id: ORG_A, name: 'Sucre' },
        ],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body).toMatchObject({ accepted: 1, aside: 1, rejected: [] });
    expect(await prisma.product.findUnique({ where: { id: NEW_1 } })).toBeNull();
    expect(await prisma.product.findUnique({ where: { id: NEW_2 } })).not.toBeNull();
  });

  it('answers INVALID with the field names only (AC-4, v5.0.0-2.2.1)', async () => {
    const secret = 'x'.repeat(101);
    const outcomes = await pushToAdapter({
      created: [{ id: NEW_1, organization_id: ORG_A, name: secret, category: secret }],
    });

    expect(outcomes).toEqual([
      expect.objectContaining({ table: 'products', id: NEW_1, kind: 'aside', code: 'INVALID' }),
    ]);
    expect(outcomes[0]?.message).toContain('name');
    expect(outcomes[0]?.message).toContain('category');
    expect(outcomes[0]?.message).not.toContain(secret);
  });

  it('forbids an update of a product of another business and leaves it unchanged (AB-1)', async () => {
    const response = await push(OWNER_A, {
      products: table({
        updated: [{ id: PRODUCT_B, organization_id: ORG_A, name: 'Volé' }],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.accepted).toBe(0);
    expect(body.rejected).toEqual([
      expect.objectContaining({ table: 'products', id: PRODUCT_B, code: 'OUT_OF_SCOPE' }),
    ]);
    const other = await prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_B } });
    expect(other).toMatchObject({ name: 'Jus', organizationId: ORG_B });
  });

  it('answers FOREIGN as forbidden OUT_OF_SCOPE when a created row names an id of B (AB-1)', async () => {
    const outcomes = await pushToAdapter({
      created: [{ id: PRODUCT_B, organization_id: ORG_A, name: 'Volé' }],
    });

    expect(outcomes).toEqual([
      expect.objectContaining({ id: PRODUCT_B, kind: 'forbidden', code: 'OUT_OF_SCOPE' }),
    ]);
    const other = await prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_B } });
    expect(other).toMatchObject({ name: 'Jus', organizationId: ORG_B });
  });

  it('sets aside a line in deleted until SYNC-033, and a GONE product', async () => {
    await prisma.product.update({ where: { id: PRODUCT_A }, data: { deletedAt: PAUSED } });
    const outcomes = await pushToAdapter({
      updated: [{ id: PRODUCT_A, organization_id: ORG_A, name: 'Eau' }],
      deleted: [NEW_2],
    });

    expect(outcomes).toEqual([
      expect.objectContaining({ id: PRODUCT_A, kind: 'aside', code: 'GONE' }),
      expect.objectContaining({ id: NEW_2, kind: 'aside' }),
    ]);
  });

  it('takes the organization from the scope, never from a forged row (AB-1, v5.0.0-8.2.1)', async () => {
    const response = await push(OWNER_A, {
      products: table({ created: [{ id: NEW_1, organization_id: ORG_B, name: 'Forgé' }] }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([
      expect.objectContaining({ id: NEW_1, code: 'OUT_OF_SCOPE' }),
    ]);
    expect(await prisma.product.findUnique({ where: { id: NEW_1 } })).toBeNull();
  });
});
