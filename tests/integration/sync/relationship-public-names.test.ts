import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const OWNER = '0199e047-0000-7000-8000-000000000001';
const DRIVER = '0199e047-0000-7000-8000-000000000002';
const CUSTOMER_PERSON = '0199e047-0000-7000-8000-000000000003';
const CUSTOMER_NAMED = '0199e047-0000-7000-8000-000000000004';
const CUSTOMER_UNNAMED = '0199e047-0000-7000-8000-000000000005';
const SUPPLIER_NAMED = '0199e047-0000-7000-8000-000000000006';
const SUPPLIER_UNNAMED = '0199e047-0000-7000-8000-000000000007';
const OWNER_DEVICE = '0199e047-0000-7000-8000-000000000701';
const ORG = '0199e047-0000-7000-8000-0000000000a1';
const CUSTOMER_ORG = '0199e047-0000-7000-8000-0000000000a2';
const SUPPLIER_ORG = '0199e047-0000-7000-8000-0000000000a3';
const REL_ORG = '0199e047-0000-7000-8000-0000000000c1';
const REL_NAMED = '0199e047-0000-7000-8000-0000000000c2';
const REL_UNNAMED = '0199e047-0000-7000-8000-0000000000c3';
const REL_SUPPLIER_ORG = '0199e047-0000-7000-8000-0000000000c4';
const REL_SUPPLIER_NAMED = '0199e047-0000-7000-8000-0000000000c5';
const REL_SUPPLIER_UNNAMED = '0199e047-0000-7000-8000-0000000000c6';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type Rows = Array<Record<string, unknown>>;
type PullBody = { changes: Record<string, { created: Rows; updated: Rows; deleted: string[] }> };

const pull = async (personId: string) => {
  const res = await createAuthenticatedRequest(app, personId).get('/api/v1/sync/pull');
  expect(res.status).toBe(200);
  return bodyOf<PullBody>(res).changes['customer_relationships'].created;
};
const rowOf = (rows: Rows, id: string) => rows.find((r) => r['id'] === id)!;

