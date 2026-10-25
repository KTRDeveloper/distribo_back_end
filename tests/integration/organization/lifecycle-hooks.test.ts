import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import {
  registerLifecycleHook,
  runCloseHooks,
  runReopenHooks,
} from '../../../src/modules/organization/lifecycle-hooks.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c034-0000-7000-8000-000000000001';
const MANAGER = '0199c034-0000-7000-8000-000000000002';
const SELLER = '0199c034-0000-7000-8000-000000000003';
const ORG = '0199c034-0000-7000-8000-0000000000a1';
const OWNER_ROW = '0199c034-0000-7000-8000-0000000000a9';
const MANAGER_ROW = '0199c034-0000-7000-8000-0000000000a2';
const SELLER_ROW = '0199c034-0000-7000-8000-0000000000a3';
const GESTURE = '0199c034-0000-7000-8000-0000000000c1';
const REG = new Date('2026-01-01T00:00:00.000Z');

const removers: Array<() => void> = [];

/** Registers a hook for the test and removes it afterwards. */
function track(hook: Parameters<typeof registerLifecycleHook>[0]) {
  const remove = registerLifecycleHook(hook);
  removers.push(remove);
  return remove;
}

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

async function seedOrganization(status: 'ACTIVE' | 'CLOSED' | 'SUSPENDED') {
  await prisma.organization.create({ data: { id: ORG, name: 'Org', status } });
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
}

