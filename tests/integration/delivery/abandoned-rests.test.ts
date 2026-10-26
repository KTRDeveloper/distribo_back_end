import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f7-0000-7000-8000-000000000001';
const PAUL = '0199c0f7-0000-7000-8000-000000000002';
const JEAN = '0199c0f7-0000-7000-8000-000000000003';
const CUSTOMER = '0199c0f7-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0f7-0000-7000-8000-000000000005';

const ORG = '0199c0f7-0000-7000-8000-0000000000c1';
const OTHER_ORG = '0199c0f7-0000-7000-8000-0000000000c2';
const REL = '0199c0f7-0000-7000-8000-0000000000d1';
const OTHER_REL = '0199c0f7-0000-7000-8000-0000000000d2';
const PRODUCT = '0199c0f7-0000-7000-8000-0000000000e1';
const OTHER_PRODUCT = '0199c0f7-0000-7000-8000-0000000000e2';

const REG = new Date('2026-01-01T00:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

type Bucket = { count: number; amount: number };
type Item = { person_id: string; abandoned_rests: Bucket; refunds: Bucket; price_gaps: Bucket };

let counter = 0;
/** A fresh UUIDv7-shaped id per call, so fixtures never collide. */
function nextId(): string {
  counter += 1;
  return `0199c0f7-0000-7000-8000-${String(counter).padStart(12, '1')}`;
}

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

async function seedMember(orgId: string, personId: string, role: 'OWNER' | 'DRIVER') {
  await prisma.collaboration.create({
    data: {
      id: nextId(),
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

type Seeded = {
  /** Lines as `[ordered, delivered]` quantities; one line when omitted: 10 ordered, 8 delivered. */
  lines?: [string, string][];
  price?: bigint;
  by?: string;
  at?: Date;
  rel?: string;
  parent?: string;
  deleted?: boolean;
};

/** Stores a DELIVERED order whose lines were partly delivered; the total follows the delivered quantities. */
async function deliveredOrder(options: Seeded = {}): Promise<string> {
  const id = nextId();
  const price = options.price ?? 3000n;
  const lines = options.lines ?? [['10', '8']];
  const amounts = lines.map(
    ([, delivered]) => (BigInt(Math.round(Number(delivered) * 1000)) * price + 500n) / 1000n
  );
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: options.rel ?? REL,
      enteredById: OWNER,
      placedByParty: 'SUPPLIER',
      status: 'DELIVERED',
      deliveredAt: options.at ?? daysAgo(1),
      deliveredById: options.by ?? PAUL,
      parentOrderId: options.parent,
      deletedAt: options.deleted ? new Date() : null,
      totalAmount: amounts.reduce((sum, amount) => sum + amount, 0n),
      lines: {
        create: lines.map(([quantity, delivered], index) => ({
          id: nextId(),
          productVariantId: (options.rel ?? REL) === OTHER_REL ? OTHER_PRODUCT : PRODUCT,
          labelApplied: 'Fixture Rice',
          quantity,
          deliveredQuantity: delivered,
          referencePrice: price,
          unitPriceApplied: price,
          amount: amounts[index] ?? 0n,
        })),
      },
    },
  });
  return id;
}

/** Stores the CONFIRMED order that carries a rest "later". */
async function childOrder(parentId: string) {
  await prisma.order.create({
    data: {
      id: nextId(),
      customerRelationshipId: REL,
      enteredById: OWNER,
      placedByParty: 'SUPPLIER',
      status: 'CONFIRMED',
      parentOrderId: parentId,
      totalAmount: 6000n,
      lines: {
        create: {
          id: nextId(),
          productVariantId: PRODUCT,
          labelApplied: 'Fixture Rice',
          quantity: '2',
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: 6000n,
        },
      },
    },
  });
}

async function readItems(personId = OWNER, query = ''): Promise<Item[]> {
  const response = await createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${ORG}/exceptions/money${query}`
  );
  expect(response.status).toBe(200);
  return bodyOf<{ items: Item[] }>(response).items;
}

/** One business (owner, driver Paul, driver Jean) with a registered customer; another business apart. */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600091001');
  await seedPerson(PAUL, '+237600091002');
  await seedPerson(JEAN, '+237600091003');
  await seedPerson(CUSTOMER, '+237600091004');
  await seedPerson(OTHER_OWNER, '+237600091005');
  await prisma.organization.create({ data: { id: ORG, name: 'Business', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(ORG, OWNER, 'OWNER');
  await seedMember(ORG, PAUL, 'DRIVER');
  await seedMember(ORG, JEAN, 'DRIVER');
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER');
  for (const [id, organizationId, creator] of [
    [REL, ORG, OWNER],
    [OTHER_REL, OTHER_ORG, OTHER_OWNER],
  ] as const) {
    await prisma.customerRelationship.create({
      data: {
        id,
        supplierOrganizationId: organizationId,
        customerPersonId: CUSTOMER,
        createdById: creator,
        status: 'ACTIVE',
      },
    });
  }
  await seedProduct(prisma, {
    id: PRODUCT,
    organizationId: ORG,
    name: 'Fixture Rice',
    unit: 'sack',
    price: 3000n,
  });
  await seedProduct(prisma, {
    id: OTHER_PRODUCT,
    organizationId: OTHER_ORG,
    name: 'Fixture Rice',
    unit: 'sack',
    price: 3000n,
  });
});

describe('DLV-012 abandoned rests join the owner money exceptions', () => {
  it('counts 2 sacks left at 3000 as one rest worth 6000 (AC-1, CM-22)', async () => {
    await deliveredOrder();

    const items = await readItems();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      person_id: PAUL,
      abandoned_rests: { count: 1, amount: 6000 },
      refunds: { count: 0, amount: 0 },
      price_gaps: { count: 0, amount: 0 },
    });
  });

  it('does not count a rest that became a child order (AC-2)', async () => {
    const parent = await deliveredOrder();
    await childOrder(parent);

    expect(await readItems()).toEqual([]);
  });

  it('does not count a fully delivered line (AC-1)', async () => {
    await deliveredOrder({ lines: [['10', '10']] });

    expect(await readItems()).toEqual([]);
  });

  it('leaves out the owner own rests and those delivered outside the period (AC-3)', async () => {
    await deliveredOrder({ by: OWNER });
    await deliveredOrder({ at: daysAgo(20) });

    expect(await readItems()).toEqual([]);

    const day = (date: Date) => date.toISOString().slice(0, 10);
    const items = await readItems(OWNER, `?from=${day(daysAgo(22))}&to=${day(daysAgo(18))}`);
    expect(items).toHaveLength(1);
    expect(items[0]?.abandoned_rests).toEqual({ count: 1, amount: 6000 });
  });

  it('lists a person whose only exception is an abandoned rest, ranked with the others (AC-1)', async () => {
    await deliveredOrder({ by: PAUL });
    await deliveredOrder({ by: JEAN, lines: [['10', '1']] });

    const items = await readItems();

    expect(items.map((item) => item.person_id)).toEqual([JEAN, PAUL]);
    expect(items[0]?.abandoned_rests).toEqual({ count: 1, amount: 27000 });
  });

  it('shows repeated abandons under the driver name with their value (AB-1, CWE-778)', async () => {
    await deliveredOrder();
    await deliveredOrder({ lines: [['5', '4.5']], price: 1001n });
    await deliveredOrder({
      lines: [
        ['10', '8'],
        ['3', '1'],
      ],
    });

    const items = await readItems();

    // 6000 + round(0.5 x 1001) = 501 (half up) + 6000 + 6000 for two lines of one order.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      person_id: PAUL,
      abandoned_rests: { count: 4, amount: 6000 + 501 + 6000 + 6000 },
    });
  });

  it('ignores another business and deleted orders (AC-3)', async () => {
    await deliveredOrder({ rel: OTHER_REL });
    await deliveredOrder({ deleted: true });

    expect(await readItems()).toEqual([]);
  });
});
