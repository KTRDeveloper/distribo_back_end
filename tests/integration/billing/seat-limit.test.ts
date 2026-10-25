import { beforeEach, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../setup';
import { enforceSeatLimit } from '../../../src/modules/billing/seat-limit.service';
import {
  findLatestKeepChoice,
  insertKeepChoiceEvent,
} from '../../../src/modules/billing/subscription.repository';

const NOW = new Date('2026-10-25T12:00:00.000Z');
let organizationId: string;
let ownerId: string;
let ownerSeatId: string;
let phone = 0;

async function person(language: 'FR' | 'EN' = 'FR'): Promise<string> {
  const id = uuidv7();
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: `+22507009${String(++phone).padStart(5, '0')}`,
      phoneVerifiedAt: NOW,
      registeredAt: NOW,
      preferredLanguage: language,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    },
  });
  return id;
}

async function business(): Promise<string> {
  const id = uuidv7();
  await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${id}::uuid, 'Fixture Business')`;
  return id;
}

async function seat(
  index: number,
  options: {
    accepted?: boolean;
    paused?: boolean;
    role?: 'DRIVER' | 'OWNER' | 'MANAGER';
    org?: string;
    language?: 'FR' | 'EN';
    acceptedIndex?: number;
  } = {}
): Promise<{ id: string; personId: string }> {
  const id = uuidv7();
  const personId = await person(options.language);
  const accepted = options.accepted ?? true;
  const status = options.paused ? 'PAUSED' : accepted ? 'ACTIVE' : 'INVITED';
  const invitedAt = new Date(NOW.getTime() - 100_000 + index * 1000);
  const acceptedAt = accepted
    ? new Date(NOW.getTime() - 50_000 + (options.acceptedIndex ?? index) * 1000)
    : null;
  const org = options.org ?? organizationId;
  const role = options.role ?? 'MANAGER';
  await prisma.$executeRaw`
    INSERT INTO collaborations (id, person_id, organization_id, role, status, invited_at, accepted_at)
    VALUES (${id}::uuid, ${personId}::uuid, ${org}::uuid, ${role}::"CollaborationRole",
            ${status}::"CollaborationStatus", ${invitedAt}, ${acceptedAt})
  `;
  return { id, personId };
}

async function enforce(limit: number | null) {
  return prisma.$transaction((tx) => enforceSeatLimit(tx, organizationId, limit, NOW));
}

async function statuses(ids: string[]): Promise<string[]> {
  const rows = await prisma.collaboration.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true },
  });
  return ids.map((id) => rows.find((row) => row.id === id)!.status);
}

async function events() {
  return prisma.$queryRaw<
    Array<{ kind: string; actor: string; details: unknown; occurred_at: Date }>
  >`
    SELECT kind::text, actor::text, details, occurred_at FROM subscription_events
    WHERE organization_id = ${organizationId}::uuid AND kind IN ('PAUSED', 'RESUMED')
    ORDER BY id
  `;
}

beforeEach(async () => {
  organizationId = await business();
  const owner = await seat(-1, { role: 'OWNER' });
  ownerId = owner.personId;
  ownerSeatId = owner.id;
});

describe('enforceSeatLimit', () => {
  it.each([
    { accepted: [true, true, true], pausedIndex: 2 },
    { accepted: [true, false, true], pausedIndex: 1 },
    { accepted: [true, false, false], pausedIndex: 2 },
  ])('who stays: $accepted', async ({ accepted, pausedIndex }) => {
    const seats = [];
    for (const [index, isAccepted] of accepted.entries())
      seats.push(await seat(index, { accepted: isAccepted }));
    expect(await enforce(2)).toEqual({
      paused: [seats[pausedIndex].id],
      resumed: [],
      deferred: [],
    });
    expect(await statuses(seats.map((row) => row.id))).toEqual(
      accepted.map((value, index) =>
        index === pausedIndex ? 'PAUSED' : value ? 'ACTIVE' : 'INVITED'
      )
    );
  });

  it('choice: uses the latest tenant choice in its explicit order', async () => {
    const a = await seat(0);
    const b = await seat(1);
    const c = await seat(2);
    await prisma.$transaction(async (tx) => {
      await insertKeepChoiceEvent(tx, organizationId, ownerId, {
        collaboration_ids: [b.id],
        product_ids: [],
      });
      await insertKeepChoiceEvent(tx, organizationId, ownerId, {
        collaboration_ids: [c.id, a.id],
        product_ids: [],
      });
      expect(await findLatestKeepChoice(tx, organizationId)).toEqual({
        collaborationIds: [c.id, a.id],
        productIds: [],
      });
    });
    expect(await enforce(2)).toEqual({ paused: [b.id], resumed: [], deferred: [] });
    expect(await statuses([c.id, a.id, b.id])).toEqual(['ACTIVE', 'ACTIVE', 'PAUSED']);
    expect(await enforce(1)).toEqual({ paused: [a.id], resumed: [], deferred: [] });
  });

  it('return: restores accepted seats and pending invitations', async () => {
    const b = await seat(0, { paused: true });
    const c = await seat(1, { accepted: false, paused: true });
    expect(await enforce(5)).toEqual({ paused: [], resumed: [b.id, c.id], deferred: [] });
    expect(await statuses([b.id, c.id])).toEqual(['ACTIVE', 'INVITED']);
  });

  it('driver: defers only until the open delivery closes', async () => {
    const driver = await seat(0, { role: 'DRIVER' });
    const customerId = await person();
    const relationshipId = uuidv7();
    const orderId = uuidv7();
    const deliveryId = uuidv7();
    await prisma.$executeRaw`
      INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
      VALUES (${relationshipId}::uuid, ${organizationId}::uuid, ${customerId}::uuid, ${ownerId}::uuid)
    `;
    await prisma.$executeRaw`
      INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, status, total_amount, delivery_cost)
      VALUES (${orderId}::uuid, ${relationshipId}::uuid, 'SUPPLIER', ${ownerId}::uuid, 'IN_DELIVERY', 0, 0)
    `;
    await prisma.$executeRaw`
      INSERT INTO deliveries (id, order_id, assigned_to_id, departed_at)
      VALUES (${deliveryId}::uuid, ${orderId}::uuid, ${driver.personId}::uuid, ${NOW})
    `;
    expect(await enforce(0)).toEqual({ paused: [], resumed: [], deferred: [driver.id] });
    expect(await statuses([driver.id])).toEqual(['ACTIVE']);
    expect(await events()).toEqual([]);
    expect(await prisma.notification.count()).toBe(0);
    await prisma.delivery.update({ where: { id: deliveryId }, data: { arrivedAt: NOW } });
    expect(await enforce(0)).toEqual({ paused: [driver.id], resumed: [], deferred: [] });
  });

  it('no limit: restores every paused seat without changing the owner', async () => {
    const a = await seat(0, { paused: true });
    const b = await seat(1, { accepted: false, paused: true });
    const beforeOwner = await prisma.collaboration.findUniqueOrThrow({
      where: { id: ownerSeatId },
    });
    expect(await enforce(null)).toEqual({ paused: [], resumed: [a.id, b.id], deferred: [] });
    expect(await statuses([a.id, b.id])).toEqual(['ACTIVE', 'INVITED']);
    expect(await prisma.collaboration.findUniqueOrThrow({ where: { id: ownerSeatId } })).toEqual(
      beforeOwner
    );
  });

  it('journal: writes one localized notice and SYSTEM event per change, and nothing on repeat', async () => {
    const resumed = await seat(0, { paused: true, language: 'FR' });
    const paused = await seat(1, { language: 'EN' });
    expect(await enforce(1)).toEqual({ paused: [paused.id], resumed: [resumed.id], deferred: [] });
    const journal = await events();
    expect(journal).toHaveLength(2);
    expect(journal).toEqual(
      expect.arrayContaining([
        {
          kind: 'PAUSED',
          actor: 'SYSTEM',
          details: { collaboration_id: paused.id },
          occurred_at: NOW,
        },
        {
          kind: 'RESUMED',
          actor: 'SYSTEM',
          details: { collaboration_id: resumed.id },
          occurred_at: NOW,
        },
      ])
    );
    const notices = await prisma.notification.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
    });
    expect(notices).toHaveLength(2);
    const resumedNotice = notices.find((notice) => notice.recipientId === resumed.personId);
    const pausedNotice = notices.find((notice) => notice.recipientId === paused.personId);
    expect(resumedNotice?.sourceEvent).toBe('subscription.resumed');
    expect(resumedNotice?.content).toMatch(/repris.*Fixture Business/);
    expect(pausedNotice?.sourceEvent).toBe('subscription.paused');
    expect(pausedNotice?.content).toMatch(/paused.*Fixture Business/);
    expect(await enforce(1)).toEqual({ paused: [], resumed: [], deferred: [] });
    expect(await events()).toEqual(journal);
    expect(
      await prisma.notification.findMany({ where: { organizationId }, orderBy: { id: 'asc' } })
    ).toEqual(notices);
  });

  it('other business: never follows a choice id into another tenant', async () => {
    const otherOrg = await business();
    await seat(-1, { org: otherOrg, role: 'OWNER' });
    const other = await seat(0, { org: otherOrg });
    const local = await seat(0);
    await prisma.$transaction((tx) =>
      insertKeepChoiceEvent(tx, organizationId, ownerId, {
        collaboration_ids: [other.id],
        product_ids: [],
      })
    );
    expect(await enforce(0)).toEqual({ paused: [local.id], resumed: [], deferred: [] });
    expect(await statuses([other.id])).toEqual(['ACTIVE']);
    expect(await prisma.notification.count({ where: { organizationId: otherOrg } })).toBe(0);
    const foreignEvents = await prisma.$queryRaw<
      unknown[]
    >`SELECT id FROM subscription_events WHERE organization_id = ${otherOrg}::uuid`;
    expect(foreignEvents).toEqual([]);
  });

  it('rolls back seats, scope versions, events and notices together', async () => {
    const a = await seat(0);
    const before = await prisma.person.findUniqueOrThrow({ where: { id: a.personId } });
    await expect(
      prisma.$transaction(async (tx) => {
        await enforceSeatLimit(tx, organizationId, 0, NOW);
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    expect(await statuses([a.id])).toEqual(['ACTIVE']);
    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: a.personId } })).scopeVersion
    ).toBe(before.scopeVersion);
    expect(await events()).toEqual([]);
    expect(await prisma.notification.count({ where: { organizationId } })).toBe(0);
  });

  it('serializes simultaneous repeats without duplicate events or notices', async () => {
    const a = await seat(0);
    const results = await Promise.all([enforce(0), enforce(0)]);
    expect(results.flatMap((result) => result.paused)).toEqual([a.id]);
    expect(await events()).toHaveLength(1);
    expect(await prisma.notification.count({ where: { organizationId } })).toBe(1);
    expect(await statuses([a.id])).toEqual(['PAUSED']);
  });

  it('ranks accepted seats by acceptance age rather than invitation age', async () => {
    const laterAcceptance = await seat(0, { acceptedIndex: 2 });
    const earlierAcceptance = await seat(1, { acceptedIndex: 0 });
    expect(await enforce(1)).toEqual({ paused: [laterAcceptance.id], resumed: [], deferred: [] });
    expect(await statuses([earlierAcceptance.id])).toEqual(['ACTIVE']);
  });
});
