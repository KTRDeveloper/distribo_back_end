import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import {
  productsAdapter,
  variantsAdapter,
} from '../../../src/modules/sync/adapters/catalog.adapter.js';
import type { SyncAdapter, TableChange, Viewer } from '../../../src/modules/sync/sync.types.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const OWNER_A = '0199e033-0000-7000-8000-000000000001';
const OWNER_B = '0199e033-0000-7000-8000-000000000002';
const CUSTOMER = '0199e033-0000-7000-8000-000000000003';
const ORG_A = '0199e033-0000-7000-8000-0000000000a1';
const ORG_B = '0199e033-0000-7000-8000-0000000000b1';
const PRODUCT_A = '0199e033-0000-7000-8000-0000000000d1';
const PRODUCT_B = '0199e033-0000-7000-8000-0000000000d2';
const VARIANT_1 = '0199e033-0000-7000-8000-0000000000e1';
const VARIANT_2 = '0199e033-0000-7000-8000-0000000000e2';
const VARIANT_3 = '0199e033-0000-7000-8000-0000000000e3';
const VARIANT_B = '0199e033-0000-7000-8000-0000000000e4';
const REL = '0199e033-0000-7000-8000-000000000021';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const SOLD_LABEL = 'Riz — sac 5 kg (sac)';

type PushBody = {
  accepted: number;
  aside: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
};

const ownerViewer: Viewer = {
  personId: OWNER_A,
  deviceId: 'device',
  memberships: [{ organizationId: ORG_A, role: 'OWNER', status: 'ACTIVE' }],
  scopeVersion: 0,
  isOnline: false,
};

/** Runs one catalog adapter alone on already judged deletions and returns its outcomes. */
const deleteWith = (adapter: SyncAdapter, change: Partial<TableChange>) =>
  prisma.$transaction((tx) =>
    adapter.push(
      { viewer: ownerViewer, tx },
      { table: adapter.table, created: [], updated: [], deleted: [], ...change }
    )
  );

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

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Deletion Person',
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${phone.slice(1)}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
  devices[id] = `0199e033-0000-7000-8000-0000000007${phone.slice(-2)}`;
  await prisma.device.create({
    data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
  });
}

async function seedOwner(suffix: string, personId: string, org: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e033-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

/** Another phone's sale: an order line citing the variant. */
async function sell(variantId: string) {
  await prisma.order.create({
    data: {
      id: '0199e033-0000-7000-8000-000000000031',
      customerRelationshipId: REL,
      enteredById: OWNER_A,
      placedByParty: 'SUPPLIER',
      status: 'CONFIRMED',
      deliveryCost: 0n,
      totalAmount: 8000n,
      lines: {
        create: {
          id: '0199e033-0000-7000-8000-000000000032',
          productVariantId: variantId,
          labelApplied: 'Riz',
          quantity: '1',
          referencePrice: 8000n,
          unitPriceApplied: 8000n,
          amount: 8000n,
        },
      },
    },
  });
}

const variantRow = (id: string) => prisma.productVariant.findUniqueOrThrow({ where: { id } });
const productRow = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });

