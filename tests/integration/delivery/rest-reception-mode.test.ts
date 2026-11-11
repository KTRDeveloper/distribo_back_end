import { describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0d8-0000-7000-8000-000000000001';
const DRIVER = '0199c0d8-0000-7000-8000-000000000004';
const CUSTOMER = '0199c0d8-0000-7000-8000-000000000006';
const SUPPLIER = '0199c0d8-0000-7000-8000-0000000000a1';
const PRODUCT = '0199c0d8-0000-7000-8000-0000000000b1';
const REL = '0199c0d8-0000-7000-8000-0000000000e1';
const ORDER = '0199c0d8-0000-7000-8000-000000000110';
const LINE = '0199c0d8-0000-7000-8000-000000000211';
const DELIVERY = '0199c0d8-0000-7000-8000-000000000310';
const REG = new Date('2026-01-01T00:00:00.000Z');

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

/** An IN_DELIVERY order of 10 units with the given reception mode and address. */
async function seedOrder(receptionMode: 'DELIVERY' | 'PICKUP' | null, address: string | null) {
  await seedPerson(OWNER, '+237600089001');
  await seedPerson(DRIVER, '+237600089004');
  await seedPerson(CUSTOMER, '+237600089006');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  for (const [i, [personId, role]] of (
    [
      [OWNER, 'OWNER'],
      [DRIVER, 'DRIVER'],
    ] as const
  ).entries()) {
    await prisma.collaboration.create({
      data: {
        id: `0199c0d8-0000-7000-8000-0000000004${i}f`,
        personId,
        organizationId: SUPPLIER,
        role,
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  }
  await seedProduct(prisma, {
    id: PRODUCT,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 3000n,
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: 100000n,
    },
  });
  await prisma.order.create({
    data: {
      id: ORDER,
      customerRelationshipId: REL,
      enteredById: OWNER,
      placedByParty: 'SUPPLIER',
      status: 'IN_DELIVERY',
      deliveryAddressApplied: address,
      receptionMode,
      deliveryCost: 0n,
      totalAmount: 30000n,
      lines: {
        create: [
          {
            id: LINE,
            productVariantId: PRODUCT,
            labelApplied: 'Rice (sack)',
            quantity: '10',
            referencePrice: 3000n,
            unitPriceApplied: 3000n,
            amount: 30000n,
          },
        ],
      },
    },
  });
  await prisma.delivery.create({
    data: {
      id: DELIVERY,
      orderId: ORDER,
      assignedToId: DRIVER,
      departedAt: new Date('2026-07-01T08:00:00.000Z'),
    },
  });
}

describe('DLV-018 the rest keeps the reception mode', () => {
  it.each([
    { mode: 'DELIVERY', address: 'Street 1', expectedAddress: 'Street 1' },
    { mode: 'PICKUP', address: null, expectedAddress: null },
    { mode: null, address: 'Street 1', expectedAddress: 'Street 1' },
  ] as const)(
    'mode $mode: the rest has the same mode and address $expectedAddress (AC-1, C-60)',
    async ({ mode, address, expectedAddress }) => {
      await seedOrder(mode, address);

      const response = await createAuthenticatedRequest(app, DRIVER)
        .post(`/api/v1/organizations/${SUPPLIER}/orders/${ORDER}/deliver`)
        .send({
          id: '0199c0d8-0000-7000-8000-000000000510',
          collected_amount: 0,
          sale_entry_id: '0199c0d8-0000-7000-8000-000000000610',
          lines: [{ line_id: LINE, delivered_quantity: '8' }],
          rest: 'LATER',
        });

      expect(response.status).toBe(200);
      const rest = await prisma.order.findFirstOrThrow({ where: { parentOrderId: ORDER } });
      expect(rest.receptionMode).toBe(mode);
      expect(rest.deliveryAddressApplied).toBe(expectedAddress);
    }
  );
});
