import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { seedProduct } from '../../helpers/catalog-fixtures';
import { countOrderedLinesByVariant } from '../../../src/modules/order/order.repository';

const SUPPLIER_ID = '0199c029-0000-7000-8000-000000000001';
const OTHER_SUPPLIER_ID = '0199c029-0000-7000-8000-000000000002';
const OWNER_ID = '0199c029-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c029-0000-7000-8000-000000000012';
const REL_ID = '0199c029-0000-7000-8000-000000000021';
const OTHER_REL_ID = '0199c029-0000-7000-8000-000000000022';
// Old-style products: each has a variant with the same id as the product.
const RICE = '0199c029-0000-7000-8000-000000000041';
const OIL = '0199c029-0000-7000-8000-000000000042';
const SUGAR = '0199c029-0000-7000-8000-000000000043';
const OTHER_PRODUCT = '0199c029-0000-7000-8000-000000000044';
const AT = new Date('2026-01-02T00:00:00.000Z');
const SINCE = new Date('2026-06-01T00:00:00.000Z');
const INSIDE = new Date('2026-07-01T00:00:00.000Z');
const BEFORE = new Date('2026-05-31T23:59:59.000Z');

let seq = 0;
function nextId(prefix: number): string {
  seq += 1;
  return `0199c029-0000-7000-${String(prefix).padStart(4, '0')}-${String(seq).padStart(12, '0')}`;
}

type OrderOptions = {
  rel?: string;
  status?: string;
  createdAt?: Date;
  deleted?: boolean;
};

/**
 * Inserts an order and one 2 x 3000 line per entry in one transaction, because the database checks
 * at commit that the total equals the amounts of the undeleted lines (ORD-006).
 */
async function addOrder(
  lines: Array<{ product: string; deleted?: boolean }>,
  options: OrderOptions = {}
): Promise<void> {
  const orderId = nextId(1);
  const deletedAt = options.deleted ? INSIDE : null;
  const status = options.status ?? 'CONFIRMED';
  const cancelled = status === 'CANCELLED';
  // The database requires a PENDING order to be placed by the customer.
  const placedBy = status === 'PENDING' ? 'CUSTOMER' : 'SUPPLIER';
  const total = lines.filter((line) => !line.deleted).length * 6000;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount,
        status, created_at, deleted_at, cancelled_by_party, cancelled_by_id, cancelled_at)
      VALUES (${orderId}::uuid, ${options.rel ?? REL_ID}::uuid, ${placedBy}::public."OrderParty",
        ${OWNER_ID}::uuid, ${total}::bigint, ${status}::public."OrderStatus",
        ${options.createdAt ?? INSIDE}, ${deletedAt},
        ${cancelled ? 'CUSTOMER' : null}::public."OrderParty",
        ${cancelled ? CUSTOMER_ID : null}::uuid, ${cancelled ? INSIDE : null})
    `;
    for (const line of lines) {
      const lineDeletedAt = line.deleted ? INSIDE : null;
      await tx.$executeRaw`
        INSERT INTO order_lines (
          id, order_id, product_variant_id, label_applied, quantity,
          reference_price, unit_price_applied, amount, deleted_at
        )
        VALUES (${nextId(2)}::uuid, ${orderId}::uuid, ${line.product}::uuid, 'Fixture', 2,
          3000, 3000, 6000, ${lineDeletedAt})
      `;
    }
  });
}

function count(): Promise<Map<string, number>> {
  return prisma.$transaction((tx) => countOrderedLinesByVariant(tx, SUPPLIER_ID, SINCE));
}

beforeEach(async () => {
  seq = 0;
  const registered = {
    phoneVerifiedAt: AT,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: AT,
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700029011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700029012',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${SUPPLIER_ID}::uuid, 'Fixture Supplier'), (${OTHER_SUPPLIER_ID}::uuid, 'Fixture Other')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${SUPPLIER_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid),
      (${OTHER_REL_ID}::uuid, ${OTHER_SUPPLIER_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await seedProduct(prisma, { id: RICE, organizationId: SUPPLIER_ID, name: 'Fixture Rice', unit: 'sack', price: 3000n });
  await seedProduct(prisma, { id: OIL, organizationId: SUPPLIER_ID, name: 'Fixture Oil', unit: 'can', price: 3000n });
  await seedProduct(prisma, { id: SUGAR, organizationId: SUPPLIER_ID, name: 'Fixture Sugar', unit: 'kg', price: 3000n });
  await seedProduct(prisma, { id: OTHER_PRODUCT, organizationId: OTHER_SUPPLIER_ID, name: 'Fixture Other', unit: 'kg', price: 3000n });
});

describe('countOrderedLinesByVariant', () => {
  it('AC-1 counts the lines per variant, absent when no line', async () => {
    await addOrder([{ product: RICE }, { product: RICE }, { product: OIL }]);
    await addOrder([{ product: RICE }]);
    const result = await count();
    expect(result).toBeInstanceOf(Map);
    expect(result.get(RICE)).toBe(3);
    expect(result.get(OIL)).toBe(1);
    expect(result.has(SUGAR)).toBe(false);
    expect(result.size).toBe(2);
  });

  it('AC-1 counts an order created exactly at since', async () => {
    await addOrder([{ product: RICE }], { createdAt: SINCE });
    expect((await count()).get(RICE)).toBe(1);
  });

  it('AC-2 leaves out an order created before since', async () => {
    await addOrder([{ product: RICE }], { createdAt: BEFORE });
    expect((await count()).size).toBe(0);
  });

  it('AC-2 leaves out a CANCELLED order', async () => {
    await addOrder([{ product: RICE }], { status: 'CANCELLED' });
    expect((await count()).size).toBe(0);
  });

  it('AC-2 leaves out a deleted line', async () => {
    await addOrder([{ product: RICE, deleted: true }, { product: OIL }]);
    const result = await count();
    expect(result.has(RICE)).toBe(false);
    expect(result.get(OIL)).toBe(1);
  });

  it('AC-2 leaves out a line of a deleted order', async () => {
    await addOrder([{ product: RICE }], { deleted: true });
    expect((await count()).size).toBe(0);
  });

  it('AC-2 leaves out a line of another supplier order', async () => {
    await addOrder([{ product: OTHER_PRODUCT }], { rel: OTHER_REL_ID });
    expect((await count()).size).toBe(0);
  });

  it('counts the other statuses', async () => {
    await addOrder([{ product: RICE }], { status: 'PENDING' });
    await addOrder([{ product: RICE }], { status: 'IN_DELIVERY' });
    expect((await count()).get(RICE)).toBe(2);
  });

  it('AC-3 returns an empty map when the supplier has no order', async () => {
    const result = await count();
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });
});