describe('the owner deletes variants and products (SYNC-033)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER_A, '+237600003301');
    await seedPerson(OWNER_B, '+237600003302');
    await prisma.person.create({
      data: {
        id: CUSTOMER,
        fullName: 'Customer Person',
        phoneNumber: '+237600003303',
        phoneVerifiedAt: LONG_AGO,
        passwordHash: 'test-password-hash',
        registeredAt: LONG_AGO,
      },
    });
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedOwner('01', OWNER_A, ORG_A);
    await seedOwner('02', OWNER_B, ORG_B);
    await prisma.customerRelationship.create({
      data: {
        id: REL,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        createdById: OWNER_A,
      },
    });
    await prisma.product.create({ data: { id: PRODUCT_A, organizationId: ORG_A, name: 'Riz' } });
    await prisma.product.create({ data: { id: PRODUCT_B, organizationId: ORG_B, name: 'Jus' } });
    for (const [id, name] of [
      [VARIANT_1, 'sac 5 kg'],
      [VARIANT_2, 'sac 25 kg'],
      [VARIANT_3, 'sac 50 kg'],
    ]) {
      await prisma.productVariant.create({
        data: {
          id,
          productId: PRODUCT_A,
          organizationId: ORG_A,
          name,
          unit: 'sac',
          price: 8000n,
        },
      });
    }
    await prisma.productVariant.create({
      data: {
        id: VARIANT_B,
        productId: PRODUCT_B,
        organizationId: ORG_B,
        name: 'carton',
        unit: 'carton',
        price: 5000n,
      },
    });
    await sleep(5);
  });

  it('deletes a variant no line or price cites and accepts the line (AC-1)', async () => {
    const response = await push(OWNER_A, {
      product_variants: table({ deleted: [VARIANT_2] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, aside: 0, rejected: [] });
    expect((await variantRow(VARIANT_2)).deletedAt).not.toBeNull();
    expect((await variantRow(VARIANT_1)).deletedAt).toBeNull();
  });

  it('takes a variant sold meanwhile off sale and reports it as RETIRED_INSTEAD (AC-2, C-48)', async () => {
    await sell(VARIANT_1);

    const outcomes = await deleteWith(variantsAdapter, { deleted: [VARIANT_1] });

    expect(outcomes).toEqual([
      {
        table: 'product_variants',
        id: VARIANT_1,
        kind: 'issue',
        code: 'RETIRED_INSTEAD',
        message: `${SOLD_LABEL}, vendu entre-temps : retiré de la vente au lieu d'être supprimé`,
      },
    ]);
    expect(await variantRow(VARIANT_1)).toMatchObject({ status: 'INACTIVE', deletedAt: null });
  });

  it('counts the retired line as accepted in the batch answer (AC-2)', async () => {
    await sell(VARIANT_1);

    const response = await push(OWNER_A, { product_variants: table({ deleted: [VARIANT_1] }) });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, aside: 0, rejected: [] });
    expect(await variantRow(VARIANT_1)).toMatchObject({ status: 'INACTIVE', deletedAt: null });
  });

  it('deletes a whole product: the cited variant is retired, the others deleted, the product stays (AC-3, C-48)', async () => {
    await sell(VARIANT_1);

    const outcomes = await deleteWith(productsAdapter, { deleted: [PRODUCT_A] });

    expect(outcomes).toEqual([
      {
        table: 'products',
        id: PRODUCT_A,
        kind: 'issue',
        code: 'RETIRED_INSTEAD',
        message: `${SOLD_LABEL}, vendu entre-temps : retiré de la vente au lieu d'être supprimé`,
      },
    ]);
    expect(await variantRow(VARIANT_1)).toMatchObject({ status: 'INACTIVE', deletedAt: null });
    expect((await variantRow(VARIANT_2)).deletedAt).not.toBeNull();
    expect((await variantRow(VARIANT_3)).deletedAt).not.toBeNull();
    expect((await productRow(PRODUCT_A)).deletedAt).toBeNull();
  });

  it('deletes a product with its variants when none is cited, the variants own lines being ALREADY (AC-3)', async () => {
    const response = await push(OWNER_A, {
      products: table({ deleted: [PRODUCT_A] }),
      product_variants: table({ deleted: [VARIANT_1, VARIANT_2, VARIANT_3] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 4, aside: 0, rejected: [] });
    expect((await productRow(PRODUCT_A)).deletedAt).not.toBeNull();
    for (const id of [VARIANT_1, VARIANT_2, VARIANT_3]) {
      expect((await variantRow(id)).deletedAt).not.toBeNull();
    }
  });

  it('accepts the same deletion twice and changes nothing the second time (AC-4)', async () => {
    const changes = { product_variants: table({ deleted: [VARIANT_2] }) };
    const first = await push(OWNER_A, changes);
    expect(bodyOf<PushBody>(first).accepted).toBe(1);
    const afterFirst = await variantRow(VARIANT_2);
    await sleep(5);

    const second = await push(OWNER_A, changes);

    expect(bodyOf<PushBody>(second)).toMatchObject({ accepted: 1, aside: 0, rejected: [] });
    const afterSecond = await variantRow(VARIANT_2);
    expect(afterSecond.deletedAt).toEqual(afterFirst.deletedAt);
    expect(afterSecond.serverUpdatedAt).toEqual(afterFirst.serverUpdatedAt);
  });

  it('sets the last variant aside as LAST_VARIANT and leaves it live', async () => {
    await prisma.productVariant.updateMany({
      where: { id: { in: [VARIANT_2, VARIANT_3] } },
      data: { deletedAt: LONG_AGO },
    });

    const response = await push(OWNER_A, {
      product_variants: table({ deleted: [VARIANT_1] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 0, aside: 1, rejected: [] });
    expect((await variantRow(VARIANT_1)).deletedAt).toBeNull();
  });

  it("forbids the deletion of another business's variant and product (AB-1)", async () => {
    const response = await push(OWNER_A, {
      products: table({ deleted: [PRODUCT_B] }),
      product_variants: table({ deleted: [VARIANT_B] }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.accepted).toBe(0);
    expect(body.rejected.map((r) => [r.id, r.code])).toEqual(
      expect.arrayContaining([
        [PRODUCT_B, 'OUT_OF_SCOPE'],
        [VARIANT_B, 'OUT_OF_SCOPE'],
      ])
    );
    expect(await variantRow(VARIANT_B)).toMatchObject({ deletedAt: null, status: 'ACTIVE' });
    expect((await productRow(PRODUCT_B)).deletedAt).toBeNull();
  });
});