async function seedTeam() {
  await prisma.collaboration.create({
    data: {
      id: MANAGER_ROW,
      personId: MANAGER,
      organizationId: ORG,
      role: 'MANAGER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  await prisma.collaboration.create({
    data: {
      id: SELLER_ROW,
      personId: SELLER,
      organizationId: ORG,
      role: 'SELLER',
      status: 'PAUSED',
      acceptedAt: REG,
    },
  });
}

function close() {
  return createAuthenticatedRequest(app, OWNER)
    .post(`/api/v1/organizations/${ORG}/close`)
    .send({ id: GESTURE });
}

function reopen() {
  return createAuthenticatedRequest(app, OWNER)
    .post(`/api/v1/organizations/${ORG}/reopen`)
    .send({ id: GESTURE });
}

const statusOf = () =>
  prisma.organization.findUniqueOrThrow({ where: { id: ORG } }).then((o) => o.status);
const rowOf = (id: string) => prisma.collaboration.findUniqueOrThrow({ where: { id } });
const scopeVersionOf = (id: string) =>
  prisma.person.findUniqueOrThrow({ where: { id } }).then((p) => p.scopeVersion);

beforeEach(async () => {
  await seedPerson(OWNER, '+237600340001');
  await seedPerson(MANAGER, '+237600340002');
  await seedPerson(SELLER, '+237600340003');
});

afterEach(() => {
  while (removers.length > 0) removers.pop()!();
});

describe('close hooks', () => {
  beforeEach(async () => {
    await seedOrganization('ACTIVE');
    await seedTeam();
  });

  it('AC-1 both onClose run in order with the transaction, the organization id and the time', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    track({ onClose: (...args) => Promise.resolve(void calls.push({ name: 'first', args })) });
    track({ onClose: (...args) => Promise.resolve(void calls.push({ name: 'second', args })) });
    const before = Date.now();

    const response = await close();

    expect(response.status).toBe(200);
    expect(calls.map((c) => c.name)).toEqual(['first', 'second']);
    const [tx, organizationId, now] = calls[0].args as [unknown, string, Date];
    expect(tx).toBeDefined();
    expect(organizationId).toBe(ORG);
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(calls[1].args[2]).toBe(now);
  });

  it('AC-1 the close hooks run last, in the same transaction, after the close is written', async () => {
    let seen: { org: string; manager: string; outside: string } | undefined;
    track({
      onClose: async (tx, organizationId) => {
        seen = {
          org: (await tx.organization.findUniqueOrThrow({ where: { id: organizationId } })).status,
          manager: (await tx.collaboration.findUniqueOrThrow({ where: { id: MANAGER_ROW } }))
            .status,
          outside: (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }))
            .status,
        };
      },
    });

    await close();

    expect(seen).toEqual({ org: 'CLOSED', manager: 'REVOKED', outside: 'ACTIVE' });
  });

  it('AC-2 a failing onClose answers 500 and undoes the whole close', async () => {
    track({ onClose: () => Promise.reject(new Error('hook failed')) });
    const managerBefore = await scopeVersionOf(MANAGER);

    const response = await close();

    expect(response.status).toBe(500);
    expect(await statusOf()).toBe('ACTIVE');
    expect((await rowOf(MANAGER_ROW)).status).toBe('ACTIVE');
    expect((await rowOf(SELLER_ROW)).status).toBe('PAUSED');
    expect(await scopeVersionOf(MANAGER)).toBe(managerBefore);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-3 a PAUSED seller and an ACTIVE manager are REVOKED; only the manager is bumped and notified', async () => {
    const ownerBefore = await scopeVersionOf(OWNER);
    const managerBefore = await scopeVersionOf(MANAGER);
    const sellerBefore = await scopeVersionOf(SELLER);

    const response = await close();

    expect(response.status).toBe(200);
    expect((await rowOf(MANAGER_ROW)).status).toBe('REVOKED');
    expect((await rowOf(SELLER_ROW)).status).toBe('REVOKED');
    const owner = await rowOf(OWNER_ROW);
    expect(owner).toMatchObject({ status: 'ACTIVE', role: 'OWNER' });
    expect(await scopeVersionOf(OWNER)).toBe(ownerBefore);
    expect(await scopeVersionOf(MANAGER)).toBe(managerBefore + 1);
    expect(await scopeVersionOf(SELLER)).toBe(sellerBefore);
    const notes = await prisma.notification.findMany();
    expect(notes.map((n) => [n.recipientId, n.sourceEvent])).toEqual([
      [MANAGER, 'organization.closed'],
    ]);
  });

  it('AC-5 closing a CLOSED or SUSPENDED business answers 409 and runs no hook', async () => {
    const onClose = vi.fn(() => Promise.resolve());
    track({ onClose });

    for (const status of ['CLOSED', 'SUSPENDED'] as const) {
      await prisma.organization.update({ where: { id: ORG }, data: { status } });
      const response = await close();
      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
      expect(await statusOf()).toBe(status);
    }
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('reopen hooks', () => {
  it('AC-4 a throwing onReopen answers 500 and the business stays CLOSED', async () => {
    await seedOrganization('CLOSED');
    track({ onReopen: () => Promise.reject(new Error('hook failed')) });

    const response = await reopen();

    expect(response.status).toBe(500);
    expect(await statusOf()).toBe('CLOSED');
  });

  it('AC-4 a normal onReopen runs once with the organization id and the business is ACTIVE', async () => {
    await seedOrganization('CLOSED');
    const onReopen = vi.fn(() => Promise.resolve());
    track({ onReopen });

    const response = await reopen();

    expect(response.status).toBe(200);
    expect(await statusOf()).toBe('ACTIVE');
    expect(onReopen).toHaveBeenCalledTimes(1);
    const args = onReopen.mock.calls[0] as unknown as [unknown, string, Date];
    expect(args[1]).toBe(ORG);
    expect(args[2]).toBeInstanceOf(Date);
  });

  it('AC-5 reopening an ACTIVE business answers 409 and runs no hook', async () => {
    await seedOrganization('ACTIVE');
    const onReopen = vi.fn(() => Promise.resolve());
    track({ onReopen });

    const response = await reopen();

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_CLOSED');
    expect(onReopen).not.toHaveBeenCalled();
  });

  it('AB-1 the owner cannot lift a moderation suspension: 409, still SUSPENDED, no hook', async () => {
    await seedOrganization('SUSPENDED');
    const onReopen = vi.fn(() => Promise.resolve());
    track({ onReopen });

    const response = await reopen();

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_CLOSED');
    expect(await statusOf()).toBe('SUSPENDED');
    expect(onReopen).not.toHaveBeenCalled();
  });
});

describe('registerLifecycleHook', () => {
  it('AC-6 a hook with neither function throws', () => {
    expect(() => registerLifecycleHook({})).toThrow();
  });

  it('AC-6 a removed hook no longer runs; the others still do', async () => {
    const removed = vi.fn(() => Promise.resolve());
    const kept = vi.fn(() => Promise.resolve());
    const remove = track({ onClose: removed, onReopen: removed });
    track({ onClose: kept });
    remove();
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await runCloseHooks(tx, ORG, now);
      await runReopenHooks(tx, ORG, now);
    });

    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('AC-6 hooks with only one function are skipped for the other event', async () => {
    const onClose = vi.fn(() => Promise.resolve());
    track({ onClose });

    await prisma.$transaction((tx) => runReopenHooks(tx, ORG, new Date()));

    expect(onClose).not.toHaveBeenCalled();
  });
});
