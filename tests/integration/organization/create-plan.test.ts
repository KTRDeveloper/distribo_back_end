import { beforeEach, describe, expect, it, vi } from 'vitest';

const codes = vi.hoisted(() => ({ draw: undefined as undefined | (() => string) }));

vi.mock('../../../src/lib/payment-code.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/lib/payment-code.js')>();
  return {
    ...original,
    generatePaymentCode: vi.fn(() => (codes.draw ? codes.draw() : original.generatePaymentCode())),
  };
});

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: vi.fn(() => Promise.resolve({ allowed: true, remaining: 10 })),
}));

import { app } from '../../../src/app.js';
import { generatePaymentCode } from '../../../src/lib/payment-code.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const CREATOR = '0199c028-0000-7000-8000-000000000001';
const OWNER = '0199c028-0000-7000-8000-000000000002';
const OUTSIDER = '0199c028-0000-7000-8000-000000000003';
const REG = new Date('2026-01-01T00:00:00.000Z');
const SHAPE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;
const TAKEN = 'AAAAAAAA';

type View = {
  id: string;
  payment_code: string;
  plan: string;
  plan_ends_at: string | null;
  grace_ends_at: string | null;
  max_collaborators: number | null;
  max_products: number | null;
} & Record<string, unknown>;

const PLAN_KEYS = [
  'payment_code',
  'plan',
  'plan_ends_at',
  'grace_ends_at',
  'max_collaborators',
  'max_products',
];

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
}

/** Seeds a business holding `TAKEN` as its payment code. */
async function seedTakenCodeOrg() {
  await prisma.organization.create({
    data: {
      id: newId(),
      name: 'Holder of the code',
      paymentCode: TAKEN,
      collaborations: {
        create: {
          id: newId(),
          personId: OWNER,
          role: 'OWNER',
          status: 'ACTIVE',
          acceptedAt: REG,
        },
      },
    },
  });
}

function post(body: unknown, personId = CREATOR) {
  return createAuthenticatedRequest(app, personId)
    .post('/api/v1/organizations')
    .send(body as object);
}

beforeEach(async () => {
  codes.draw = undefined;
  vi.mocked(generatePaymentCode).mockClear();
  await seedPerson(CREATOR, '+237600028001');
  await seedPerson(OWNER, '+237600028002');
  await seedPerson(OUTSIDER, '+237600028003');
});

