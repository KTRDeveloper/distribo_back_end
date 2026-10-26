import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildViewer } from '../../../src/modules/sync/sync.viewer.js';
import { SYNC_TABLES, type SyncAdapter } from '../../../src/modules/sync/sync.types.js';
import { prisma } from '../../setup.js';

const PERSON = '0199d001-0000-7000-8000-000000000001';
const OTHER = '0199d001-0000-7000-8000-000000000002';
const DEVICE = '0199d001-0000-7000-8000-0000000000d1';
const ORG_A = '0199d001-0000-7000-8000-0000000000a1';
const ORG_B = '0199d001-0000-7000-8000-0000000000b1';
const ORG_C = '0199d001-0000-7000-8000-0000000000c1';
const ORG_D = '0199d001-0000-7000-8000-0000000000d2';
const REGISTERED = new Date('2026-01-01T00:00:00.000Z');

async function seedPerson(id: string, phone: string, scopeVersion = 0) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REGISTERED,
      passwordHash: 'test-password-hash',
      registeredAt: REGISTERED,
      scopeVersion,
    },
  });
}

/** Creates an organization owned by OTHER (one ACTIVE owner is required) with PERSON's membership. */
async function seedOrg(
  orgId: string,
  mine: {
    role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER';
    status: 'ACTIVE' | 'INVITED' | 'REVOKED';
  }
) {
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: 'Org ' + orgId.slice(-2) } });
    const ownerIsMe = mine.role === 'OWNER' && mine.status === 'ACTIVE';
    await tx.collaboration.create({
      data: {
        id: orgId.replace(/.$/, '9'),
        personId: ownerIsMe ? PERSON : OTHER,
        organizationId: orgId,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REGISTERED,
      },
    });
    if (!ownerIsMe) {
      await tx.collaboration.create({
        data: {
          id: orgId.replace(/.$/, '8'),
          personId: PERSON,
          organizationId: orgId,
          role: mine.role,
          status: mine.status,
          acceptedAt: mine.status === 'ACTIVE' ? REGISTERED : null,
        },
      });
    }
  });
}

describe('buildViewer', () => {
  beforeEach(async () => {
    await seedPerson(PERSON, '+237600000101', 7);
    await seedPerson(OTHER, '+237600000102');
  });

  it('keeps ACTIVE memberships only and the current scope version (AC-1)', async () => {
    await seedOrg(ORG_A, { role: 'OWNER', status: 'ACTIVE' });
    await seedOrg(ORG_B, { role: 'SELLER', status: 'ACTIVE' });
    await seedOrg(ORG_C, { role: 'MANAGER', status: 'INVITED' });
    await seedOrg(ORG_D, { role: 'DRIVER', status: 'REVOKED' });

    const viewer = await buildViewer(PERSON, DEVICE);

    expect(viewer.personId).toBe(PERSON);
    expect(viewer.deviceId).toBe(DEVICE);
    expect(viewer.scopeVersion).toBe(7);
    expect(viewer.isOnline).toBe(false);
    const sorted = [...viewer.memberships].sort((a, b) =>
      a.organizationId.localeCompare(b.organizationId)
    );
    expect(sorted).toEqual([
      { organizationId: ORG_A, role: 'OWNER', status: 'ACTIVE' },
      { organizationId: ORG_B, role: 'SELLER', status: 'ACTIVE' },
    ]);
  });

  it('answers 404 for an unknown person (fail closed)', async () => {
    await expect(buildViewer('0199d001-0000-7000-8000-0000000000ff', DEVICE)).rejects.toMatchObject(
      { statusCode: 404, code: 'NOT_FOUND' }
    );
  });

  it('returns no membership for a person with none', async () => {
    const viewer = await buildViewer(OTHER, DEVICE);
    expect(viewer.memberships).toEqual([]);
    expect(viewer.scopeVersion).toBe(0);
  });
});

describe('adapter registry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const fakeAdapter = (table: SyncAdapter['table']): SyncAdapter => ({
    table,
    pull: () => Promise.resolve({ created: [], updated: [], deleted: [] }),
    push: () => Promise.resolve([]),
  });

  it('returns a registered adapter and rejects a duplicate table (AC-2)', async () => {
    const registry = await import('../../../src/modules/sync/sync.registry.js');
    const adapter = fakeAdapter('orders');
    registry.registerAdapter(adapter);

    expect(registry.getAdapter('orders')).toBe(adapter);
    expect(registry.getAdapters()).toEqual([adapter]);
    expect(() => registry.registerAdapter(fakeAdapter('orders'))).toThrow();
    expect(registry.getAdapters()).toEqual([adapter]);
  });

  it('throws SYNC_UNKNOWN_TABLE 400 for a name outside the 15 tables (AC-3)', async () => {
    const registry = await import('../../../src/modules/sync/sync.registry.js');
    expect(SYNC_TABLES).toHaveLength(15);
    for (const name of ['users', '__proto__']) {
      let error: unknown;
      try {
        registry.getAdapter(name);
      } catch (e) {
        error = e;
      }
      expect(error).toMatchObject({ statusCode: 400, code: 'SYNC_UNKNOWN_TABLE' });
    }
  });

  it('throws on a known table with no adapter registered yet', async () => {
    const registry = await import('../../../src/modules/sync/sync.registry.js');
    expect(() => registry.getAdapter('orders')).toThrow();
  });

  it('refuses to register an adapter for a name outside the 15 tables', async () => {
    const registry = await import('../../../src/modules/sync/sync.registry.js');
    expect(() => registry.registerAdapter(fakeAdapter('users' as never))).toThrow();
  });
});
