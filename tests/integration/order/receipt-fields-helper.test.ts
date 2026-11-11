import { describe, expect, it } from 'vitest';
import { RECEIPT_FIELDS } from '../../helpers/receipt-fields.js';
import { prisma } from '../../setup.js';

const OWNER_ID = '0199c043-0000-7000-8000-000000000011';
const SUPPLIER_ORG_ID = '0199c043-0000-7000-8000-000000000001';
const REL_ID = '0199c043-0000-7000-8000-000000000021';
const ORDER_ID = '0199c043-0000-7000-8000-000000000031';
const AT = new Date('2026-01-02T00:00:00.000Z');

describe('RECEIPT_FIELDS helper', () => {
  it('AC-1: an order created as DELIVERED with the helper stores its four values', async () => {
    await prisma.person.create({
      data: {
        id: OWNER_ID,
        fullName: 'Fixture Owner',
        phoneNumber: '+2250700043011',
        phoneVerifiedAt: AT,
        passwordHash: 'test-password-hash',
        registeredAt: AT,
      },
    });
    await prisma.organization.create({
      data: { id: SUPPLIER_ORG_ID, name: 'Fixture Supplier', status: 'ACTIVE' },
    });
    await prisma.customerRelationship.create({
      data: {
        id: REL_ID,
        supplierOrganizationId: SUPPLIER_ORG_ID,
        customerLabel: 'Fixture counter',
        createdById: OWNER_ID,
        status: 'ACTIVE',
        creditLimit: 0n,
      },
    });
    await prisma.order.create({
      data: {
        id: ORDER_ID,
        customerRelationshipId: REL_ID,
        enteredById: OWNER_ID,
        placedByParty: 'SUPPLIER',
        status: 'DELIVERED',
        deliveredAt: AT,
        deliveredById: OWNER_ID,
        deliveryCost: 0n,
        totalAmount: 0n,
        ...RECEIPT_FIELDS,
      },
    });

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
    expect(stored).toMatchObject({
      supplierNameApplied: 'Test supplier',
      customerNameApplied: null,
      collectedApplied: 0n,
      balanceAfterApplied: 0n,
    });
  });
});
