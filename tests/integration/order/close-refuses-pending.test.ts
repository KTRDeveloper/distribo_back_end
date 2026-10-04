import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const failing = vi.hoisted(() => ({ notifyOnStatusChange: false }));

vi.mock('../../../src/modules/notification/notification.service.js', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('../../../src/modules/notification/notification.service.js')
    >();
  return {
    ...original,
    notify: (...args: Parameters<typeof original.notify>) => {
      if (failing.notifyOnStatusChange && args[0].sourceEvent === 'order.status_changed') {
        throw new Error('forced notification failure');
      }
      return original.notify(...args);
    },
  };
});

const OWNER = '0199c018-0000-7000-8000-000000000001';
const CUSTOMER_1 = '0199c018-0000-7000-8000-000000000002';
const CUSTOMER_2 = '0199c018-0000-7000-8000-000000000003';
const CUSTOMER_3 = '0199c018-0000-7000-8000-000000000004';
const GUEST = '0199c018-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c018-0000-7000-8000-000000000006';

const ORG = '0199c018-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c018-0000-7000-8000-0000000000b1';
const OWNER_ROW = '0199c018-0000-7000-8000-0000000000a9';
const OTHER_OWNER_ROW = '0199c018-0000-7000-8000-0000000000b9';

const REL_1 = '0199c018-0000-7000-8000-000000000021';
const REL_2 = '0199c018-0000-7000-8000-000000000022';
const REL_3 = '0199c018-0000-7000-8000-000000000023';
const REL_GUEST = '0199c018-0000-7000-8000-000000000024';
const REL_OTHER = '0199c018-0000-7000-8000-000000000025';

const PENDING_1 = '0199c018-0000-7000-8000-000000000031';
const PENDING_2 = '0199c018-0000-7000-8000-000000000032';
const CONFIRMED = '0199c018-0000-7000-8000-000000000033';
const DELIVERED = '0199c018-0000-7000-8000-000000000034';
const PENDING_GUEST = '0199c018-0000-7000-8000-000000000035';
const PENDING_OTHER = '0199c018-0000-7000-8000-000000000036';

const GESTURE = '0199c018-0000-7000-8000-0000000000c1';
const REG = new Date('2026-01-01T00:00:00.000Z');
const REASON = 'Commerce fermé';

type Status = 'PENDING' | 'CONFIRMED' | 'DELIVERED';

async function seedPerson(id: string, phone: string, registered = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      ...(registered
        ? { phoneVerifiedAt: REG, passwordHash: 'test-password-hash', registeredAt: REG }
        : {}),
    },
  });
}