async function seedPerson(id: string, phone: string, fullName: string | null) {
  // A person without a name is one who never registered: only an id and a phone number.
  if (fullName === null) {
    await prisma.person.create({ data: { id, phoneNumber: phone } });
    return;
  }
  await prisma.person.create({
    data: {
      id,
      fullName,
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${phone.slice(1)}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
}

async function seedRelationship(id: string, data: Record<string, unknown>) {
  await prisma.customerRelationship.create({
    data: {
      id,
      createdById: OWNER,
      createdAt: LONG_AGO,
      creditLimit: 50000n,
      balance: 0n,
      ...data,
    },
  });
}

describe('relationship rows carry the other side public name (SYNC-047)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600004701', 'Owner Test');
    await seedPerson(DRIVER, '+237600004702', 'Driver Test');
    await seedPerson(CUSTOMER_PERSON, '+237600004703', 'Customer P');
    await seedPerson(CUSTOMER_NAMED, '+237600004704', 'Awa Kone');
    await seedPerson(CUSTOMER_UNNAMED, '+237600004705', null);
    await seedPerson(SUPPLIER_NAMED, '+237600004706', 'Paul Test');
    await seedPerson(SUPPLIER_UNNAMED, '+237600004707', null);
    await prisma.device.create({
      data: { id: OWNER_DEVICE, personId: OWNER, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    for (const [id, name] of [
      [ORG, 'Supplier Org'],
      [CUSTOMER_ORG, 'Boutique Test'],
      [SUPPLIER_ORG, 'Dépôt Test'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    for (const [suffix, personId, role] of [
      ['01', OWNER, 'OWNER'],
      ['02', DRIVER, 'DRIVER'],
    ]) {
      await prisma.collaboration.create({
        data: {
          id: `0199e047-0000-7000-8000-0000000001${suffix}`,
          personId: personId,
          organizationId: ORG,
          role: role as 'OWNER',
          status: 'ACTIVE',
          invitedAt: LONG_AGO,
          acceptedAt: LONG_AGO,
        },
      });
    }

    const supplierSide = { supplierOrganizationId: ORG, customerLabel: 'Tata' };
    await seedRelationship(REL_ORG, { ...supplierSide, customerOrganizationId: CUSTOMER_ORG });
    await seedRelationship(REL_NAMED, { ...supplierSide, customerPersonId: CUSTOMER_NAMED });
    await seedRelationship(REL_UNNAMED, { ...supplierSide, customerPersonId: CUSTOMER_UNNAMED });
    const customerSide = { customerPersonId: CUSTOMER_PERSON, supplierLabel: 'Mon grossiste' };
    await seedRelationship(REL_SUPPLIER_ORG, {
      ...customerSide,
      supplierOrganizationId: SUPPLIER_ORG,
    });
    await seedRelationship(REL_SUPPLIER_NAMED, {
      ...customerSide,
      supplierPersonId: SUPPLIER_NAMED,
      status: 'PENDING',
    });
    await seedRelationship(REL_SUPPLIER_UNNAMED, {
      ...customerSide,
      supplierPersonId: SUPPLIER_UNNAMED,
      status: 'PENDING',
    });

    // The driver sees a customer only with a confirmed order to deliver.
    let n = 0;
    for (const rel of [REL_ORG, REL_NAMED, REL_UNNAMED]) {
      await prisma.order.create({
        data: {
          id: `0199e047-0000-7000-8000-0000000002${++n}0`,
          customerRelationshipId: rel,
          placedByParty: 'SUPPLIER',
          enteredById: OWNER,
          totalAmount: 0n,
          status: 'CONFIRMED',
          deliveryAddressApplied: 'Rue 1',
        },
      });
    }
  });

  describe.each([
    ['organization "Boutique Test"', REL_ORG, 'Boutique Test'],
    ['person with full_name "Awa Kone"', REL_NAMED, 'Awa Kone'],
    ['person without full_name', REL_UNNAMED, null],
  ])('customer is %s', (_label, relId, name) => {
    it.each([
      ['OWNER', OWNER],
      ['DRIVER', DRIVER],
    ])('the %s row carries customer_public_name', async (_role, personId) => {
      const row = rowOf(await pull(personId), relId);
      expect(row['customer_public_name']).toBe(name);
      expect(row).not.toHaveProperty('supplier_public_name');
    });
  });

  describe.each([
    ['organization "Dépôt Test"', REL_SUPPLIER_ORG, 'Dépôt Test'],
    ['invited person with full_name "Paul Test"', REL_SUPPLIER_NAMED, 'Paul Test'],
    ['invited person without full_name', REL_SUPPLIER_UNNAMED, null],
  ])('supplier is %s', (_label, relId, name) => {
    it('the customer row carries supplier_public_name', async () => {
      const row = rowOf(await pull(CUSTOMER_PERSON), relId);
      expect(row['supplier_public_name']).toBe(name);
      expect(row).not.toHaveProperty('customer_public_name');
    });
  });

  it('ignores a public name written by a phone and pulls the real one (AB-1)', async () => {
    const res = await createAuthenticatedRequest(app, OWNER, OWNER_DEVICE)
      .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
      .send({
        changes: {
          customer_relationships: {
            created: [],
            updated: [
              { id: REL_NAMED, customer_label: 'Nouveau', customer_public_name: 'Faux nom' },
            ],
            deleted: [],
          },
        },
      });
    expect(res.status).toBe(200);
    const row = rowOf(await pull(OWNER), REL_NAMED);
    expect(row['customer_public_name']).toBe('Awa Kone');
    const stored = await prisma.customerRelationship.findUniqueOrThrow({
      where: { id: REL_NAMED },
    });
    expect(Object.values(stored)).not.toContain('Faux nom');
  });
});
