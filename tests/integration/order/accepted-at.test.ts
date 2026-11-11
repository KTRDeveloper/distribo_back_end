import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { transitionOrder } from '../../../src/modules/order/order.state.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { RECEIPT_FIELDS } from '../../helpers/receipt-fields.js';
import { prisma } from '../../setup.js';

const SELLER = '0199c023-0000-7000-8000-000000000001';
const CUSTOMER = '0199c023-0000-7000-8000-000000000002';
const OWNER = '0199c023-0000-7000-8000-000000000003';
const SUPPLIER = '0199c023-0000-7000-8000-0000000000a1';
const REL = '0199c023-0000-7000-8000-0000000000e1';
const ORDER_ID = '0199c023-0000-7000-8000-0000000000c1';
const GESTURE = '0199c023-0000-7000-8000-0000000000f1';
const GESTURE_2 = '0199c023-0000-7000-8000-0000000000f2';

const REG = new Date('2026-01-01T00:00:00.000Z');
const FIRST = new Date('2026-01-02T00:00:00.000Z');

type Status = 'PENDING' | 'CONFIRMED' | 'IN_DELIVERY' | 'DELIVERED' | 'CANCELLED';
type ViewBody = { id: string; status: string; accepted_at: string | null };

const TRANSITION_SUPPLIER = { personId: SELLER, party: 'SUPPLIER' } as const;

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
      preferredLanguage: 'EN',
    },
  });
}

/** Inserts an order with the columns its CHECKs require for `status`. */
async function seedOrder(
  status: Status,
  options: { placedBy?: 'CUSTOMER' | 'SUPPLIER'; acceptedAt?: Date | null } = {}
) {
  const placedBy = options.placedBy ?? 'CUSTOMER';
  const cancelled = status === 'CANCELLED';
  const delivered = status === 'DELIVERED';
  await prisma.order.create({
    data: {
      id: ORDER_ID,
      customerRelationshipId: REL,
      placedByParty: placedBy,
      enteredById: placedBy === 'CUSTOMER' ? CUSTOMER : SELLER,
      totalAmount: 0n,
      status,
      acceptedAt: options.acceptedAt ?? null,
      ...(cancelled
        ? {
            cancelledByParty: 'SUPPLIER' as const,
            cancelledById: SELLER,
            cancelledAt: REG,
            cancellationReason: 'Out of stock',
          }
        : {}),
      ...(delivered ? { deliveredAt: REG, deliveredById: SELLER, ...RECEIPT_FIELDS } : {}),
    },
  });
}

const run = <T>(fn: Parameters<typeof prisma.$transaction<T>>[0]) => prisma.$transaction(fn);
const reload = () => prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });

const supplierPost = (action: string, body: object) =>
  createAuthenticatedRequest(app, SELLER)
    .post(`/api/v1/organizations/${SUPPLIER}/orders/${ORDER_ID}/${action}`)
    .send(body);
const supplierView = () =>
  createAuthenticatedRequest(app, SELLER).get(
    `/api/v1/organizations/${SUPPLIER}/orders/${ORDER_ID}`
  );
const customerView = () =>
  createAuthenticatedRequest(app, CUSTOMER).get(`/api/v1/orders/${ORDER_ID}`);

