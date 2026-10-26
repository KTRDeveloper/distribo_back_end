import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { seedProduct } from '../../helpers/catalog-fixtures';

const SUPPLIER_ORG_ID = '0199c025-0000-7000-8000-000000000001';
const OWNER_ID = '0199c025-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c025-0000-7000-8000-000000000012';
const REL_ID = '0199c025-0000-7000-8000-000000000021';
const ORDER_ID = '0199c025-0000-7000-8000-000000000031';
const VARIANT_ID = '0199c025-0000-7000-8000-000000000041';
const LINE_ID = '0199c025-0000-7000-8000-000000000061';
const AT = new Date('2026-01-02T00:00:00.000Z');

type SqlError = {
  code?: string;
  message?: string;
  meta?: {
    code?: string;
    driverAdapterError?: {
      cause?: { code?: string; originalCode?: string; message?: string };
    };
  };
};

/** Extracts the PostgreSQL code wrapped by the Prisma driver adapter. */
function sqlCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as SqlError;
  const cause = candidate.meta?.driverAdapterError?.cause;
  const message = [candidate.message, cause?.message].filter(Boolean).join(' ');
  return (
    cause?.code ??
    cause?.originalCode ??
    candidate.meta?.code ??
    candidate.code ??
    message.match(/Code:\s*(\w+)/)?.[1]
  );
}

async function captureError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  return undefined;
}

beforeEach(async () => {
  const registered = {
    phoneVerifiedAt: AT,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: AT,
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700025011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700025012',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await seedProduct(prisma, {
    id: VARIANT_ID,
    organizationId: SUPPLIER_ORG_ID,
    name: 'Fixture Rice',
    unit: 'sack',
    price: 3000n,
  });
  await prisma.$executeRaw`
    INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
    VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'SUPPLIER'::public."OrderParty",
      ${OWNER_ID}::uuid, 0)
  `;
});

// The one-time copy and audit of ORD-025 are gone with the product column (ORD-034).
describe('order line variant required', () => {
  it('AC-2 required: the column is NOT NULL and an update to empty fails with 23502', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE orders SET total_amount = 6000 WHERE id = ${ORDER_ID}::uuid`;
      await tx.orderLine.create({
        data: {
          id: LINE_ID,
          orderId: ORDER_ID,
          productVariantId: VARIANT_ID,
          labelApplied: 'Fixture Label',
          quantity: 2,
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: 6000n,
        },
      });
    });
    const error = await captureError(
      prisma.$executeRaw`UPDATE order_lines SET product_variant_id = NULL WHERE id = ${LINE_ID}::uuid`
    );
    expect(sqlCode(error)).toBe('23502');
    const [column] = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_lines'
        AND column_name = 'product_variant_id'
    `;
    expect(column.is_nullable).toBe('NO');
  });

  it('AC-2 required: a create through the client must give the variant', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE orders SET total_amount = 6000 WHERE id = ${ORDER_ID}::uuid`;
      await tx.orderLine.create({
        data: {
          id: LINE_ID,
          orderId: ORDER_ID,
          productVariantId: VARIANT_ID,
          labelApplied: 'Fixture Label',
          quantity: 2,
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: 6000n,
        },
      });
    });
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE_ID } });
    expect(line.productVariantId).toBe(VARIANT_ID);
  });
});
