import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const OWNER = '0199e039-0000-7000-8000-000000000001';
const SELLER = '0199e039-0000-7000-8000-000000000002';
const OTHER_OWNER = '0199e039-0000-7000-8000-000000000003';
const ORGANIZATION = '0199e039-0000-7000-8000-0000000000a1';
const OTHER_ORGANIZATION = '0199e039-0000-7000-8000-0000000000b1';
const OWNER_COLLABORATION = '0199e039-0000-7000-8000-0000000000a2';
const SELLER_COLLABORATION = '0199e039-0000-7000-8000-0000000000a3';
const OTHER_COLLABORATION = '0199e039-0000-7000-8000-0000000000b2';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type Row = Record<string, unknown>;
type PullBody = {
  changes: Record<string, { created: Row[]; updated: Row[]; deleted: string[] }>;
};

async function pull(personId: string, query = ''): Promise<PullBody> {
  const response = await createAuthenticatedRequest(app, personId).get(
    `/api/v1/sync/pull${query}`
  );
  expect(response.status).toBe(200);
  return bodyOf<PullBody>(response);
}

describe('identity pull without removed organization fields (ORG-039)', () => {
  beforeEach(async () => {
    for (const [id, phoneNumber, fullName] of [
      [OWNER, '+237600003901', 'Owner'],
      [SELLER, '+237600003902', 'Seller'],
      [OTHER_OWNER, '+237600003903', 'Other owner'],
    ]) {
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
    await prisma.organization.createMany({
      data: [
        {
          id: ORGANIZATION,
          name: 'Organization',
          description: 'Organization description',
          createdAt: LONG_AGO,
        },
        { id: OTHER_ORGANIZATION, name: 'Other organization', createdAt: LONG_AGO },
      ],
    });
    await prisma.collaboration.createMany({
      data: [
        {
          id: OWNER_COLLABORATION,
          personId: OWNER,
          organizationId: ORGANIZATION,
          role: 'OWNER',
          status: 'ACTIVE',
          isPublicContact: true,
          invitedAt: LONG_AGO,
          acceptedAt: LONG_AGO,
          amountHeld: 5000n,
        },
        {
          id: SELLER_COLLABORATION,
          personId: SELLER,
          organizationId: ORGANIZATION,
          role: 'SELLER',
          status: 'ACTIVE',
          isPublicContact: true,
          invitedAt: LONG_AGO,
          acceptedAt: LONG_AGO,
          amountHeld: 1200n,
        },
        {
          id: OTHER_COLLABORATION,
          personId: OTHER_OWNER,
          organizationId: OTHER_ORGANIZATION,
          role: 'OWNER',
          status: 'ACTIVE',
          isPublicContact: true,
          invitedAt: LONG_AGO,
          acceptedAt: LONG_AGO,
          amountHeld: 9999n,
        },
      ],
    });
  });

  it('does not send the stored email in organization rows (AC-1)', async () => {
    const { changes } = await pull(SELLER);
    expect(changes['organizations']?.created).toHaveLength(1);
    expect(changes['organizations']?.created[0]).not.toHaveProperty('email');
  });

  it('does not send a stored true flag in collaboration rows (AC-2)', async () => {
    const { changes } = await pull(SELLER);
    expect(changes['collaborations']?.created).toHaveLength(2);
    for (const row of changes['collaborations']?.created ?? []) {
      expect(row).not.toHaveProperty('is_public_contact');
    }
  });

  it.each([OWNER, SELLER])('keeps all other keys and amount scope for %s (AC-3)', async (viewer) => {
    const { changes } = await pull(viewer);
    expect(changes['organizations']?.created).toEqual([
      {
        id: ORGANIZATION,
        name: 'Organization',
        description: 'Organization description',
        status: 'ACTIVE',
        created_at: LONG_AGO.getTime(),
        server_updated_at: expect.any(Number) as unknown,
      },
    ]);
    expect(changes['collaborations']?.created).toEqual([
      {
        id: OWNER_COLLABORATION,
        person_id: OWNER,
        organization_id: ORGANIZATION,
        role: 'OWNER',
        status: 'ACTIVE',
        invited_at: LONG_AGO.getTime(),
        accepted_at: LONG_AGO.getTime(),
        server_updated_at: expect.any(Number) as unknown,
        ...(viewer === OWNER ? { amount_held: 5000 } : {}),
      },
      {
        id: SELLER_COLLABORATION,
        person_id: SELLER,
        organization_id: ORGANIZATION,
        role: 'SELLER',
        status: 'ACTIVE',
        invited_at: LONG_AGO.getTime(),
        accepted_at: LONG_AGO.getTime(),
        server_updated_at: expect.any(Number) as unknown,
        amount_held: 1200,
      },
    ]);
  });

  it('never sends a flag from any table or a foreign business to either member (AB-1)', async () => {
    for (const viewer of [OWNER, SELLER]) {
      const { changes } = await pull(viewer);
      for (const change of Object.values(changes)) {
        for (const row of [...change.created, ...change.updated]) {
          expect(row).not.toHaveProperty('is_public_contact');
          expect(row['id']).not.toBe(OTHER_COLLABORATION);
          expect(row['id']).not.toBe(OTHER_ORGANIZATION);
          expect(row['id']).not.toBe(OTHER_OWNER);
        }
      }
    }
  });

  it('also omits removed fields from incremental updated rows (AC-1, AC-2)', async () => {
    const { changes } = await pull(SELLER, `?last_pulled_at=${LONG_AGO.getTime() + 1000}`);
    expect(changes['organizations']?.updated).toHaveLength(1);
    expect(changes['collaborations']?.updated).toHaveLength(2);
    expect(changes['organizations']?.created).toEqual([]);
    expect(changes['collaborations']?.created).toEqual([]);
    for (const change of Object.values(changes)) {
      for (const row of [...change.created, ...change.updated]) {
        expect(row).not.toHaveProperty('email');
        expect(row).not.toHaveProperty('is_public_contact');
      }
    }
  });
});
