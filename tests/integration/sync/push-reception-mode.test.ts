import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const SELLER = '0199e049-0000-7000-8000-000000000001';
const OWNER = '0199e049-0000-7000-8000-000000000004';
const CUSTOMER = '0199e049-0000-7000-8000-000000000006';
const ORG = '0199e049-0000-7000-8000-0000000000a1';
const REL = '0199e049-0000-7000-8000-0000000000c1';
const DEVICE = '0199e049-0000-7000-8000-000000000701';
const ORDER = '0199e049-0000-7000-8000-000000000501';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type PushBody = { accepted: number; rejected: Array<{ code: string }>; aside: number };

const push = async (orders: { created?: unknown[]; updated?: unknown[] }) =>
  createAuthenticatedRequest(app, SELLER, DEVICE)
    .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
    .send({ changes: { orders: { created: [], updated: [], deleted: [], ...orders } } });

const orderRow = (extra: Record<string, unknown> = {}) => ({
  id: ORDER,
  customer_relationship_id: REL,
  delivery_address_applied: 'Rue 1',
  delivery_cost: 0,
  desired_delivery_date: null,
  customer_note: null,
  created_at: Date.parse('2026-09-30T08:00:00.000Z'),
  ...extra,
});

const withoutAddress = () => {
  const row: Record<string, unknown> = orderRow();
  delete row['delivery_address_applied'];
  return row;
};

async function seedPerson(id: string, phone: string, registered: boolean) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Push Person',
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      ...(registered
        ? {
            email: `${phone.slice(1)}@example.test`,
            passwordHash: 'test-password-hash',
            registeredAt: LONG_AGO,
          }
        : {}),
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
}

const stored = () => prisma.order.findUnique({ where: { id: ORDER } });

describe('push of orders: reception mode (SYNC-049)', () => {
  beforeEach(async () => {
    await seedPerson(SELLER, '+237600004901', true);
    await seedPerson(OWNER, '+237600004904', true);
    await seedPerson(CUSTOMER, '+237600004906', false);
    await prisma.device.create({
      data: { id: DEVICE, personId: SELLER, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    await prisma.organization.create({ data: { id: ORG, name: 'Org', createdAt: LONG_AGO } });
    for (const [suffix, personId, role] of [
      ['04', OWNER, 'OWNER'],
      ['01', SELLER, 'SELLER'],
    ] as const) {
      await prisma.collaboration.create({
        data: {
          id: `0199e049-0000-7000-8000-0000000001${suffix}`,
          personId,
          organizationId: ORG,
          role,
          status: 'ACTIVE',
          invitedAt: LONG_AGO,
          acceptedAt: LONG_AGO,
        },
      });
    }
    await prisma.customerRelationship.create({
      data: {
        id: REL,
        supplierOrganizationId: ORG,
        customerPersonId: CUSTOMER,
        createdById: OWNER,
        createdAt: LONG_AGO,
        deliveryAddress: 'Rue 1',
      },
    });
  });

  it.each([
    ['DELIVERY', 'Rue 1', 'DELIVERY', 'Rue 1'],
    ['PICKUP', undefined, 'PICKUP', null],
    [undefined, 'Rue 1', null, 'Rue 1'],
    [null, 'Rue 1', null, 'Rue 1'],
  ])(
    'stores mode %s with address %s as %s / %s (AC-1, C-60)',
    async (mode, address, expectedMode, expectedAddress) => {
      const row = address === undefined ? withoutAddress() : orderRow();
      const response = await push({
        created: [mode === undefined ? row : { ...row, reception_mode: mode }],
      });

      expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, rejected: [], aside: 0 });
      expect(await stored()).toMatchObject({
        receptionMode: expectedMode,
        deliveryAddressApplied: expectedAddress,
      });
    }
  );

  it('refuses PICKUP with an address and stores nothing (AC-1, C-60)', async () => {
    const response = await push({ created: [orderRow({ reception_mode: 'PICKUP' })] });

    expect(bodyOf<PushBody>(response).accepted).toBe(0);
    expect(await stored()).toBeNull();
  });

  it.each(['COURIER', 'delivery', 42, ''])(
    'refuses the unknown mode %j and stores nothing (AB-1)',
    async (mode) => {
      const response = await push({ created: [orderRow({ reception_mode: mode })] });

      expect(bodyOf<PushBody>(response).accepted).toBe(0);
      expect(await stored()).toBeNull();
    }
  );

  it('never changes the mode of an existing order on an update (AC-2)', async () => {
    await push({ created: [orderRow({ reception_mode: 'DELIVERY' })] });
    expect((await stored())?.receptionMode).toBe('DELIVERY');

    await push({
      updated: [{ id: ORDER, reception_mode: 'PICKUP', supplier_note: 'Note' }],
    });

    expect((await stored())?.receptionMode).toBe('DELIVERY');
  });
});
