import { beforeEach, describe, expect, it } from 'vitest';
import { runControls } from '../../../src/modules/sync/sync.controls.js';
import { findFlaggedOrders } from '../../../src/modules/sync/sync.repository.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c032-1000-7000-8000-000000000001';
const ORG = '0199c032-1000-7000-8000-000000000002';
const OTHER_ORG = '0199c032-1000-7000-8000-000000000003';
const REL = '0199c032-1000-7000-8000-000000000004';
const PRODUCT = '0199c032-1000-7000-8000-000000000005';
const VARIANT = '0199c032-1000-7000-8000-000000000006';
const ORDER = '0199c032-1000-7000-8000-000000000007';
const LINE = '0199c032-1000-7000-8000-000000000008';
const DEVICE = '0199c032-1000-7000-8000-000000000009';
const PRICE = '0199c032-1000-7000-8000-000000000010';
const PERIOD = { from: new Date('2020-01-01'), toExclusive: new Date('2100-01-01') };

/** Runs arrival controls for an already-stored variant-only order in its transaction. */
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

beforeEach(async () => {
  const registeredAt = new Date('2026-01-01');
  await prisma.person.create({
    data: {
      id: OWNER,
      phoneNumber: '+2250700003221',
      fullName: 'Fixture Owner',
      registeredAt,
      phoneVerifiedAt: registeredAt,
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
  await prisma.productVariant.create({
    data: {
      id: VARIANT,
      productId: PRODUCT,
      organizationId: ORG,
      unit: 'bag',
      price: 3200n,
    },
  });
  await prisma.order.create({
    data: {
      id: ORDER,
      customerRelationshipId: REL,
      placedByParty: 'SUPPLIER',
      enteredById: OWNER,
      totalAmount: 15000n,
      createdAt: registeredAt,
      lines: {
        create: {
          id: LINE,
          productVariantId: VARIANT,
          labelApplied: 'Fixture Rice bag',
          quantity: '5',
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: 15000n,
        },
      },
    },
  });
});

describe('variant-only sync price consumers (ORD-032)', () => {
  it('flags the actual variant price and retains the null product', async () => {
    expect(await control()).toEqual([expect.stringContaining('PRICE_CHANGED:')]);
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE } });
    expect(line).toMatchObject({
      productId: null,
      productVariantId: VARIANT,
      referencePrice: 3000n,
    });
  });

  it('corrects a fabricated reference using the variant price without hiding the discount', async () => {
    await prisma.order.update({
      where: { id: ORDER },
      data: { createdAt: new Date(Date.now() + 1000) },
    });
    await control();
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE } });
    expect(line).toMatchObject({
      referencePrice: 3200n,
      unitPriceApplied: 3000n,
      priceSetById: OWNER,
    });
    expect(line.priceSetAt).not.toBeNull();
  });

  it.each(['inactive variant', 'deleted variant', 'deleted product', 'paused product'])(
    'does not add a stale-price warning for a %s',
    async (state) => {
      if (state === 'inactive variant') {
        await prisma.productVariant.update({
          where: { id: VARIANT },
          data: { status: 'INACTIVE' },
        });
      } else if (state === 'deleted variant') {
        await prisma.productVariant.update({
          where: { id: VARIANT },
          data: { deletedAt: new Date() },
        });
      } else {
        await prisma.product.update({
          where: { id: PRODUCT },
          data: state === 'deleted product' ? { deletedAt: new Date() } : { pausedAt: new Date() },
        });
      }
      expect(await control()).toEqual([]);
    }
  );

  it('reads negotiated variant prices in flagged orders without leaking another supplier scope', async () => {
    await prisma.customerPrice.create({
      data: {
        id: PRICE,
        customerRelationshipId: REL,
        productId: PRODUCT,
        productVariantId: VARIANT,
        price: 3100n,
        setById: OWNER,
      },
    });
    await prisma.order.update({
      where: { id: ORDER },
      data: { syncIssue: 'PRICE_CHANGED: fixture' },
    });
    const flagged = await findFlaggedOrders(ORG, PERIOD);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.lines).toHaveLength(1);
    expect(flagged[0]?.lines[0]).toMatchObject({ currentPrice: 3100n, referencePrice: 3000n });
    expect(await findFlaggedOrders(OTHER_ORG, PERIOD)).toEqual([]);
  });
});
