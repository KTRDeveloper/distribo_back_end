import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { transitionOrder } from '../../../src/modules/order/order.state.js';

const SUPPLIER_ORG_ID = '0199c008-0000-7000-8000-000000000001';
const OWNER_ID = '0199c008-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c008-0000-7000-8000-000000000012';
const REL_ID = '0199c008-0000-7000-8000-000000000021';
const ORDER_ID = '0199c008-0000-7000-8000-000000000031';
const AT = new Date('2026-01-02T00:00:00.000Z');

type Status = 'PENDING' | 'CONFIRMED' | 'IN_DELIVERY' | 'DELIVERED' | 'CANCELLED';

const SUPPLIER = { personId: OWNER_ID, party: 'SUPPLIER' } as const;
const CUSTOMER = { personId: CUSTOMER_ID, party: 'CUSTOMER' } as const;

/** Inserts an order in `status` with the columns its CHECKs require. */
async function insertOrder(status: Status): Promise<void> {
  const cancelled = status === 'CANCELLED';
  const delivered = status === 'DELIVERED';
  await prisma.$executeRaw`
    INSERT INTO orders (
      id, customer_relationship_id, placed_by_party, entered_by_id, total_amount, status,
      cancelled_by_party, cancelled_by_id, cancelled_at, cancellation_reason,
      delivered_at, delivered_by_id
    )
    VALUES (
      ${ORDER_ID}::uuid, ${REL_ID}::uuid, 'CUSTOMER'::public."OrderParty", ${OWNER_ID}::uuid, 0,
      ${status}::text::public."OrderStatus",
      ${cancelled ? 'CUSTOMER' : null}::text::public."OrderParty",
      ${cancelled ? CUSTOMER_ID : null}::uuid, ${cancelled ? AT : null}::timestamptz,
      ${cancelled ? 'Changed mind' : null}::text,
      ${delivered ? AT : null}::timestamptz, ${delivered ? OWNER_ID : null}::uuid
    )
  `;
}

const run = <T>(fn: Parameters<typeof prisma.$transaction<T>>[0]) => prisma.$transaction(fn);

const reload = () => prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });

