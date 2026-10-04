import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import * as repository from '../../../src/modules/catalog/catalog.repository.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

vi.mock('../../../src/modules/catalog/catalog.repository.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/modules/catalog/catalog.repository.js')>();
  return { ...actual, upsertCustomerPrice: vi.fn(actual.upsertCustomerPrice) };
});

const id = (n: string) => `0199c0c8-0000-7000-8000-0000000000${n}`;

const OWNER = id('01');
const MANAGER = id('02');
const SELLER = id('03');
const CUSTOMER_A = id('05');
const CUSTOMER_B = id('06');
const CUSTOMER_C = id('07');
const OTHER_OWNER = id('08');

const SUPPLIER_ORG = id('a1');
const OTHER_ORG = id('a3');

const RICE = id('b1');
const OIL = id('b2');
const SOAP = id('b3');
const FOREIGN_PRODUCT = id('b4');

const SOURCE = id('d1');
const TARGET = id('d2');
const OWN = id('d4');
const FOREIGN = id('d6');
const ENDED = id('d8');

const G1 = id('f1');
const G2 = id('f2');

const REG = new Date('2026-01-01T00:00:00.000Z');
const PAST = new Date('2026-02-01T08:00:00.000Z');

async function seedPerson(personId: string, phone: string) {
  await prisma.person.create({
    data: {
      id: personId,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
}

async function seedMember(
  n: string,
  orgId: string,
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER'
) {
  await prisma.collaboration.create({
    data: { id: id(n), personId, organizationId: orgId, role, status: 'ACTIVE', acceptedAt: REG },
  });
}

async function seedRelationship(
  relId: string,
  personId: string,
  status: 'ACTIVE' | 'ENDED' = 'ACTIVE',
  supplierOrganizationId = SUPPLIER_ORG
) {
  await prisma.customerRelationship.create({
    data: {
      id: relId,
      supplierOrganizationId,
      customerPersonId: personId,
      status,
      ...(status === 'ENDED' ? { endedByParty: 'SUPPLIER' as const } : {}),
      createdById: OWNER,
    },
  });
}

async function seedPrice(n: string, relationshipId: string, productId: string, price: bigint) {
  await prisma.customerPrice.create({
    data: {
      id: id(n),
      customerRelationshipId: relationshipId,
      productId,
      price,
      setById: OWNER,
      setAt: PAST,
    },
  });
}

function copy(targetId: string, body: object, caller = MANAGER, organizationId = SUPPLIER_ORG) {
  return createAuthenticatedRequest(app, caller)
    .post(`/api/v1/organizations/${organizationId}/customers/${targetId}/prices/copy`)
    .send(body);
}

const live = async (relationshipId: string) =>
  (
    await prisma.customerPrice.findMany({
      where: { customerRelationshipId: relationshipId, deletedAt: null },
      orderBy: { productId: 'asc' },
    })
  ).map((row) => ({ productId: row.productId, price: row.price, setById: row.setById }));

const allRows = () => prisma.customerPrice.count();

beforeEach(async () => {
  vi.mocked(repository.upsertCustomerPrice).mockClear();
  await seedPerson(OWNER, '+237600009501');
  await seedPerson(MANAGER, '+237600009502');
  await seedPerson(SELLER, '+237600009503');
  await seedPerson(CUSTOMER_A, '+237600009505');
  await seedPerson(CUSTOMER_B, '+237600009506');
  await seedPerson(CUSTOMER_C, '+237600009507');
  await seedPerson(OTHER_OWNER, '+237600009508');

  await prisma.organization.create({ data: { id: SUPPLIER_ORG, name: 'Supplier' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other' } });
  await seedMember('c1', SUPPLIER_ORG, OWNER, 'OWNER');
  await seedMember('c2', SUPPLIER_ORG, MANAGER, 'MANAGER');
  await seedMember('c3', SUPPLIER_ORG, SELLER, 'SELLER');
  await seedMember('c5', OTHER_ORG, OTHER_OWNER, 'OWNER');

  for (const [pid, name, price] of [
    [RICE, 'Riz', 3000n],
    [OIL, 'Huile', 1500n],
    [SOAP, 'Savon', 500n],
  ] as const) {
    await prisma.product.create({
      data: { id: pid, organizationId: SUPPLIER_ORG, name, unit: 'u', price },
    });
  }

  await seedRelationship(SOURCE, CUSTOMER_A);
  await seedRelationship(TARGET, CUSTOMER_B);
  await seedRelationship(OWN, MANAGER);
  await seedRelationship(FOREIGN, CUSTOMER_A, 'ACTIVE', OTHER_ORG);
  await seedRelationship(ENDED, CUSTOMER_C, 'ENDED');
});

async function seedSourcePrices() {
  await seedPrice('e1', SOURCE, RICE, 2800n);
  await seedPrice('e2', SOURCE, OIL, 1400n);
  await seedPrice('e3', SOURCE, SOAP, 450n);
  await seedPrice('e4', TARGET, RICE, 2900n);
}

describe('POST /api/v1/organizations/:organizationId/customers/:relationshipId/prices/copy', () => {
  it('AC-1, C-11, C-04 copies 3 prices, replaces the existing one, leaves the source unchanged', async () => {
    await seedSourcePrices();
    const sourceBefore = await live(SOURCE);

    const response = await copy(TARGET, { id: G1, from_relationship_id: SOURCE });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ copied: 3 });
    expect(await live(TARGET)).toEqual(
      [
        { productId: RICE, price: 2800n, setById: MANAGER },
        { productId: OIL, price: 1400n, setById: MANAGER },
        { productId: SOAP, price: 450n, setById: MANAGER },
      ].sort((a, b) => a.productId.localeCompare(b.productId))
    );
    expect(await live(SOURCE)).toEqual(sourceBefore);
    expect(await prisma.customerPrice.count({ where: { customerRelationshipId: TARGET } })).toBe(3);
  });

  it('an OWNER copies, and deleted source prices are left out', async () => {
    await seedPrice('e1', SOURCE, RICE, 2800n);
    await seedPrice('e2', SOURCE, OIL, 1400n);
    await prisma.customerPrice.update({ where: { id: id('e2') }, data: { deletedAt: PAST } });

    const response = await copy(TARGET, { id: G1, from_relationship_id: SOURCE }, OWNER);

    expect(response.body).toEqual({ copied: 1 });
    expect((await live(TARGET)).map((row) => row.productId)).toEqual([RICE]);
  });

  it('copies from and to ENDED relationships, and an empty source copies 0', async () => {
    await seedPrice('e1', ENDED, RICE, 2800n);

    const first = await copy(TARGET, { id: G1, from_relationship_id: ENDED });
    const second = await copy(ENDED, { id: G2, from_relationship_id: TARGET });
    const third = await copy(TARGET, { id: id('f3'), from_relationship_id: SOURCE });

    expect([first.body, second.body, third.body]).toEqual([
      { copied: 1 },
      { copied: 1 },
      { copied: 0 },
    ]);
  });

  describe('AC-2 refusals', () => {
    it('the same relationship as source and target answers 400', async () => {
      await seedSourcePrices();

      const response = await copy(SOURCE, { id: G1, from_relationship_id: SOURCE });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await allRows()).toBe(4);
    });

    it('a SELLER caller answers 403', async () => {
      await seedSourcePrices();

      const response = await copy(TARGET, { id: G1, from_relationship_id: SOURCE }, SELLER);

      expect(response.status).toBe(403);
      expect(await live(TARGET)).toHaveLength(1);
    });

    it('a target that is the manager own record answers 403 OWN_RECORD', async () => {
      await seedSourcePrices();

      const response = await copy(OWN, { id: G1, from_relationship_id: SOURCE });

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OWN_RECORD');
      expect(await live(OWN)).toEqual([]);
    });

    it('an unknown source or target answers 404', async () => {
      const unknown = id('d9');

      const source = await copy(TARGET, { id: G1, from_relationship_id: unknown });
      const target = await copy(unknown, { id: G2, from_relationship_id: SOURCE });

      expect([source.status, target.status]).toEqual([404, 404]);
    });

    it('an unknown field, a bad id or a missing field answers 400 and does not reserve the id', async () => {
      const extra = await copy(TARGET, { id: G1, from_relationship_id: SOURCE, price: 1 });
      const bad = await copy(TARGET, { id: G1, from_relationship_id: 'nope' });
      const missing = await copy(TARGET, { id: G1 });
      const ok = await copy(TARGET, { id: G1, from_relationship_id: SOURCE });

      expect([extra.status, bad.status, missing.status, ok.status]).toEqual([400, 400, 400, 200]);
    });

    it('a malformed path id answers 400', async () => {
      const response = await createAuthenticatedRequest(app, MANAGER)
        .post(`/api/v1/organizations/${SUPPLIER_ORG}/customers/not-a-uuid/prices/copy`)
        .send({ id: G1, from_relationship_id: SOURCE });

      expect(response.status).toBe(400);
    });

    it('no token answers 401', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${SUPPLIER_ORG}/customers/${TARGET}/prices/copy`)
        .send({ id: G1, from_relationship_id: SOURCE });

      expect(response.status).toBe(401);
    });
  });

  describe('AC-3 atomic and repeatable', () => {
    it('one failing row rolls everything back', async () => {
      await seedSourcePrices();
      const before = await live(TARGET);
      vi.mocked(repository.upsertCustomerPrice)
        .mockImplementationOnce(async (tx, data) => {
          const actual = await vi.importActual<typeof repository>(
            '../../../src/modules/catalog/catalog.repository.js'
          );
          return actual.upsertCustomerPrice(tx, data);
        })
        .mockRejectedValueOnce(new Error('boom'));

      const response = await copy(TARGET, { id: G1, from_relationship_id: SOURCE });

      expect(response.status).toBe(500);
      expect(await live(TARGET)).toEqual(before);
      expect(await allRows()).toBe(4);
    });

    it('the same id sent twice answers the same and changes nothing the second time', async () => {
      await seedSourcePrices();

      const first = await copy(TARGET, { id: G1, from_relationship_id: SOURCE });
      await prisma.customerPrice.updateMany({
        where: { customerRelationshipId: SOURCE },
        data: { price: 1n },
      });
      const second = await copy(TARGET, { id: G1, from_relationship_id: SOURCE });

      expect(second.status).toBe(first.status);
      expect(second.body).toEqual(first.body);
      expect((await live(TARGET)).map((row) => Number(row.price)).sort((a, b) => a - b)).toEqual([
        450, 1400, 2800,
      ]);
    });
  });

  describe('security', () => {
    it('AB-1 a source of another business answers 404 and copies nothing', async () => {
      await prisma.product.create({
        data: {
          id: FOREIGN_PRODUCT,
          organizationId: OTHER_ORG,
          name: 'Autre',
          unit: 'u',
          price: 9n,
        },
      });
      await seedPrice('e1', FOREIGN, FOREIGN_PRODUCT, 1n);

      const response = await copy(TARGET, { id: G1, from_relationship_id: FOREIGN });

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await live(TARGET)).toEqual([]);
    });

    it('AB-1 a target of another business answers 404 and the caller business is untouched', async () => {
      await seedSourcePrices();

      const response = await copy(FOREIGN, { id: G1, from_relationship_id: SOURCE });

      expect(response.status).toBe(404);
      expect(await live(FOREIGN)).toEqual([]);
    });

    it('AB-1 a manager of another business cannot copy through this business path', async () => {
      await seedSourcePrices();

      const response = await copy(TARGET, { id: G1, from_relationship_id: SOURCE }, OTHER_OWNER);

      expect(response.status).toBeGreaterThanOrEqual(403);
      expect(response.status).toBeLessThanOrEqual(404);
      expect(await live(TARGET)).toHaveLength(1);
    });
  });
});