async function seedRelationship(id: string, organizationId: string, customerId: string) {
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${id}::uuid, ${organizationId}::uuid, ${customerId}::uuid, ${OWNER}::uuid)
  `;
}

async function seedOrder(id: string, relationshipId: string, status: Status) {
  const delivered = status === 'DELIVERED';
  await prisma.$executeRaw`
    INSERT INTO orders (
      id, customer_relationship_id, placed_by_party, entered_by_id, total_amount, status,
      delivered_at, delivered_by_id
    )
    VALUES (
      ${id}::uuid, ${relationshipId}::uuid, 'CUSTOMER'::public."OrderParty", ${OWNER}::uuid, 0,
      ${status}::text::public."OrderStatus",
      ${delivered ? REG : null}::timestamptz, ${delivered ? OWNER : null}::uuid
    )
  `;
}

const close = () =>
  createAuthenticatedRequest(app, OWNER)
    .post(`/api/v1/organizations/${ORG}/close`)
    .send({ id: GESTURE });

const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
const orgStatus = () =>
  prisma.organization.findUniqueOrThrow({ where: { id: ORG } }).then((o) => o.status);
const statusNotifications = (recipientId: string) =>
  prisma.notification.findMany({
    where: { recipientId, sourceEvent: 'order.status_changed' },
  });

beforeEach(async () => {
  failing.notifyOnStatusChange = false;
  await seedPerson(OWNER, '+237600180001');
  await seedPerson(CUSTOMER_1, '+237600180002');
  await seedPerson(CUSTOMER_2, '+237600180003');
  await seedPerson(CUSTOMER_3, '+237600180004');
  await seedPerson(GUEST, '+237600180005', false);
  await seedPerson(OTHER_OWNER, '+237600180006');
  await prisma.organization.create({ data: { id: ORG, name: 'Org' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other Org' } });
  await prisma.collaboration.create({
    data: {
      id: OWNER_ROW,
      personId: OWNER,
      organizationId: ORG,
      role: 'OWNER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  await prisma.collaboration.create({
    data: {
      id: OTHER_OWNER_ROW,
      personId: OTHER_OWNER,
      organizationId: OTHER_ORG,
      role: 'OWNER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  await seedRelationship(REL_1, ORG, CUSTOMER_1);
  await seedRelationship(REL_2, ORG, CUSTOMER_2);
  await seedRelationship(REL_3, ORG, CUSTOMER_3);
  await seedRelationship(REL_GUEST, ORG, GUEST);
  await seedRelationship(REL_OTHER, OTHER_ORG, CUSTOMER_1);
});

describe('closing a business refuses its pending orders', () => {
  it('AC-1 pending orders are refused with the reason and the others are unchanged', async () => {
    await seedOrder(PENDING_1, REL_1, 'PENDING');
    await seedOrder(PENDING_2, REL_2, 'PENDING');
    await seedOrder(CONFIRMED, REL_3, 'CONFIRMED');
    await seedOrder(DELIVERED, REL_3, 'DELIVERED');

    expect((await close()).status).toBe(200);

    for (const id of [PENDING_1, PENDING_2]) {
      const order = await orderOf(id);
      expect(order.status).toBe('CANCELLED');
      expect(order.cancelledByParty).toBe('SUPPLIER');
      expect(order.cancelledById).toBe(OWNER);
      expect(order.cancelledAt).not.toBeNull();
      expect(order.cancellationReason).toBe(REASON);
    }
    for (const [id, status] of [
      [CONFIRMED, 'CONFIRMED'],
      [DELIVERED, 'DELIVERED'],
    ] as const) {
      const order = await orderOf(id);
      expect(order.status).toBe(status);
      expect(order.cancelledAt).toBeNull();
      expect(order.cancellationReason).toBeNull();
    }
  });

  it('AC-1 a pending order of another business is untouched', async () => {
    await seedOrder(PENDING_OTHER, REL_OTHER, 'PENDING');

    await close();

    expect((await orderOf(PENDING_OTHER)).status).toBe('PENDING');
  });

  it('AC-2 each customer of a refused order has one unread order.status_changed', async () => {
    await seedOrder(PENDING_1, REL_1, 'PENDING');
    await seedOrder(PENDING_2, REL_2, 'PENDING');
    await seedOrder(CONFIRMED, REL_3, 'CONFIRMED');

    await close();

    for (const [customer, orderId] of [
      [CUSTOMER_1, PENDING_1],
      [CUSTOMER_2, PENDING_2],
    ] as const) {
      const notifications = await statusNotifications(customer);
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.readStatus).toBe('UNREAD');
      expect(notifications[0]?.organizationId).toBe(ORG);
      expect(notifications[0]?.relatedEntityType).toBe('order');
      expect(notifications[0]?.relatedEntityId).toBe(orderId);
    }
    expect(await statusNotifications(CUSTOMER_3)).toHaveLength(0);
  });

  it('AC-2 a guest customer is refused without a notification and the close succeeds', async () => {
    await seedOrder(PENDING_GUEST, REL_GUEST, 'PENDING');

    expect((await close()).status).toBe(200);

    expect((await orderOf(PENDING_GUEST)).status).toBe('CANCELLED');
    expect(await statusNotifications(GUEST)).toHaveLength(0);
  });

  it('AC-3 a failing refusal leaves the organization ACTIVE and every order unchanged', async () => {
    await seedOrder(PENDING_1, REL_1, 'PENDING');
    await seedOrder(PENDING_2, REL_2, 'PENDING');
    await seedOrder(CONFIRMED, REL_3, 'CONFIRMED');
    failing.notifyOnStatusChange = true;

    expect((await close()).status).toBe(500);

    expect(await orgStatus()).toBe('ACTIVE');
    expect((await orderOf(PENDING_1)).status).toBe('PENDING');
    expect((await orderOf(PENDING_2)).status).toBe('PENDING');
    expect((await orderOf(CONFIRMED)).status).toBe('CONFIRMED');
    expect((await orderOf(PENDING_1)).cancellationReason).toBeNull();
    expect(
      (await prisma.collaboration.findUniqueOrThrow({ where: { id: OWNER_ROW } })).status
    ).toBe('ACTIVE');
  });

  it('AC-4 no pending order: closing works as before', async () => {
    await seedOrder(CONFIRMED, REL_3, 'CONFIRMED');

    const response = await close();

    expect(response.status).toBe(200);
    expect(await orgStatus()).toBe('CLOSED');
    expect((await orderOf(CONFIRMED)).status).toBe('CONFIRMED');
    expect(await statusNotifications(CUSTOMER_3)).toHaveLength(0);
  });
});
