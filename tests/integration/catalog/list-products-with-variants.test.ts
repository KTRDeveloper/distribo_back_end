import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0c0-0000-7000-8000-000000000001';
const SELLER = '0199c0c0-0000-7000-8000-000000000003';
const DRIVER = '0199c0c0-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0c0-0000-7000-8000-000000000005';

const ORG_A = '0199c0c0-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0c0-0000-7000-8000-0000000000b1';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Variant = { id: string; name: string | null; status: string; label: string };
type Item = {
  id: string;
  name: string;
  category: string | null;
  paused: boolean;
  variants: Variant[];
};
type Page = { items: Item[]; next_cursor: string | null };

const idOf = (prefix: string, n: number) => `0199c0c0-0000-7000-8000-0000000000${prefix}${n}`;
const P1 = idOf('d', 1); // older: Boissons, two variants (one INACTIVE)
const P2 = idOf('d', 2); // newer: only an INACTIVE variant
const P3 = idOf('d', 3); // newest

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

async function seedMember(
  orgId: string,
  personId: string,
  role: 'OWNER' | 'SELLER' | 'DRIVER',
  suffix: number
) {
  await prisma.collaboration.create({
    data: {
      id: orgId.slice(0, -3) + orgId.slice(-2, -1) + suffix + '5',
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedProduct(
  id: string,
  data: {
    name: string;
    createdAt: string;
    category?: string;
    organizationId?: string;
    pausedAt?: Date;
    deletedAt?: Date;
  }
) {
  await prisma.product.create({
    data: {
      id,
      organizationId: data.organizationId ?? ORG_A,
      name: data.name,
      category: data.category ?? null,
      createdAt: new Date(data.createdAt),
      pausedAt: data.pausedAt ?? null,
      deletedAt: data.deletedAt ?? null,
    },
  });
}

async function seedVariant(
  id: string,
  productId: string,
  data: {
    name?: string;
    unit?: string;
    status?: 'ACTIVE' | 'INACTIVE';
    createdAt: string;
    organizationId?: string;
    deletedAt?: Date;
  }
) {
  await prisma.productVariant.create({
    data: {
      id,
      productId,
      organizationId: data.organizationId ?? ORG_A,
      name: data.name ?? null,
      unit: data.unit ?? 'sac',
      price: 1000n,
      status: data.status ?? 'ACTIVE',
      createdAt: new Date(data.createdAt),
      deletedAt: data.deletedAt ?? null,
    },
  });
}

function list(query = '', orgId = ORG_A, personId = SELLER) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${orgId}/products${query}`
  );
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009301');
  await seedPerson(SELLER, '+237600009303');
  await seedPerson(DRIVER, '+237600009304');
  await seedPerson(OTHER_OWNER, '+237600009305');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A' } });
  await seedMember(ORG_A, OWNER, 'OWNER', 9);
  await seedMember(ORG_A, SELLER, 'SELLER', 2);
  await seedMember(ORG_A, DRIVER, 'DRIVER', 3);
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B' } });
  await seedMember(ORG_B, OTHER_OWNER, 'OWNER', 9);

  await seedProduct(P1, { name: 'Jus', category: 'Boissons', createdAt: '2026-02-01T00:00:00Z' });
  await seedVariant(idOf('e', 1), P1, {
    name: 'Rouge',
    unit: 'carton',
    createdAt: '2026-02-01T00:00:01Z',
  });
  await seedVariant(idOf('e', 2), P1, {
    name: 'Vert',
    unit: 'carton',
    status: 'INACTIVE',
    createdAt: '2026-02-01T00:00:02Z',
  });
  await seedProduct(P2, { name: 'Riz', category: 'Céréales', createdAt: '2026-02-02T00:00:00Z' });
  await seedVariant(idOf('e', 3), P2, {
    unit: 'sac',
    status: 'INACTIVE',
    createdAt: '2026-02-02T00:00:01Z',
  });
});

describe('GET /api/v1/organizations/:organizationId/products with variants', () => {
  it('AC-1 both products with all their variants, newest product first', async () => {
    const response = await list();

    expect(response.status).toBe(200);
    const body = bodyOf<Page>(response);
    expect(body.items.map((i) => i.id)).toEqual([P2, P1]);
    expect(body.next_cursor).toBeNull();
    expect(body.items[0].variants.map((v) => v.status)).toEqual(['INACTIVE']);
    expect(body.items[1].variants.map((v) => [v.name, v.status])).toEqual([
      ['Rouge', 'ACTIVE'],
      ['Vert', 'INACTIVE'],
    ]);
    expect(Object.keys(body.items[1]).sort()).toEqual(
      ['category', 'description', 'id', 'image_urls', 'name', 'paused', 'variants'].sort()
    );
    expect(body.items[1].paused).toBe(false);
  });

  it('a deleted variant and a deleted product are not listed', async () => {
    await seedVariant(idOf('e', 4), P1, {
      name: 'Vieux',
      createdAt: '2026-02-01T00:00:03Z',
      deletedAt: REG,
    });
    await seedProduct(P3, { name: 'Ancien', createdAt: '2026-02-03T00:00:00Z', deletedAt: REG });

    const body = bodyOf<Page>(await list());

    expect(body.items.map((i) => i.id)).toEqual([P2, P1]);
    expect(body.items[1].variants.map((v) => v.name)).toEqual(['Rouge', 'Vert']);
  });

  it('a paused product is listed with paused: true', async () => {
    await prisma.product.update({ where: { id: P1 }, data: { pausedAt: REG } });

    const body = bodyOf<Page>(await list());

    expect(body.items.find((i) => i.id === P1)?.paused).toBe(true);
    expect(body.items.find((i) => i.id === P2)?.paused).toBe(false);
  });

  it.each([
    ['status=ACTIVE', [P1]],
    ['status=INACTIVE', [P2]],
    ['q=rouge', [P1]],
    ['q=ROUG', [P1]],
    ['category=Boissons', [P1]],
    ['category=Boissons&status=INACTIVE', []],
  ])('AC-2 filter %s', async (query, ids) => {
    const response = await list(`?${query}`);

    expect(response.status).toBe(200);
    expect(bodyOf<Page>(response).items.map((i) => i.id)).toEqual(ids);
  });

  it('AC-2 q matches the product name too, and a matching product keeps all its variants', async () => {
    const body = bodyOf<Page>(await list('?q=riz'));

    expect(body.items.map((i) => i.id)).toEqual([P2]);
    const byVariant = bodyOf<Page>(await list('?q=vert'));
    expect(byVariant.items[0].variants).toHaveLength(2);
  });

  it('a deleted variant does not make its product ACTIVE nor match q', async () => {
    await seedVariant(idOf('e', 5), P2, {
      name: 'Fantome',
      createdAt: '2026-02-02T00:00:05Z',
      deletedAt: REG,
    });

    expect(bodyOf<Page>(await list('?status=ACTIVE')).items.map((i) => i.id)).toEqual([P1]);
    expect(bodyOf<Page>(await list('?q=fantome')).items).toHaveLength(0);
  });

  it('q treats LIKE wildcards as plain characters', async () => {
    expect(bodyOf<Page>(await list('?q=%25')).items).toHaveLength(0);
    expect(bodyOf<Page>(await list('?q=_')).items).toHaveLength(0);
  });

  it('AC-3 3 products, limit 2: pages of 2 and 1, no repeat', async () => {
    await seedProduct(P3, { name: 'Soda', createdAt: '2026-02-03T00:00:00Z' });
    await seedVariant(idOf('e', 6), P3, { createdAt: '2026-02-03T00:00:01Z' });

    const first = bodyOf<Page>(await list('?limit=2'));
    expect(first.items.map((i) => i.id)).toEqual([P3, P2]);
    expect(first.next_cursor).not.toBeNull();
    expect(first.items[1].variants).toHaveLength(1);

    const second = bodyOf<Page>(
      await list(`?limit=2&cursor=${encodeURIComponent(first.next_cursor!)}`)
    );
    expect(second.items.map((i) => i.id)).toEqual([P1]);
    expect(second.items[0].variants).toHaveLength(2);
    expect(second.next_cursor).toBeNull();
  });

  it('AC-4 a DRIVER gets 403, an OWNER may list', async () => {
    const refused = await list('', ORG_A, DRIVER);

    expect(refused.status).toBe(403);
    expect(bodyOf<ErrorBody>(refused).error.code).toBe('FORBIDDEN');
    expect((await list('', ORG_A, OWNER)).status).toBe(200);
  });

  it('AB-1 a member of A lists the products of B: 404, nothing returned', async () => {
    await seedProduct(idOf('d', 9), {
      name: 'Huile',
      organizationId: ORG_B,
      createdAt: '2026-02-05T00:00:00Z',
    });
    const response = await list('', ORG_B, SELLER);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('Huile');
  });

  it("a variant of another business never shows under A's product", async () => {
    await seedProduct(idOf('d', 8), {
      name: 'Huile',
      organizationId: ORG_B,
      createdAt: '2026-02-05T00:00:00Z',
    });
    await seedVariant(idOf('e', 8), idOf('d', 8), {
      name: 'Rouge',
      organizationId: ORG_B,
      createdAt: '2026-02-05T00:00:01Z',
    });

    const body = bodyOf<Page>(await list('?q=rouge'));

    expect(body.items.map((i) => i.id)).toEqual([P1]);
  });
});