describe('POST /api/v1/organizations plan fields', () => {
  it('starts the business on the free plan (AC-1, C-41)', async () => {
    const id = newId();
    const response = await post({ id, name: 'Fresh' });

    expect(response.status).toBe(201);
    const body = bodyOf<View>(response);
    expect(body).toMatchObject({
      plan: 'FREE',
      plan_ends_at: null,
      grace_ends_at: null,
      max_collaborators: 2,
      max_products: 30,
    });
    expect(body).not.toHaveProperty('email');
    const stored = await prisma.organization.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({
      plan: 'FREE',
      planEndsAt: null,
      graceEndsAt: null,
      maxCollaborators: 2,
      maxProducts: 30,
      paymentCode: body.payment_code,
    });
  });

  it('gives a code of 8 symbols from the fixed alphabet (AC-2)', async () => {
    const response = await post({ id: newId(), name: 'Shape' });

    expect(response.status).toBe(201);
    expect(bodyOf<View>(response).payment_code).toMatch(SHAPE);
  });

  it('draws again when the first code is taken (AC-3)', async () => {
    await seedTakenCodeOrg();
    const draws = [TAKEN, 'BBBBBBBB'];
    codes.draw = () => draws.shift() ?? 'CCCCCCCC';

    const id = newId();
    const response = await post({ id, name: 'Second draw' });

    expect(response.status).toBe(201);
    expect(bodyOf<View>(response).payment_code).toBe('BBBBBBBB');
    const stored = await prisma.organization.findUniqueOrThrow({ where: { id } });
    expect(stored.paymentCode).toBe('BBBBBBBB');
    expect(await prisma.collaboration.count({ where: { organizationId: id } })).toBe(1);
    expect(await prisma.customerRelationship.count({ where: { supplierOrganizationId: id } })).toBe(
      1
    );
  });

  it('stops after five taken codes and stores nothing (AC-4)', async () => {
    await seedTakenCodeOrg();
    codes.draw = () => TAKEN;
    const before = {
      organizations: await prisma.organization.count(),
      collaborations: await prisma.collaboration.count(),
      counters: await prisma.customerRelationship.count(),
    };

    const id = newId();
    const response = await post({ id, name: 'Never stored' });

    expect(response.status).toBe(500);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('INTERNAL_ERROR');
    expect(generatePaymentCode).toHaveBeenCalledTimes(5);
    expect(await prisma.organization.count()).toBe(before.organizations);
    expect(await prisma.collaboration.count()).toBe(before.collaborations);
    expect(await prisma.customerRelationship.count()).toBe(before.counters);
    const person = await prisma.person.findUniqueOrThrow({ where: { id: CREATOR } });
    expect(person.scopeVersion).toBe(0);
  });

  it('does not retry another unique violation (C-41)', async () => {
    const id = newId();
    await prisma.organization.create({ data: { id, name: 'Same id' } });

    const response = await post({ id, name: 'Clash on the id' });

    expect(response.status).toBe(500);
    expect(generatePaymentCode).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['email', 'a@b.cm'],
    ['payment_code', 'ZZZZZZZZ'],
    ['plan', 'PRO'],
    ['max_collaborators', 99],
    ['max_products', 99],
  ])('refuses %s in the body (AC-5)', async (field, value) => {
    const response = await post({ id: newId(), name: 'Forced', [field]: value });

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.organization.count()).toBe(0);
  });

  it('shows the six plan fields to an ACTIVE member (AC-6)', async () => {
    const id = newId();
    const created = await post({ id, name: 'Team view' });
    expect(created.status).toBe(201);

    const response = await createAuthenticatedRequest(app, CREATOR).get(
      `/api/v1/organizations/${id}`
    );

    expect(response.status).toBe(200);
    const body = bodyOf<View>(response);
    for (const key of PLAN_KEYS) expect(body).toHaveProperty(key);
    expect(body.payment_code).toBe(bodyOf<View>(created).payment_code);
    expect(body).not.toHaveProperty('email');
  });
});

describe('plan fields are for the team only (AB-1, CWE-200)', () => {
  async function seedOrgWithMember(status: 'INVITED' | 'REVOKED' | 'PAUSED' | null) {
    const id = newId();
    await prisma.organization.create({
      data: {
        id,
        name: 'Secret plan',
        description: 'About',
        collaborations: {
          create: [
            {
              id: newId(),
              personId: OWNER,
              role: 'OWNER',
              status: 'ACTIVE',
              acceptedAt: REG,
            },
            ...(status
              ? [
                  {
                    id: newId(),
                    personId: OUTSIDER,
                    role: 'MANAGER' as const,
                    status,
                    acceptedAt: status === 'INVITED' ? null : REG,
                  },
                ]
              : []),
          ],
        },
      },
    });
    return id;
  }

  it.each([null, 'INVITED', 'REVOKED', 'PAUSED'] as const)(
    'answers 404 to a person whose membership is %s',
    async (status) => {
      const id = await seedOrgWithMember(status);

      const response = await createAuthenticatedRequest(app, OUTSIDER).get(
        `/api/v1/organizations/${id}`
      );

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(JSON.stringify(response.body)).not.toContain('payment_code');
    }
  );

  it('keeps the lookup item to id, name and description', async () => {
    const id = await seedOrgWithMember(null);
    await prisma.organizationContact.create({
      data: {
        id: newId(),
        organizationId: id,
        kind: 'PHONE',
        slot: 1,
        value: '+237677123456',
        createdById: OWNER,
        verifiedAt: REG,
        verificationMethod: 'CODE',
      },
    });

    const response = await createAuthenticatedRequest(app, OUTSIDER)
      .get('/api/v1/organizations/lookup')
      .query({ phone: '+237677123456' });

    expect(response.status).toBe(200);
    const items = bodyOf<{ items: Array<Record<string, unknown>> }>(response).items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(id);
    expect(Object.keys(items[0]).sort()).toEqual(['description', 'id', 'name']);
  });
});
