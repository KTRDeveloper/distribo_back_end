import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { seedProduct } from '../../helpers/catalog-fixtures';
import { prisma } from '../../setup.js';

const idOf = (n: number) => `0199e021-0000-7000-8000-${String(n).padStart(12, '0')}`;
const OWNER = idOf(1);
const MANAGER = idOf(2);
const JEAN = idOf(3);
const PAUL = idOf(4);
const CUSTOMER = idOf(5);
const OWNER_B = idOf(6);
const SELLER_B = idOf(7);
const ORG_A = idOf(0xa1);
const ORG_B = idOf(0xb1);
const REL_A = idOf(0xc1);
const REL_B = idOf(0xc2);
const PRODUCT_A = idOf(0xd1);
const PRODUCT_B = idOf(0xd2);
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type Item = { code: string; count: number; amount: number; persons: string[] };
type Body = { items: Item[] };

const WEEK = 'from=2026-03-01&to=2026-03-07';
const read = (personId: string, org = ORG_A, query = WEEK) =>
  createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${org}/exceptions/sync?${query}`
  );
const byCode = (body: Body, code: string) => body.items.find((item) => item.code === code);
const day = (iso: string) => new Date(`${iso}T10:00:00.000Z`);

async function seedPerson(id: string, phone: string, name: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: name,
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${name.toLowerCase().replace(/\W/g, '')}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
}

async function seedCollaboration(
  n: number,
  personId: string,
  org: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER'
) {
  await prisma.collaboration.create({
    data: {
      id: idOf(0x100 + n),
      personId,
      organizationId: org,
      role,
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

const lineAmount = (quantity: string, applied: bigint) =>
  BigInt(Math.round(Number(quantity) * Number(applied)));

/** An order with its flag; `lines` are [quantity, referencePrice, unitPriceApplied] on the product. */
async function seedOrder(
  id: number,
  relationshipId: string,
  enteredById: string,
  syncIssue: string | null,
  createdAt: Date,
  options: {
    productId?: string;
    lines?: Array<[string, bigint, bigint]>;
    deliveredById?: string;
  } = {}
) {
  await prisma.order.create({
    data: {
      id: idOf(id),
      customerRelationshipId: relationshipId,
      placedByParty: 'SUPPLIER',
      enteredById,
      deliveredById: options.deliveredById ?? null,
      status: options.deliveredById ? 'DELIVERED' : 'CONFIRMED',
      deliveredAt: options.deliveredById ? createdAt : null,
      totalAmount: (options.lines ?? []).reduce((sum, [q, , a]) => sum + lineAmount(q, a), 0n),
      syncIssue,
      createdAt,
      lines: {
        create: (options.lines ?? []).map(([quantity, referencePrice, applied], index) => ({
          id: idOf(id * 100 + index),
          productVariantId: options.productId ?? PRODUCT_A,
          labelApplied: 'Riz (sac)',
          quantity,
          referencePrice,
          unitPriceApplied: applied,
          amount: lineAmount(quantity, applied),
          ...(referencePrice === applied
            ? {}
            : { priceSetById: enteredById, priceSetAt: createdAt }),
        })),
      },
    },
  });
}

describe('GET /api/v1/organizations/{organizationId}/exceptions/sync', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600002101', 'Owner A');
    await seedPerson(MANAGER, '+237600002102', 'Manager A');
    await seedPerson(JEAN, '+237600002103', 'Jean');
    await seedPerson(PAUL, '+237600002104', 'Paul');
    await seedPerson(CUSTOMER, '+237600002105', 'Customer');
    await seedPerson(OWNER_B, '+237600002106', 'Owner B');
    await seedPerson(SELLER_B, '+237600002107', 'Seller B');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedCollaboration(1, OWNER, ORG_A, 'OWNER');
    await seedCollaboration(2, MANAGER, ORG_A, 'MANAGER');
    await seedCollaboration(3, JEAN, ORG_A, 'SELLER');
    await seedCollaboration(4, PAUL, ORG_A, 'SELLER');
    await seedCollaboration(5, OWNER_B, ORG_B, 'OWNER');
    await seedCollaboration(6, SELLER_B, ORG_B, 'SELLER');

    // The current price is 1000; lines sold at 900 are the old-price lines.
    await seedProduct(prisma, {
      id: PRODUCT_A,
      organizationId: ORG_A,
      name: 'Riz',
      unit: 'sac',
      price: 1000n,
    });
    await seedProduct(prisma, {
      id: PRODUCT_B,
      organizationId: ORG_B,
      name: 'Mil',
      unit: 'sac',
      price: 1000n,
    });
    for (const [id, org, label] of [
      [REL_A, ORG_A, 'Chez Mama'],
      [REL_B, ORG_B, 'Client B'],
    ]) {
      await prisma.customerRelationship.create({
        data: {
          id,
          createdById: org === ORG_A ? OWNER : OWNER_B,
          createdAt: LONG_AGO,
          supplierOrganizationId: org,
          customerPersonId: CUSTOMER,
          customerLabel: label,
          creditLimit: 50000n,
          balance: 0n,
        },
      });
    }
  });

  /** One order of 7 lines (2 sacks each) sold at 900 against 1000, and one credit overrun of 15 000. */
  async function seedWeek() {
    await seedOrder(
      0x201,
      REL_A,
      JEAN,
      'PRICE_CHANGED: vendu 900 ; prix passé à 1 000 lundi à 8 h',
      day('2026-03-03'),
      { lines: Array.from({ length: 7 }, () => ['2', 900n, 900n] as [string, bigint, bigint]) }
    );
    await seedOrder(
      0x202,
      REL_A,
      PAUL,
      'CREDIT_EXCEEDED: Chez Mama : plafond dépassé de 15 000',
      day('2026-03-04'),
      { deliveredById: JEAN }
    );
  }

  it('grouped: two items, one per cause, with their amounts (AC-1)', async () => {
    await seedWeek();

    const res = await read(OWNER);

    expect(res.status).toBe(200);
    const body = bodyOf<Body>(res);
    expect(body.items).toHaveLength(2);
    expect(byCode(body, 'PRICE_CHANGED')).toEqual({
      code: 'PRICE_CHANGED',
      count: 1,
      amount: 1400,
      persons: [JEAN],
    });
    expect(byCode(body, 'CREDIT_EXCEEDED')).toEqual({
      code: 'CREDIT_EXCEEDED',
      count: 1,
      amount: 15000,
      persons: [JEAN],
    });
  });

  it('several causes on one order count once each; other codes have amount 0', async () => {
    await seedOrder(
      0x203,
      REL_A,
      JEAN,
      'PRICE_CHANGED: vendu 900 ; prix passé à 1 000 lundi à 8 h ; CREDIT_EXCEEDED: Chez Mama : plafond dépassé de 2 500 ; RESTRICTED_MODE: opération faite après 3 jours sans synchronisation',
      day('2026-03-05'),
      { lines: [['1.5', 900n, 900n]] }
    );
    await seedOrder(0x204, REL_A, PAUL, 'RESTRICTED_MODE: opération', day('2026-03-05'));

    const body = bodyOf<Body>(await read(OWNER));

    expect(byCode(body, 'PRICE_CHANGED')).toMatchObject({ count: 1, amount: 150 });
    expect(byCode(body, 'CREDIT_EXCEEDED')).toMatchObject({ count: 1, amount: 2500 });
    expect(byCode(body, 'RESTRICTED_MODE')).toEqual({
      code: 'RESTRICTED_MODE',
      count: 2,
      amount: 0,
      persons: [JEAN, PAUL].sort(),
    });
  });

  it('a line sold above the current price adds nothing to the amount', async () => {
    await seedOrder(0x205, REL_A, JEAN, 'PRICE_CHANGED: vendu', day('2026-03-05'), {
      lines: [
        ['2', 900n, 900n],
        ['10', 1200n, 1100n],
        ['3', 800n, 1500n],
      ],
    });

    const body = bodyOf<Body>(await read(OWNER));

    expect(byCode(body, 'PRICE_CHANGED')).toMatchObject({ count: 1, amount: 200 });
  });

  it('validation and roles: a MANAGER caller gets 403 (AC-2)', async () => {
    const res = await read(MANAGER);

    expect(res.status).toBe(403);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('FORBIDDEN');
    expect((await read(JEAN)).status).toBe(403);
  });

  it('validation and roles: a period of 93 days gets 400 (AC-2)', async () => {
    const res = await read(OWNER, ORG_A, 'from=2026-01-01&to=2026-04-04');

    expect(res.status).toBe(400);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
    expect((await read(OWNER, ORG_A, 'from=2026-01-01&to=2026-04-03')).status).toBe(200);
    expect((await read(OWNER, ORG_A, 'from=2026-03-09&to=2026-03-01')).status).toBe(400);
    expect((await read(OWNER, ORG_A, 'from=2026-03-01&extra=1')).status).toBe(400);
  });

  it('period: issues outside the period are not counted (AC-3)', async () => {
    await seedWeek();
    await seedOrder(
      0x206,
      REL_A,
      JEAN,
      'CREDIT_EXCEEDED: Chez Mama : plafond dépassé de 9 000',
      day('2026-02-20')
    );
    await seedOrder(
      0x207,
      REL_A,
      JEAN,
      'CREDIT_EXCEEDED: Chez Mama : plafond dépassé de 7 000',
      day('2026-03-08')
    );
    // The last day of the period is counted whole.
    await seedOrder(
      0x208,
      REL_A,
      JEAN,
      'CREDIT_EXCEEDED: Chez Mama : plafond dépassé de 100',
      day('2026-03-07')
    );

    const body = bodyOf<Body>(await read(OWNER));

    expect(byCode(body, 'CREDIT_EXCEEDED')).toMatchObject({ count: 2, amount: 15100 });
  });

  it('corrected or unflagged orders are not counted', async () => {
    await seedWeek();
    await seedOrder(0x209, REL_A, JEAN, null, day('2026-03-04'));
    await seedOrder(0x20a, REL_A, JEAN, '', day('2026-03-04'));

    const body = bodyOf<Body>(await read(OWNER));

    expect(body.items.map((item) => item.code).sort()).toEqual([
      'CREDIT_EXCEEDED',
      'PRICE_CHANGED',
    ]);
  });

  it('other business: a member of A reading B gets 404, and B is never counted (AB-1, WSTG-ATHZ-04)', async () => {
    await seedWeek();
    await seedOrder(
      0x301,
      REL_B,
      SELLER_B,
      'CREDIT_EXCEEDED: Client B : plafond dépassé de 80 000',
      day('2026-03-04')
    );

    const res = await read(OWNER, ORG_B);

    expect(res.status).toBe(404);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
    expect(byCode(bodyOf<Body>(await read(OWNER)), 'CREDIT_EXCEEDED')).toMatchObject({
      amount: 15000,
    });
    expect(bodyOf<Body>(await read(OWNER_B, ORG_B, WEEK)).items).toEqual([
      { code: 'CREDIT_EXCEEDED', count: 1, amount: 80000, persons: [SELLER_B] },
    ]);
  });

  it('an unauthenticated call gets 401', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app).get(`/api/v1/organizations/${ORG_A}/exceptions/sync`);

    expect(res.status).toBe(401);
  });
});
