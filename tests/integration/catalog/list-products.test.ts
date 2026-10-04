import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0b5-0000-7000-8000-000000000001';
const SELLER = '0199c0b5-0000-7000-8000-000000000003';
const DRIVER = '0199c0b5-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0b5-0000-7000-8000-000000000005';

const ORG_A = '0199c0b5-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0b5-0000-7000-8000-0000000000b1';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Item = {
  id: string;
  name: string;
  status: string;
  category: string | null;
};
type Page = { items: Item[]; next_cursor: string | null };

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
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
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

const idOf = (n: number) => `0199c0b5-0000-7000-8000-0000000000d${n}`;

async function seedProduct(
  n: number,
  data: {
    name: string;
    category?: string;
    status?: 'ACTIVE' | 'INACTIVE';
    organizationId?: string;
    createdAt: string;
    deletedAt?: Date;
  }
) {
  await prisma.product.create({
    data: {
      id: idOf(n),
      organizationId: data.organizationId ?? ORG_A,
      name: data.name,
      unit: 'sac',
      price: 1000n,
      category: data.category ?? null,
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
  await seedPerson(OWNER, '+237600009201');
  await seedPerson(SELLER, '+237600009203');
  await seedPerson(DRIVER, '+237600009204');
  await seedPerson(OTHER_OWNER, '+237600009205');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A' } });
  await seedMember(ORG_A, OWNER, 'OWNER', 9);
  await seedMember(ORG_A, SELLER, 'SELLER', 2);
  await seedMember(ORG_A, DRIVER, 'DRIVER', 3);
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B' } });
  await seedMember(ORG_B, OTHER_OWNER, 'OWNER', 9);

  // Oldest first by number: Riz (1) is the oldest, Soda (4) the newest.
  await seedProduct(1, { name: 'Riz', category: 'Céréales', createdAt: '2026-02-01T00:00:00Z' });
  await seedProduct(2, { name: 'Eau', category: 'Boissons', createdAt: '2026-02-02T00:00:00Z' });
  await seedProduct(3, {
    name: 'Jus',
    category: 'Boissons',
    status: 'INACTIVE',
    createdAt: '2026-02-03T00:00:00Z',
  });
  await seedProduct(4, { name: 'Soda', createdAt: '2026-02-04T00:00:00Z' });
  await seedProduct(5, {
    name: 'Huile',
    organizationId: ORG_B,
    category: 'Boissons',
    createdAt: '2026-02-05T00:00:00Z',
  });
});

describe('GET /api/v1/organizations/:organizationId/products', () => {
  it('AC-1 list: 4 items newest first, closed product view', async () => {
    const response = await list();

    expect(response.status).toBe(200);
    const body = bodyOf<Page>(response);
    expect(body.items.map((i) => i.id)).toEqual([idOf(4), idOf(3), idOf(2), idOf(1)]);
    expect(body.next_cursor).toBeNull();
    expect(Object.keys(body.items[0]).sort()).toEqual(
      [
        'category',
        'created_at',
        'description',
        'id',
        'min_order_quantity',
        'name',
        'price',
        'price_updated_at',
        'status',
        'unit',
      ].sort()
    );
  });

  it('a soft-deleted product is not listed', async () => {
    await seedProduct(6, { name: 'Vieux', createdAt: '2026-02-06T00:00:00Z', deletedAt: REG });

    const body = bodyOf<Page>(await list());

    expect(body.items).toHaveLength(4);
    expect(body.items.map((i) => i.id)).not.toContain(idOf(6));
  });

  it.each([
    ['status=ACTIVE', 3],
    ['status=INACTIVE', 1],
    ['q=riz', 1],
    ['category=Boissons', 2],
  ])('AC-2 filter %s gives %i items', async (query, count) => {
    const response = await list(`?${query}`);

    expect(response.status).toBe(200);
    expect(bodyOf<Page>(response).items).toHaveLength(count);
  });

  it('AC-2 q matches inside the name, whatever the case', async () => {
    const body = bodyOf<Page>(await list('?q=ODA'));

    expect(body.items.map((i) => i.name)).toEqual(['Soda']);
  });

  it('AC-2 filters combine', async () => {
    const body = bodyOf<Page>(await list('?category=Boissons&status=ACTIVE'));

    expect(body.items.map((i) => i.id)).toEqual([idOf(2)]);
  });

  it('AC-3 paging: 2 and 2 items, no overlap', async () => {
    const first = bodyOf<Page>(await list('?limit=2'));
    expect(first.items.map((i) => i.id)).toEqual([idOf(4), idOf(3)]);
    expect(first.next_cursor).not.toBeNull();

    const second = bodyOf<Page>(
      await list(`?limit=2&cursor=${encodeURIComponent(first.next_cursor!)}`)
    );
    expect(second.items.map((i) => i.id)).toEqual([idOf(2), idOf(1)]);
    expect(second.next_cursor).toBeNull();
  });

  it('AC-4 a DRIVER gets 403', async () => {
    const response = await list('', ORG_A, DRIVER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('an OWNER may list', async () => {
    expect((await list('', ORG_A, OWNER)).status).toBe(200);
  });

  it('unauthenticated request gets 401', async () => {
    const response = await request(app).get(`/api/v1/organizations/${ORG_A}/products`);

    expect(response.status).toBe(401);
  });

  it.each([
    'status=DELETED',
    'limit=0',
    'limit=101',
    `q=${'a'.repeat(101)}`,
    'unknown=1',
    'cursor=@@',
  ])('invalid query %s gets 400', async (query) => {
    const response = await list(`?${query}`);

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('AB-1 a member of A lists the products of B: 404, no leak', async () => {
    const response = await list('', ORG_B, SELLER);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('Huile');
  });

  it('AB-2 injection through q: 200, no item, table intact', async () => {
    const response = await list(`?q=${encodeURIComponent("'; DROP TABLE products; --")}`);

    expect(response.status).toBe(200);
    expect(bodyOf<Page>(response).items).toHaveLength(0);
    expect(await prisma.product.count()).toBe(5);
  });

  it('q treats LIKE wildcards as plain characters', async () => {
    expect(bodyOf<Page>(await list('?q=%25')).items).toHaveLength(0);
    expect(bodyOf<Page>(await list('?q=_')).items).toHaveLength(0);
  });
});