beforeEach(async () => {
  await seedPerson(SELLER, '+237600023001');
  await seedPerson(CUSTOMER, '+237600023002');
  await seedPerson(OWNER, '+237600023003');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.collaboration.create({
    data: {
      id: '0199c023-0000-7000-8000-000000000102',
      personId: OWNER,
      organizationId: SUPPLIER,
      role: 'OWNER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  await prisma.collaboration.create({
    data: {
      id: '0199c023-0000-7000-8000-000000000101',
      personId: SELLER,
      organizationId: SUPPLIER,
      role: 'SELLER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: SELLER,
      status: 'ACTIVE',
    },
  });
});

describe('ORD-023 accepting an order records its date', () => {
  it('accept: records the server time and both views show it (AC-1, C-51)', async () => {
    await seedOrder('PENDING');
    const before = Date.now();

    const response = await supplierPost('accept', { id: GESTURE });

    expect(response.status).toBe(200);
    const stored = await reload();
    expect(stored.status).toBe('CONFIRMED');
    expect(stored.acceptedAt).toBeInstanceOf(Date);
    expect(stored.acceptedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(stored.acceptedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    const iso = stored.acceptedAt!.toISOString();
    expect(bodyOf<ViewBody>(response).accepted_at).toBe(iso);
    expect(bodyOf<ViewBody>(await supplierView()).accepted_at).toBe(iso);
    expect(bodyOf<ViewBody>(await customerView()).accepted_at).toBe(iso);
  });

  describe('failed attempt', () => {
    it('keeps an empty date for a supplier-entered order (AC-2)', async () => {
      await seedOrder('IN_DELIVERY', { placedBy: 'SUPPLIER' });
      await run((tx) => transitionOrder(tx, ORDER_ID, 'CONFIRMED', TRANSITION_SUPPLIER));
      const stored = await reload();
      expect(stored.status).toBe('CONFIRMED');
      expect(stored.acceptedAt).toBeNull();
    });

    it('keeps the date of an accepted order (AC-2)', async () => {
      await seedOrder('IN_DELIVERY', { acceptedAt: FIRST });
      await run((tx) => transitionOrder(tx, ORDER_ID, 'CONFIRMED', TRANSITION_SUPPLIER));
      const stored = await reload();
      expect(stored.status).toBe('CONFIRMED');
      expect(stored.acceptedAt).toEqual(FIRST);
    });
  });

  describe('not pending', () => {
    it.each<Status>(['CONFIRMED', 'IN_DELIVERY', 'DELIVERED', 'CANCELLED'])(
      'answers 409 INVALID_TRANSITION from %s and changes nothing (AC-3)',
      async (status) => {
        await seedOrder(status, { acceptedAt: status === 'CANCELLED' ? null : FIRST });

        await expect(
          run((tx) =>
            transitionOrder(tx, ORDER_ID, 'CONFIRMED', TRANSITION_SUPPLIER, {
              acceptedAt: new Date(),
            })
          )
        ).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_TRANSITION' });

        const stored = await reload();
        expect(stored.status).toBe(status);
        expect(stored.acceptedAt).toEqual(status === 'CANCELLED' ? null : FIRST);
      }
    );
  });

  describe('refuse and cancel', () => {
    it('leaves the date empty when a pending order is refused (AC-4)', async () => {
      await seedOrder('PENDING');

      const response = await supplierPost('refuse', { id: GESTURE, reason: 'Out of stock' });

      expect(response.status).toBe(200);
      const stored = await reload();
      expect(stored.status).toBe('CANCELLED');
      expect(stored.acceptedAt).toBeNull();
      expect(bodyOf<ViewBody>(await customerView()).accepted_at).toBeNull();
    });

    it('keeps the date when an accepted order is cancelled (AC-4)', async () => {
      await seedOrder('PENDING');
      await supplierPost('accept', { id: GESTURE });
      const accepted = (await reload()).acceptedAt;

      const response = await supplierPost('cancel', { id: GESTURE_2, reason: 'Out of stock' });

      expect(response.status).toBe(200);
      const stored = await reload();
      expect(stored.status).toBe('CANCELLED');
      expect(stored.acceptedAt).toEqual(accepted);
      expect(accepted).not.toBeNull();
    });
  });

  describe('views', () => {
    it('shows null to both parties for a supplier-entered order (AC-5)', async () => {
      await seedOrder('CONFIRMED', { placedBy: 'SUPPLIER' });

      const supplier = bodyOf<ViewBody>(await supplierView());
      const customer = bodyOf<ViewBody>(await customerView());

      expect(supplier).toHaveProperty('accepted_at', null);
      expect(customer).toHaveProperty('accepted_at', null);
    });

    it('lists accepted_at as a string or null in both order views (AC-5)', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      expect(response.status).toBe(200);
      const paths = (
        response.body as {
          paths: Record<
            string,
            Record<
              string,
              {
                responses?: Record<
                  string,
                  { content?: { 'application/json'?: { schema?: unknown } } }
                >;
              }
            >
          >;
        }
      ).paths;
      const schemaOf = (path: string) => {
        const schema = paths[path]?.get?.responses?.['200']?.content?.['application/json']?.schema;
        return JSON.parse(JSON.stringify(schema)) as {
          properties?: { accepted_at?: { type?: string | string[]; nullable?: boolean } };
        };
      };
      for (const path of [
        '/api/v1/orders/{orderId}',
        '/api/v1/organizations/{organizationId}/orders/{orderId}',
      ]) {
        const field = schemaOf(path).properties?.accepted_at;
        expect(field, path).toBeDefined();
        expect(field?.type === 'string' || field?.type?.includes('string')).toBe(true);
        expect(field?.nullable === true || field?.type?.includes('null')).toBe(true);
      }
    });
  });

  describe('second acceptance (AB-1, CWE-841)', () => {
    it('answers 409 INVALID_TRANSITION and keeps the first date', async () => {
      await seedOrder('PENDING');
      expect((await supplierPost('accept', { id: GESTURE })).status).toBe(200);
      const first = (await reload()).acceptedAt;

      const second = await supplierPost('accept', { id: GESTURE_2 });

      expect(second.status).toBe(409);
      expect(bodyOf<ErrorBody>(second).error.code).toBe('INVALID_TRANSITION');
      expect((await reload()).acceptedAt).toEqual(first);
    });

    it('lets only one of two parallel acceptances win (v5.0.0-2.3.1)', async () => {
      await seedOrder('PENDING');

      const results = await Promise.all([
        supplierPost('accept', { id: GESTURE }),
        supplierPost('accept', { id: GESTURE_2 }),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    });
  });
});
