import { seedCustomerPrice, seedProduct } from '../../helpers/catalog-fixtures.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const OWNER = '0199e004-0000-7000-8000-000000000001';
const SELLER = '0199e004-0000-7000-8000-000000000002';
const DRIVER = '0199e004-0000-7000-8000-000000000003';
const DRIVER_IDLE = '0199e004-0000-7000-8000-000000000004';
const CUSTOMER = '0199e004-0000-7000-8000-000000000005';
const OWNER_B = '0199e004-0000-7000-8000-000000000006';
const CUSTOMER_2 = '0199e004-0000-7000-8000-000000000007';
const CUSTOMER_3 = '0199e004-0000-7000-8000-000000000008';
const ORG_A = '0199e004-0000-7000-8000-0000000000a1';
const ORG_B = '0199e004-0000-7000-8000-0000000000b1';
const REL_CUSTOMER = '0199e004-0000-7000-8000-0000000000c1';
const REL_COUNTER = '0199e004-0000-7000-8000-0000000000c2';
const REL_NO_ORDER = '0199e004-0000-7000-8000-0000000000c3';
const REL_DUPLICATE = '0199e004-0000-7000-8000-0000000000c4';
const REL_OTHER_ORG = '0199e004-0000-7000-8000-0000000000c5';
const REL_NO_CEILING = '0199e004-0000-7000-8000-0000000000c6';
const PRODUCT = '0199e004-0000-7000-8000-0000000000d1';
const PRODUCT_B = '0199e004-0000-7000-8000-0000000000d2';
const PRICE = '0199e004-0000-7000-8000-0000000000e1';
const PRICE_B = '0199e004-0000-7000-8000-0000000000e2';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type Rows = Array<Record<string, unknown>>;
type Changes = { created: Rows; updated: Rows; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const pull = (personId: string, query = '') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/sync/pull${query}`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function seedCollaboration(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e004-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

async function seedOrder(
  suffix: string,
  relationshipId: string,
  data: { status: 'CONFIRMED' | 'PENDING'; address?: string; placedBy: 'SUPPLIER' | 'CUSTOMER' }
) {
  await prisma.order.create({
    data: {
      id: `0199e004-0000-7000-8000-0000000002${suffix}`,
      customerRelationshipId: relationshipId,
      placedByParty: data.placedBy,
      enteredById: SELLER,
      totalAmount: 0n,
      status: data.status,
      deliveryAddressApplied: data.address ?? null,
    },
  });
}

const relRows = (body: PullBody) => body.changes['customer_relationships'];
const idsOf = (rows: Rows) => rows.map((r) => r['id']).sort();

describe('GET /api/v1/sync/pull (relationships and negotiated prices)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600000401', 'Owner A');
    await seedPerson(SELLER, '+237600000402', 'Seller A');
    await seedPerson(DRIVER, '+237600000403', 'Driver A');
    await seedPerson(DRIVER_IDLE, '+237600000404', 'Driver Idle');
    await seedPerson(CUSTOMER, '+237600000405', 'Customer');
    await seedPerson(OWNER_B, '+237600000406', 'Owner B');
    await seedPerson(CUSTOMER_2, '+237600000407', 'Customer Two');
    await seedPerson(CUSTOMER_3, '+237600000408', 'Customer Three');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedCollaboration('01', OWNER, ORG_A, 'OWNER');
    await seedCollaboration('02', SELLER, ORG_A, 'SELLER');
    await seedCollaboration('03', DRIVER, ORG_A, 'DRIVER');
    await seedCollaboration('04', DRIVER_IDLE, ORG_A, 'DRIVER');
    await seedCollaboration('05', OWNER_B, ORG_B, 'OWNER');

    const base = { createdById: SELLER, createdAt: LONG_AGO };
    await prisma.customerRelationship.create({
      data: {
        ...base,
        id: REL_CUSTOMER,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        customerLabel: 'Chez Mama',
        supplierLabel: 'Fournisseur Vedette',
        supplierNotes: 'note-secrete-client',
        deliveryAddress: 'Rue 1',
        creditLimit: 50000n,
        balance: 40000n,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        ...base,
        id: REL_COUNTER,
        supplierOrganizationId: ORG_A,
        customerLabel: 'Comptoir',
        supplierNotes: 'note-secrete-comptoir',
        creditLimit: 0n,
        balance: 0n,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        ...base,
        id: REL_NO_CEILING,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER_2,
        customerLabel: 'Sans plafond',
        creditLimit: null,
        balance: 7123n,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        ...base,
        id: REL_NO_ORDER,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER_3,
        customerLabel: 'Sans commande',
        supplierNotes: 'note-secrete-cachee',
        creditLimit: 99000n,
        balance: 123456n,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        ...base,
        id: REL_DUPLICATE,
        supplierOrganizationId: ORG_A,
        customerLabel: 'Doublon',
        creditLimit: 0n,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        ...base,
        id: REL_OTHER_ORG,
        createdById: OWNER_B,
        supplierOrganizationId: ORG_B,
        customerPersonId: CUSTOMER_2,
        customerLabel: 'Autre organisation',
        supplierNotes: 'note-autre-org',
        creditLimit: 777777n,
        balance: 555555n,
      },
    });

    await seedOrder('01', REL_CUSTOMER, { status: 'CONFIRMED', placedBy: 'SUPPLIER' });
    await seedOrder('02', REL_COUNTER, {
      status: 'CONFIRMED',
      placedBy: 'SUPPLIER',
      address: 'Marche central',
    });
    await seedOrder('04', REL_NO_CEILING, {
      status: 'CONFIRMED',
      placedBy: 'SUPPLIER',
      address: 'Quartier nord',
    });
    await seedOrder('03', REL_NO_ORDER, { status: 'PENDING', placedBy: 'CUSTOMER' });
    await prisma.delivery.create({
      data: {
        id: '0199e004-0000-7000-8000-000000000301',
        orderId: '0199e004-0000-7000-8000-000000000201',
        assignedToId: DRIVER,
      },
    });

    for (const [id, org] of [
      [PRODUCT, ORG_A],
      [PRODUCT_B, ORG_B],
    ]) {
      await seedProduct(prisma, {
        id,
        organizationId: org,
        name: 'Eau',
        unit: 'carton',
        price: 5000n,
      });
    }
    await seedCustomerPrice(prisma, {
      id: PRICE,
      customerRelationshipId: REL_CUSTOMER,
      productVariantId: PRODUCT,
      price: 4500n,
      setById: SELLER,
    });
    await seedCustomerPrice(prisma, {
      id: PRICE_B,
      customerRelationshipId: REL_OTHER_ORG,
      productVariantId: PRODUCT_B,
      price: 100n,
      setById: OWNER_B,
    });
  });

  it('seller: the organization customers and counters in the supplier view (AC-1, C-35)', async () => {
    const body = bodyOf<PullBody>(await pull(SELLER));

    const rows = relRows(body).created;
    expect(idsOf(rows)).toEqual(
      [REL_CUSTOMER, REL_COUNTER, REL_NO_ORDER, REL_DUPLICATE, REL_NO_CEILING].sort()
    );
    expect(rows.find((r) => r['id'] === REL_CUSTOMER)).toMatchObject({
      customer_label: 'Chez Mama',
      supplier_notes: 'note-secrete-client',
      credit_limit: 50000,
      balance: 40000,
      customer_person_id: CUSTOMER,
      supplier_organization_id: ORG_A,
    });
    expect(rows.find((r) => r['id'] === REL_CUSTOMER)).not.toHaveProperty('supplier_label');
    expect(rows.find((r) => r['id'] === REL_COUNTER)).toMatchObject({
      customer_label: 'Comptoir',
      credit_limit: 0,
      balance: 0,
    });
    expect(rows.find((r) => r['id'] === REL_NO_CEILING)).toMatchObject({
      credit_limit: null,
      balance: 7123,
    });
    for (const row of rows) {
      expect(typeof row['server_updated_at']).toBe('number');
    }
    expect(relRows(body).updated).toEqual([]);
    expect(relRows(body).deleted).toEqual([]);
    expect(JSON.stringify(body.changes)).not.toContain('note-autre-org');
  });

  it('driver: available credit instead of limit and balance (AC-2, CM-30)', async () => {
    const body = bodyOf<PullBody>(await pull(DRIVER));

    expect(idsOf(relRows(body).created)).toEqual(
      [REL_CUSTOMER, REL_COUNTER, REL_NO_CEILING].sort()
    );
    const row = relRows(body).created.find((r) => r['id'] === REL_CUSTOMER)!;
    expect(row).toMatchObject({ credit_limit: 10000, balance: 0, customer_label: 'Customer' });
    expect(row).not.toHaveProperty('supplier_notes');
    expect(row).not.toHaveProperty('supplier_label');
  });

  it('driver: a null credit limit stays null (AC-3)', async () => {
    const body = bodyOf<PullBody>(await pull(DRIVER));

    const row = relRows(body).created.find((r) => r['id'] === REL_NO_CEILING)!;
    expect(row['credit_limit']).toBeNull();
    expect(row['balance']).toBe(0);
  });

  it('driver sees a customer only through an order to deliver or a delivery of theirs (AC-2)', async () => {
    const body = bodyOf<PullBody>(await pull(DRIVER_IDLE));

    expect(idsOf(relRows(body).created)).toEqual([REL_COUNTER, REL_NO_CEILING].sort());
    expect(body.changes['customer_prices']).toEqual({ created: [], updated: [], deleted: [] });
  });

  it('customer person: own relationships in the customer view (AC-4)', async () => {
    const body = bodyOf<PullBody>(await pull(CUSTOMER));

    expect(idsOf(relRows(body).created)).toEqual([REL_CUSTOMER]);
    const row = relRows(body).created[0];
    expect(row).toMatchObject({
      supplier_label: 'Fournisseur Vedette',
      credit_limit: 50000,
      balance: 40000,
    });
    expect(row).not.toHaveProperty('customer_label');
    expect(row).not.toHaveProperty('supplier_notes');
    expect(JSON.stringify(body.changes)).not.toContain('Chez Mama');
    expect(JSON.stringify(body.changes)).not.toContain('note-secrete');
  });

  it('a collaborator who is also the customer gets the customer view of their own row (CM-19, judge-self rule)', async () => {
    const own = '0199e004-0000-7000-8000-0000000000c7';
    await prisma.customerRelationship.create({
      data: {
        id: own,
        supplierOrganizationId: ORG_A,
        customerPersonId: SELLER,
        createdById: OWNER,
        customerLabel: 'Seller as customer',
        supplierNotes: 'note-sur-le-vendeur',
        supplierLabel: 'Ma boutique',
        creditLimit: 3000n,
        balance: 1000n,
      },
    });

    const row = relRows(bodyOf<PullBody>(await pull(SELLER))).created.find((r) => r['id'] === own)!;

    expect(row['supplier_label']).toBe('Ma boutique');
    expect(row).not.toHaveProperty('customer_label');
    expect(row).not.toHaveProperty('supplier_notes');
  });

  it('merged duplicate and deleted relationship are listed in deleted (AC-5, C-35)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER));
    await sleep(20);
    await prisma.customerRelationship.update({
      where: { id: REL_DUPLICATE },
      data: { deletedAt: new Date(), mergedIntoId: REL_CUSTOMER },
    });
    await prisma.customerRelationship.update({
      where: { id: REL_NO_ORDER },
      data: { deletedAt: new Date() },
    });

    const body = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${first.timestamp}`));

    expect([...relRows(body).deleted].sort()).toEqual([REL_DUPLICATE, REL_NO_ORDER].sort());
    expect(relRows(body).created).toEqual([]);
    expect(relRows(body).updated).toEqual([]);

    const fresh = bodyOf<PullBody>(await pull(SELLER));
    expect(idsOf(relRows(fresh).created)).toEqual(
      [REL_CUSTOMER, REL_COUNTER, REL_NO_CEILING].sort()
    );
  });

  it('an incremental pull lists a changed balance as updated (C-35)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER));
    await sleep(20);
    await prisma.customerRelationship.update({
      where: { id: REL_NO_CEILING },
      data: { balance: 9000n },
    });

    const body = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${first.timestamp}`));

    expect(relRows(body).updated).toHaveLength(1);
    expect(relRows(body).updated[0]).toMatchObject({ id: REL_NO_CEILING, balance: 9000 });
  });

  it('driver: a merged duplicate of the organization is listed in deleted (AC-5)', async () => {
    const first = bodyOf<PullBody>(await pull(DRIVER));
    await sleep(20);
    await prisma.customerRelationship.update({
      where: { id: REL_DUPLICATE },
      data: { deletedAt: new Date(), mergedIntoId: REL_CUSTOMER },
    });

    const body = bodyOf<PullBody>(await pull(DRIVER, `?last_pulled_at=${first.timestamp}`));

    expect(relRows(body).deleted).toEqual([REL_DUPLICATE]);
  });

  it('customer prices: seller and owner see their organization, a customer only their own, a driver none', async () => {
    for (const person of [OWNER, SELLER, CUSTOMER]) {
      const body = bodyOf<PullBody>(await pull(person));
      const rows = body.changes['customer_prices'].created;
      expect(idsOf(rows)).toEqual([PRICE]);
      expect(rows[0]).toMatchObject({
        customer_relationship_id: REL_CUSTOMER,
        product_variant_id: PRODUCT,
        price: 4500,
      });
    }
    for (const person of [DRIVER, DRIVER_IDLE]) {
      const body = bodyOf<PullBody>(await pull(person));
      expect(body.changes['customer_prices']).toEqual({ created: [], updated: [], deleted: [] });
    }
  });

  it('pulls a distinct variant with only the price wire fields, including incremental updates', async () => {
    const variantId = '0199e004-0000-7000-8000-0000000000d3';
    await prisma.productVariant.create({
      data: {
        id: variantId,
        productId: PRODUCT,
        organizationId: ORG_A,
        name: 'sac 10 kg',
        unit: 'sac',
        price: 5000n,
      },
    });
    await prisma.customerPrice.update({
      where: { id: PRICE },
      data: { productVariantId: variantId },
    });

    for (const person of [OWNER, SELLER, CUSTOMER]) {
      const first = bodyOf<PullBody>(await pull(person));
      const row = first.changes['customer_prices'].created[0];
      expect(Object.keys(row).sort()).toEqual([
        'customer_relationship_id',
        'id',
        'price',
        'product_variant_id',
        'server_updated_at',
        'set_at',
      ]);
      expect(row).toMatchObject({
        id: PRICE,
        customer_relationship_id: REL_CUSTOMER,
        product_variant_id: variantId,
        price: 4500,
      });

      await sleep(20);
      await prisma.customerPrice.update({ where: { id: PRICE }, data: { price: 4500n } });
      const incremental = bodyOf<PullBody>(
        await pull(person, `?last_pulled_at=${first.timestamp}`)
      );
      const updated = incremental.changes['customer_prices'].updated;
      expect(updated).toHaveLength(1);
      expect(updated[0]).toEqual({
        ...row,
        server_updated_at: updated[0]['server_updated_at'],
      });
      expect(updated[0]['server_updated_at']).toBeGreaterThan(first.timestamp);
    }

    for (const person of [DRIVER, DRIVER_IDLE, CUSTOMER_3]) {
      const body = bodyOf<PullBody>(await pull(person));
      expect(body.changes['customer_prices']).toEqual({ created: [], updated: [], deleted: [] });
    }
  });

  it('a deleted customer price is listed in deleted (C-35)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER));
    await sleep(20);
    await prisma.customerPrice.update({ where: { id: PRICE }, data: { deletedAt: new Date() } });

    const body = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${first.timestamp}`));

    expect(body.changes['customer_prices']?.deleted).toEqual([PRICE]);
  });

  it('driver pull never contains a debt, a limit or a note of any customer (AB-1, CWE-200)', async () => {
    const body = bodyOf<PullBody>(await pull(DRIVER));
    const serialized = JSON.stringify(body.changes);

    for (const secret of [
      '40000',
      '50000',
      '7123',
      '123456',
      '99000',
      '777777',
      '555555',
      'note-secrete',
      'note-autre-org',
      'Fournisseur Vedette',
      'Sans commande',
      'Autre organisation',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    for (const row of relRows(body).created) {
      expect(row['balance']).toBe(0);
      expect(row).not.toHaveProperty('supplier_notes');
    }
  });
});
