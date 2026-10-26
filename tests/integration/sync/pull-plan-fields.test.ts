import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const OWNER = '0199e037-0000-7000-8000-000000000001';
const SELLER = '0199e037-0000-7000-8000-000000000002';
const DRIVER = '0199e037-0000-7000-8000-000000000003';
const CUSTOMER_PERSON = '0199e037-0000-7000-8000-000000000004';
const CUSTOMER_OWNER = '0199e037-0000-7000-8000-000000000005';
const SUPPLIER_OWNER = '0199e037-0000-7000-8000-000000000006';
const ORG = '0199e037-0000-7000-8000-0000000000a1';
const CUSTOMER_ORG = '0199e037-0000-7000-8000-0000000000b1';
const SUPPLIER_ORG = '0199e037-0000-7000-8000-0000000000c1';
const DEVICE = '0199e037-0000-7000-8000-000000000701';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const DUE = new Date('2027-01-12T00:00:00.000Z');

type Row = Record<string, unknown>;
type Changes = { created: Row[]; updated: Row[]; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const pull = async (personId: string, query = ''): Promise<PullBody> => {
  const response = await createAuthenticatedRequest(app, personId).get(
    `/api/v1/sync/pull${query}`
  );
  expect(response.status).toBe(200);
  return bodyOf<PullBody>(response);
};

const PLAN_KEYS = [
  'payment_code',
  'plan',
  'plan_ends_at',
  'grace_ends_at',
  'max_collaborators',
  'max_products',
];

describe('GET /api/v1/sync/pull (plan fields of the organization)', () => {
  beforeEach(async () => {
    const people: Array<[string, string, string]> = [
      [OWNER, '+237600003701', 'Owner'],
      [SELLER, '+237600003702', 'Seller'],
      [DRIVER, '+237600003703', 'Driver'],
      [CUSTOMER_PERSON, '+237600003704', 'Customer person'],
      [CUSTOMER_OWNER, '+237600003705', 'Customer owner'],
      [SUPPLIER_OWNER, '+237600003706', 'Supplier owner'],
    ];
    for (const [id, phoneNumber, fullName] of people) {
      await prisma.person.create({
        data: {
          id,
          phoneNumber,
          fullName,
          phoneVerifiedAt: LONG_AGO,
          passwordHash: 'test-password-hash',
          registeredAt: LONG_AGO,
          createdAt: LONG_AGO,
        },
      });
    }
    await prisma.device.create({
      data: { id: DEVICE, personId: OWNER, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    await prisma.organization.createMany({
      data: [
        {
          id: ORG,
          name: 'Business',
          createdAt: LONG_AGO,
          plan: 'PRO',
          planEndsAt: DUE,
          maxCollaborators: 10,
          maxProducts: null,
        },
        { id: CUSTOMER_ORG, name: 'Customer business', createdAt: LONG_AGO },
        { id: SUPPLIER_ORG, name: 'Supplier business', createdAt: LONG_AGO },
      ],
    });
    const members: Array<[string, string, string, 'OWNER' | 'SELLER' | 'DRIVER']> = [
      ['a2', OWNER, ORG, 'OWNER'],
      ['a3', SELLER, ORG, 'SELLER'],
      ['a4', DRIVER, ORG, 'DRIVER'],
      ['b2', CUSTOMER_OWNER, CUSTOMER_ORG, 'OWNER'],
      ['c2', SUPPLIER_OWNER, SUPPLIER_ORG, 'OWNER'],
    ];
    for (const [suffix, personId, organizationId, role] of members) {
      await prisma.collaboration.create({
        data: {
          id: `0199e037-0000-7000-8000-0000000000${suffix}`,
          personId,
          organizationId,
          role,
          status: 'ACTIVE',
          invitedAt: LONG_AGO,
          acceptedAt: LONG_AGO,
        },
      });
    }
    // ORG supplies a particular customer and a customer business; a supplier business supplies ORG.
    await prisma.customerRelationship.create({
      data: {
        id: '0199e037-0000-7000-8000-0000000000d1',
        supplierOrganizationId: ORG,
        customerPersonId: CUSTOMER_PERSON,
        createdById: OWNER,
        createdAt: LONG_AGO,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        id: '0199e037-0000-7000-8000-0000000000d2',
        supplierOrganizationId: ORG,
        customerOrganizationId: CUSTOMER_ORG,
        createdById: OWNER,
        createdAt: LONG_AGO,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        id: '0199e037-0000-7000-8000-0000000000d3',
        supplierOrganizationId: SUPPLIER_ORG,
        customerOrganizationId: ORG,
        createdById: SUPPLIER_OWNER,
        createdAt: LONG_AGO,
      },
    });
  });

  it('sends the six fields to the owner, a seller and a driver (AC-1, C-41)', async () => {
    const code = (await prisma.organization.findUniqueOrThrow({ where: { id: ORG } })).paymentCode;
    for (const viewer of [OWNER, SELLER, DRIVER]) {
      const { changes } = await pull(viewer);
      const rows = changes['organizations']?.created ?? [];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: ORG,
        payment_code: code,
        plan: 'PRO',
        plan_ends_at: DUE.getTime(),
        grace_ends_at: null,
        max_collaborators: 10,
        max_products: null,
      });
      for (const key of PLAN_KEYS) expect(rows[0]).toHaveProperty(key);
    }
  });

  it('sends a null due date and the free limits for a FREE business (AC-2)', async () => {
    const { changes } = await pull(CUSTOMER_OWNER);
    expect(changes['organizations']?.created[0]).toMatchObject({
      id: CUSTOMER_ORG,
      plan: 'FREE',
      plan_ends_at: null,
      grace_ends_at: null,
      max_collaborators: 2,
      max_products: 30,
    });
  });

  it('sends the grace date and leaves the plan unchanged (AC-3)', async () => {
    const dueThreeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    const graceEnd = new Date(Date.now() + 4 * 86_400_000);
    await prisma.organization.update({
      where: { id: ORG },
      data: { planEndsAt: dueThreeDaysAgo, graceEndsAt: graceEnd },
    });

    const { changes } = await pull(OWNER);

    expect(changes['organizations']?.created[0]).toMatchObject({
      plan: 'PRO',
      plan_ends_at: dueThreeDaysAgo.getTime(),
      grace_ends_at: graceEnd.getTime(),
    });
  });

  it('lists the organization as updated with the new due date after a renewal (AC-4)', async () => {
    const lastPulledAt = await pulledAtAfterSeeding();
    const renewed = new Date('2027-02-12T00:00:00.000Z');
    await prisma.organization.update({ where: { id: ORG }, data: { planEndsAt: renewed } });

    const { changes } = await pull(SELLER, `?last_pulled_at=${lastPulledAt}`);

    expect(changes['organizations']?.created).toEqual([]);
    expect(changes['organizations']?.updated).toHaveLength(1);
    expect(changes['organizations']?.updated[0]).toMatchObject({
      id: ORG,
      plan_ends_at: renewed.getTime(),
    });
  });

  it('forbids a pushed organization row with another plan and keeps the plan (AC-5)', async () => {
    const response = await createAuthenticatedRequest(app, OWNER, DEVICE)
      .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
      .send({
        changes: {
          organizations: {
            created: [],
            updated: [{ id: ORG, plan: 'ENTERPRISE', max_products: 9999 }],
            deleted: [],
          },
        },
      });

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).toContain('SYNC_TABLE_READ_ONLY');
    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: ORG } });
    expect(stored.plan).toBe('PRO');
    expect(stored.maxProducts).toBeNull();
  });

  it('sends no plan field of the business to its customers or its supplier (AB-1, CWE-200)', async () => {
    const serializedFor = async (viewer: string) => {
      const { changes } = await pull(viewer);
      return { changes, text: JSON.stringify(changes) };
    };
    const code = (await prisma.organization.findUniqueOrThrow({ where: { id: ORG } })).paymentCode;

    for (const viewer of [CUSTOMER_PERSON, CUSTOMER_OWNER, SUPPLIER_OWNER]) {
      const { changes, text } = await serializedFor(viewer);
      const organizationIds = (changes['organizations']?.created ?? []).map((r) => r['id']);
      expect(organizationIds).not.toContain(ORG);
      expect(text).not.toContain(code);
      expect(text).not.toContain(String(DUE.getTime()));
      expect(text).not.toContain('"PRO"');
      expect(text).not.toContain('"max_collaborators":10');
    }
    const particular = await serializedFor(CUSTOMER_PERSON);
    expect(particular.changes['organizations']).toEqual({ created: [], updated: [], deleted: [] });
    expect(particular.text).not.toContain('payment_code');
  });

  it('sends the organization to its own members only once the membership is active (AB-1, v5.0.0-8.2.2)', async () => {
    await prisma.collaboration.update({
      where: { id: '0199e037-0000-7000-8000-0000000000a3' },
      data: { status: 'REVOKED' },
    });

    const { changes } = await pull(SELLER);

    expect(changes['organizations']?.created).toEqual([]);
  });
});
