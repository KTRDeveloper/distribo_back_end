import { beforeEach, describe, expect, it } from 'vitest';
import { runControls } from '../../../src/modules/sync/sync.controls.js';
import { findFlaggedOrders } from '../../../src/modules/sync/sync.repository.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c028-1000-7000-8000-000000000001';
const ORG = '0199c028-1000-7000-8000-000000000002';
const OTHER_ORG = '0199c028-1000-7000-8000-000000000003';
const REL = '0199c028-1000-7000-8000-000000000004';
const PRODUCT = '0199c028-1000-7000-8000-000000000005';
const BIG = '0199c028-1000-7000-8000-000000000006';
const SMALL = '0199c028-1000-7000-8000-000000000007';
const ORDER = '0199c028-1000-7000-8000-000000000008';
const LINE = '0199c028-1000-7000-8000-000000000009';
const LINE_SMALL = '0199c028-1000-7000-8000-000000000010';
const DEVICE = '0199c028-1000-7000-8000-000000000011';
const PERIOD = { from: new Date('2020-01-01'), toExclusive: new Date('2100-01-01') };
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

/** Runs the arrival controls for the stored order, as a push would. */
async function control() {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: ORDER } });
    return runControls(
      tx,
      {
        tx,
        viewer: {
          personId: OWNER,
          deviceId: DEVICE,
          memberships: [],
          scopeVersion: 0,
          isOnline: false,
        },
      },
      order
    );
  });
}

const movePrice = (id: string, price: bigint) =>
  prisma.productVariant.update({ where: { id }, data: { price, priceUpdatedAt: new Date() } });

const lineData = (id: string, variantId: string, label: string, price: bigint) => ({
  id,
  productVariantId: variantId,
  labelApplied: label,
  quantity: '1',
  referencePrice: price,
  unitPriceApplied: price,
  amount: price,
});

/** Adds the small size to the order; the order total moves in the same transaction. */
const addSmallLine = () =>
  prisma.$transaction([
    prisma.orderLine.create({
      data: { orderId: ORDER, ...lineData(LINE_SMALL, SMALL, 'Fixture Rice sac 5 kg', 8000n) },
    }),
    prisma.order.update({ where: { id: ORDER }, data: { totalAmount: 23000n } }),
  ]);

beforeEach(async () => {
  await prisma.person.create({
    data: {
      id: OWNER,
      phoneNumber: '+2250700002801',
      fullName: 'Fixture Owner',
      registeredAt: LONG_AGO,
      phoneVerifiedAt: LONG_AGO,
      passwordHash: 'fixture-password-hash',
    },
  });
  await prisma.organization.createMany({
    data: [
      { id: ORG, name: 'Fixture Supplier' },
      { id: OTHER_ORG, name: 'Fixture Other' },
    ],
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: ORG,
      customerLabel: 'Fixture Counter',
      createdById: OWNER,
    },
  });
  await prisma.product.create({ data: { id: PRODUCT, organizationId: ORG, name: 'Fixture Rice' } });
  await prisma.productVariant.createMany({
    data: [
      {
        id: BIG,
        productId: PRODUCT,
        organizationId: ORG,
        name: 'sac 10 kg',
        unit: 'bag',
        price: 15000n,
        priceUpdatedAt: LONG_AGO,
      },
      {
        id: SMALL,
        productId: PRODUCT,
        organizationId: ORG,
        name: 'sac 5 kg',
        unit: 'bag',
        price: 8000n,
        priceUpdatedAt: LONG_AGO,
      },
    ],
  });
  // Entered offline after both prices were set: the order is dated after them.
  await prisma.order.create({
    data: {
      id: ORDER,
      customerRelationshipId: REL,
      placedByParty: 'SUPPLIER',
      enteredById: OWNER,
      totalAmount: 15000n,
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
      lines: { create: lineData(LINE, BIG, 'Fixture Rice sac 10 kg', 15000n) },
    },
  });
});

describe('controls by variant (SYNC-028)', () => {
  it('flags a moved price and names the line with the old and the new price (AC-1)', async () => {
    await movePrice(BIG, 15500n);

    const [issue] = await control();

    expect(issue).toMatch(/^PRICE_CHANGED: /);
    expect(issue).toContain('vendu 15 000');
    expect(issue).toContain('prix passé à 15 500');
  });

  it('does not flag an order when only the other size moved (AC-2)', async () => {
    await movePrice(SMALL, 9000n);

    expect(await control()).toEqual([]);
  });

  it('corrects a false reference price to the variant price and shows the gap (AC-3, CM-27)', async () => {
    await prisma.$transaction([
      prisma.orderLine.update({
        where: { id: LINE },
        data: { referencePrice: 14000n, unitPriceApplied: 14000n, amount: 14000n },
      }),
      // The server dates the price at its insert: the order must come after it to stand for "since before".
      prisma.order.update({
        where: { id: ORDER },
        data: { totalAmount: 14000n, createdAt: new Date(Date.now() + 60_000) },
      }),
    ]);

    expect(await control()).toEqual([]);

    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE } });
    expect(line).toMatchObject({
      referencePrice: 15000n,
      unitPriceApplied: 14000n,
      priceSetById: OWNER,
    });
    expect(line.priceSetAt).not.toBeNull();
  });

  it('adds no part for a withdrawn variant even if its price moved (AC-4)', async () => {
    await movePrice(BIG, 15500n);
    await prisma.productVariant.update({ where: { id: BIG }, data: { status: 'INACTIVE' } });

    expect(await control()).toEqual([]);
  });

  it('tells the two sizes apart by their label when both moved (AC-1)', async () => {
    await addSmallLine();
    await movePrice(BIG, 15500n);
    await movePrice(SMALL, 8500n);

    const [issue] = await control();

    expect(issue).toContain('Fixture Rice sac 10 kg : vendu 15 000 ; prix passé à 15 500');
    expect(issue).toContain('Fixture Rice sac 5 kg : vendu 8 000 ; prix passé à 8 500');
  });

  it('shows each line of the list to resolve at the current price of its own variant (AC-5)', async () => {
    await addSmallLine();
    await movePrice(BIG, 15500n);
    await prisma.order.update({
      where: { id: ORDER },
      data: { syncIssue: 'PRICE_CHANGED: fixture' },
    });

    const flagged = await findFlaggedOrders(ORG, PERIOD);

    expect(flagged).toHaveLength(1);
    const prices = flagged[0]?.lines.map((line) => line.currentPrice).sort((a, b) => Number(a - b));
    expect(prices).toEqual([8000n, 15500n]);
    expect(await findFlaggedOrders(OTHER_ORG, PERIOD)).toEqual([]);
  });
});