beforeEach(async () => {
  const registered = {
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700008011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700008012',
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
});

describe('steps (AC-1, CM-12, C-18)', () => {
  const examples: Array<[Status, Status, 'updated' | 'invalid']> = [
    ['PENDING', 'CONFIRMED', 'updated'],
    ['PENDING', 'CANCELLED', 'updated'],
    ['CONFIRMED', 'IN_DELIVERY', 'updated'],
    ['CONFIRMED', 'DELIVERED', 'updated'],
    ['CONFIRMED', 'CANCELLED', 'updated'],
    ['IN_DELIVERY', 'DELIVERED', 'updated'],
    ['IN_DELIVERY', 'CONFIRMED', 'updated'],
    ['IN_DELIVERY', 'CANCELLED', 'invalid'],
    ['DELIVERED', 'CANCELLED', 'invalid'],
    ['CANCELLED', 'CONFIRMED', 'invalid'],
    ['PENDING', 'DELIVERED', 'invalid'],
  ];

  it.each(examples)('%s to %s is %s', async (from, to, result) => {
    await insertOrder(from);
    const call = run((tx) =>
      transitionOrder(tx, ORDER_ID, to, SUPPLIER, { cancellationReason: 'Out of stock' })
    );
    if (result === 'updated') {
      const order = await call;
      expect(order.status).toBe(to);
      expect((await reload()).status).toBe(to);
    } else {
      await expect(call).rejects.toMatchObject({
        statusCode: 409,
        code: 'INVALID_TRANSITION',
        message: expect.stringContaining(from) as string,
      });
      expect((await reload()).status).toBe(from);
    }
  });

  it('sets delivered_at and delivered_by_id on delivery', async () => {
    await insertOrder('CONFIRMED');
    const order = await run((tx) => transitionOrder(tx, ORDER_ID, 'DELIVERED', SUPPLIER));
    expect(order.deliveredById).toBe(OWNER_ID);
    expect(order.deliveredAt).toBeInstanceOf(Date);
    expect(order.syncIssue).toBeNull();
  });

  it('answers 404 NOT_FOUND for an unknown order', async () => {
    await expect(
      run((tx) => transitionOrder(tx, ORDER_ID, 'CONFIRMED', SUPPLIER))
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});

describe('cancellation fields (AC-2, C-16)', () => {
  it('rejects a SUPPLIER cancellation without a reason with 400 VALIDATION_ERROR', async () => {
    await insertOrder('CONFIRMED');
    for (const fields of [undefined, {}, { cancellationReason: '   ' }]) {
      await expect(
        run((tx) => transitionOrder(tx, ORDER_ID, 'CANCELLED', SUPPLIER, fields))
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    }
    expect((await reload()).status).toBe('CONFIRMED');
  });

  it('stores party, person, time and reason for a SUPPLIER cancellation', async () => {
    await insertOrder('CONFIRMED');
    const order = await run((tx) =>
      transitionOrder(tx, ORDER_ID, 'CANCELLED', SUPPLIER, { cancellationReason: 'Out of stock' })
    );
    expect(order).toMatchObject({
      status: 'CANCELLED',
      cancelledByParty: 'SUPPLIER',
      cancelledById: OWNER_ID,
      cancellationReason: 'Out of stock',
    });
    expect(order.cancelledAt).toBeInstanceOf(Date);
  });

  it('lets a CUSTOMER cancel without a reason', async () => {
    await insertOrder('PENDING');
    const order = await run((tx) => transitionOrder(tx, ORDER_ID, 'CANCELLED', CUSTOMER));
    expect(order).toMatchObject({
      status: 'CANCELLED',
      cancelledByParty: 'CUSTOMER',
      cancelledById: CUSTOMER_ID,
      cancellationReason: null,
    });
  });
});

describe('parallel steps (AC-3, v5.0.0-2.3.4)', () => {
  it('lets exactly one of a cancellation and a delivery succeed', async () => {
    await insertOrder('CONFIRMED');
    const results = await Promise.allSettled([
      run((tx) =>
        transitionOrder(tx, ORDER_ID, 'CANCELLED', SUPPLIER, { cancellationReason: 'Out of stock' })
      ),
      run((tx) => transitionOrder(tx, ORDER_ID, 'DELIVERED', SUPPLIER)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ statusCode: 409, code: 'INVALID_TRANSITION' });
    const order = await reload();
    expect(['CANCELLED', 'DELIVERED']).toContain(order.status);
    expect(order.syncIssue).toBeNull();
  });
});

describe('delivery wins through sync (AC-4)', () => {
  it('delivers a CANCELLED order with sync_issue and no cancellation columns', async () => {
    await insertOrder('CANCELLED');
    const order = await run((tx) =>
      transitionOrder(tx, ORDER_ID, 'DELIVERED', SUPPLIER, undefined, { viaSync: true })
    );
    expect(order).toMatchObject({
      status: 'DELIVERED',
      syncIssue: 'Livrée après annulation',
      deliveredById: OWNER_ID,
      cancelledByParty: null,
      cancelledById: null,
      cancelledAt: null,
      cancellationReason: null,
    });
    expect(order.deliveredAt).toBeInstanceOf(Date);
  });

  it('keeps a DELIVERED order DELIVERED and records the failed cancellation', async () => {
    await insertOrder('DELIVERED');
    const before = await reload();
    const order = await run((tx) =>
      transitionOrder(tx, ORDER_ID, 'CANCELLED', CUSTOMER, undefined, { viaSync: true })
    );
    expect(order.status).toBe('DELIVERED');
    expect(order.syncIssue).toBe('Annulation impossible : commande livrée');
    expect(order.deliveredAt).toEqual(before.deliveredAt);
    expect(order.cancelledByParty).toBeNull();
  });

  it('does not set sync_issue when sync delivers a CONFIRMED order normally', async () => {
    await insertOrder('CONFIRMED');
    const order = await run((tx) =>
      transitionOrder(tx, ORDER_ID, 'DELIVERED', SUPPLIER, undefined, { viaSync: true })
    );
    expect(order.status).toBe('DELIVERED');
    expect(order.syncIssue).toBeNull();
  });

  it('refuses the same delivery-after-cancellation without viaSync', async () => {
    await insertOrder('CANCELLED');
    await expect(
      run((tx) => transitionOrder(tx, ORDER_ID, 'DELIVERED', SUPPLIER))
    ).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_TRANSITION' });
    expect((await reload()).status).toBe('CANCELLED');
  });

  it('still refuses other impossible steps through sync', async () => {
    await insertOrder('IN_DELIVERY');
    await expect(
      run((tx) =>
        transitionOrder(
          tx,
          ORDER_ID,
          'CANCELLED',
          SUPPLIER,
          { cancellationReason: 'x' },
          {
            viaSync: true,
          }
        )
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_TRANSITION' });
  });
});

describe('skipping a step (AB-1, WSTG-BUSL-06)', () => {
  it('answers 409 for PENDING to DELIVERED and leaves the order unchanged', async () => {
    await insertOrder('PENDING');
    const before = await reload();
    await expect(
      run((tx) => transitionOrder(tx, ORDER_ID, 'DELIVERED', SUPPLIER))
    ).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_TRANSITION' });
    expect(await reload()).toEqual(before);
  });
});
