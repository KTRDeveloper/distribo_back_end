import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const OWNER = '0199e038-0000-7000-8000-000000000001';
const SELLER = '0199e038-0000-7000-8000-000000000002';
const CUSTOMER = '0199e038-0000-7000-8000-000000000003';
const ORG = '0199e038-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199e038-0000-7000-8000-0000000000b1';
const COLLAB_OWNER = '0199e038-0000-7000-8000-0000000000a2';
const COLLAB_SELLER = '0199e038-0000-7000-8000-0000000000a3';
const RELATIONSHIP = '0199e038-0000-7000-8000-0000000000c1';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

const BASE = 'http://localhost:3000/images';
const LOGO_KEY = 'logos/3f2b8c1e-5d4a-4b6c-8e7f-1a2b3c4d5e6f.webp';
const NEW_LOGO_KEY = 'logos/9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d.webp';
const OWNER_KEY = 'avatars/4c3d2e1f-6a5b-4c7d-8e9f-0a1b2c3d4e5f.webp';
const CUSTOMER_KEY = 'avatars/5d4e3f2a-7b6c-4d8e-9fa0-1b2c3d4e5f60.webp';

type Rows = Array<Record<string, unknown>>;
type Changes = { created: Rows; updated: Rows; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const pull = (personId: string, query = '') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/sync/pull${query}`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seedPerson(id: string, phone: string, name: string, avatarKey: string | null) {
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
      avatarKey,
    },
  });
}

const rowOf = (rows: Rows | undefined, id: string) => rows?.find((r) => r['id'] === id);

describe('GET /api/v1/sync/pull (logo and profile photos)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600003801', 'Owner', OWNER_KEY);
    await seedPerson(SELLER, '+237600003802', 'Seller', null);
    await seedPerson(CUSTOMER, '+237600003803', 'Customer', CUSTOMER_KEY);
    await prisma.organization.create({
      data: { id: ORG, name: 'Org', createdAt: LONG_AGO, logoKey: LOGO_KEY },
    });
    await prisma.organization.create({
      data: { id: OTHER_ORG, name: 'Other', createdAt: LONG_AGO },
    });
    for (const [id, personId, role] of [
      [COLLAB_OWNER, OWNER, 'OWNER'],
      [COLLAB_SELLER, SELLER, 'SELLER'],
    ] as const) {
      await prisma.collaboration.create({
        data: {
          id,
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
        id: RELATIONSHIP,
        supplierOrganizationId: ORG,
        customerPersonId: CUSTOMER,
        createdById: SELLER,
        createdAt: LONG_AGO,
      },
    });
  });

  it('sends the logo address and never the key (AC-1, C-49)', async () => {
    const response = await pull(SELLER);

    expect(response.status).toBe(200);
    const row = bodyOf<PullBody>(response).changes['organizations']?.created[0];
    expect(row?.['logo_url']).toBe(`${BASE}/${LOGO_KEY}`);
    expect(row).not.toHaveProperty('logo_key');
  });

  it('sends null logo_url when the business has no logo (AC-1)', async () => {
    await prisma.organization.update({ where: { id: ORG }, data: { logoKey: null } });

    const row = bodyOf<PullBody>(await pull(SELLER)).changes['organizations']?.created[0];

    expect(row).toHaveProperty('logo_url', null);
  });

  it('sends avatar_url for a collaborator and a customer, null for a person without photo (AC-2)', async () => {
    const people = bodyOf<PullBody>(await pull(SELLER)).changes['people']?.created;

    expect(rowOf(people, OWNER)?.['avatar_url']).toBe(`${BASE}/${OWNER_KEY}`);
    expect(rowOf(people, CUSTOMER)?.['avatar_url']).toBe(`${BASE}/${CUSTOMER_KEY}`);
    expect(rowOf(people, SELLER)).toHaveProperty('avatar_url', null);
  });

  it('sends the replaced logo as updated with the new address (AC-3)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER));
    await sleep(20);
    await prisma.organization.update({ where: { id: ORG }, data: { logoKey: NEW_LOGO_KEY } });

    const { changes } = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${first.timestamp}`));

    expect(changes['organizations']?.created).toEqual([]);
    expect(changes['organizations']?.updated).toHaveLength(1);
    expect(changes['organizations']?.updated[0]).toMatchObject({
      id: ORG,
      logo_url: `${BASE}/${NEW_LOGO_KEY}`,
    });
  });

  it('sends a removed photo as updated with a null address (AC-3)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER));
    await sleep(20);
    await prisma.person.update({ where: { id: OWNER }, data: { avatarKey: null } });

    const { changes } = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${first.timestamp}`));

    expect(changes['people']?.updated).toHaveLength(1);
    expect(changes['people']?.updated[0]).toMatchObject({ id: OWNER, avatar_url: null });
  });

  it('sends null avatar_url for an anonymized person (AC-4)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER));
    await sleep(20);
    await prisma.$executeRaw`UPDATE people SET status = 'ANONYMIZED'::public."PersonStatus",
      anonymized_at = NOW(), released_phone_number = phone_number, phone_number = NULL,
      phone_verified_at = NULL, avatar_key = NULL WHERE id = ${CUSTOMER}::uuid`;

    const { changes } = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${first.timestamp}`));

    expect(rowOf(changes['people']?.updated, CUSTOMER)).toMatchObject({ avatar_url: null });
    expect(JSON.stringify(changes['people'])).not.toContain(CUSTOMER_KEY);
  });

  it.each([[OWNER], [SELLER]])(
    'carries no key field and only avatar_url as new people field (AB-1, CWE-200)',
    async (viewer) => {
      const { changes } = bodyOf<PullBody>(await pull(viewer));

      for (const person of changes['people']?.created ?? []) {
        expect(Object.keys(person).sort()).toEqual([
          'avatar_url',
          'full_name',
          'id',
          'phone_number',
        ]);
      }
      const serialized = JSON.stringify(changes);
      for (const key of [LOGO_KEY, OWNER_KEY, CUSTOMER_KEY]) {
        expect(serialized).not.toContain(`"${key}"`);
      }
      expect(serialized).not.toContain('logo_key');
      expect(serialized).not.toContain('avatar_key');
      expect(serialized).not.toContain('logoKey');
      expect(serialized).not.toContain('avatarKey');
    }
  );

  it('does not send the logo of an organization the viewer is not a member of (AB-1, v5.0.0-8.2.2)', async () => {
    await prisma.organization.update({ where: { id: OTHER_ORG }, data: { logoKey: NEW_LOGO_KEY } });

    const serialized = JSON.stringify(bodyOf<PullBody>(await pull(SELLER)).changes);

    expect(serialized).not.toContain(NEW_LOGO_KEY);
  });
});
