import { beforeEach, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../setup.js';
import type { ForfaitPurchase } from '../../../src/modules/billing/forfait.service.js';
import { addPaidForfait } from '../../../src/modules/billing/upgrade.service.js';
import { runInTransaction } from '../../../src/modules/billing/subscription.repository.js';

const NOW = new Date('2026-10-12T09:00:00Z');
const DAY = 86_400_000;
const PURCHASE_END = new Date('2026-11-12T09:00:00Z');
let organizationId: string;

beforeEach(async () => {
  organizationId = uuidv7();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${organizationId}::uuid, 'Fixture Business')
  `;
});

async function purchase(overrides: Partial<ForfaitPurchase> = {}): Promise<ForfaitPurchase> {
  const input: ForfaitPurchase = {
    organizationId, plan: 'PRO', months: 1, price: 10000n,
    paymentId: uuidv7(), actor: { actor: 'PAYER' }, now: NOW, ...overrides,
  };
  await prisma.subscriptionPayment.create({ data: {
    id: input.paymentId, organizationId: input.organizationId, plan: input.plan,
    months: input.months, amount: input.price, operator: 'OTHER',
    status: 'SUCCEEDED', confirmedAt: NOW, termsVersion: 'fixture-v1',
    providerReference: `fixture-${input.paymentId}`,
  } });
  return input;
}

async function seedPeriod(
  plan: ForfaitPurchase['plan'] = 'ESSENTIAL',
  status: 'ACTIVE' | 'SCHEDULED' = 'ACTIVE',
  startsAt = new Date(NOW.getTime() - 10 * DAY),
  endsAt = new Date(NOW.getTime() + 20 * DAY),
  orgId = organizationId,
) {
  return prisma.subscription.create({ data: {
    id: uuidv7(), organizationId: orgId, plan, status, startsAt, endsAt,
    origin: 'GIFT', price: 0n,
  } });
}

async function seedQueue() {
  const active = await seedPeriod();
  const scheduled = await seedPeriod('ESSENTIAL', 'SCHEDULED', active.endsAt,
    new Date(active.endsAt.getTime() + 31 * DAY));
  return { active, scheduled };
}

async function periods() {
  return prisma.subscription.findMany({ where: { organizationId }, orderBy: { id: 'asc' } });
}

async function events() {
  return prisma.$queryRaw<Array<{
    kind: string; actor: string; payment_id: string | null; subscription_id: string | null;
    administrator_id: string | null; admin_action_id: string | null;
    details: Record<string, unknown>; occurred_at: Date;
  }>>`SELECT kind, actor, payment_id, subscription_id, administrator_id, admin_action_id,
             details, occurred_at
      FROM subscription_events WHERE organization_id = ${organizationId}::uuid ORDER BY id`;
}

const add = (input: ForfaitPurchase) => runInTransaction((tx) => addPaidForfait(tx, input));

describe('paid forfait upgrades', () => {
  it('upgrades immediately and converts twenty ESSENTIAL days into ten PRO days', async () => {
    const active = await seedPeriod();
    const input = await purchase();
    const result = await add(input);
    expect(result.endedIds).toEqual([active.id]);
    expect(result.purchased).toMatchObject({
      organizationId, plan: 'PRO', origin: 'PAYMENT', months: 1, price: 10000n,
      paymentId: input.paymentId, status: 'ACTIVE', startsAt: NOW, endsAt: PURCHASE_END,
      endReason: null,
    });
    expect(result.conversion).toMatchObject({
      organizationId, plan: 'PRO', origin: 'CONVERSION', months: null, price: 0n,
      paymentId: null, status: 'SCHEDULED', startsAt: PURCHASE_END,
      endsAt: new Date(PURCHASE_END.getTime() + 10 * DAY), endReason: null,
    });
    expect(await prisma.subscription.findUnique({ where: { id: active.id } })).toMatchObject({
      status: 'ENDED', endReason: 'UPGRADED', endsAt: NOW, startsAt: active.startsAt,
    });
    expect(await periods()).toHaveLength(3);
  });

  it('absorbs scheduled periods at their start and rounds the aggregate conversion once', async () => {
    const { active, scheduled } = await seedQueue();
    const result = await add(await purchase());
    expect(result.endedIds).toEqual([active.id, scheduled.id]);
    expect(result.conversion?.endsAt).toEqual(new Date(PURCHASE_END.getTime() + 26 * DAY));
    expect(await prisma.subscription.findUnique({ where: { id: scheduled.id } })).toMatchObject({
      status: 'ENDED', endReason: 'UPGRADED', startsAt: scheduled.startsAt,
      endsAt: scheduled.startsAt,
    });
  });

  it('creates no conversion when the active period is already past', async () => {
    const active = await seedPeriod('ESSENTIAL', 'ACTIVE',
      new Date(NOW.getTime() - 31 * DAY), new Date(NOW.getTime() - DAY));
    const result = await add(await purchase());
    expect(result.conversion).toBeNull();
    expect(result.endedIds).toEqual([active.id]);
    expect(result.purchased).toMatchObject({ status: 'ACTIVE', startsAt: NOW });
    expect(await periods()).toHaveLength(2);
  });

  it.each([
    { running: null, bought: 'PRO', status: 'ACTIVE', upgrade: false },
    { running: 'PRO', bought: 'ESSENTIAL', status: 'SCHEDULED', upgrade: false },
    { running: 'ESSENTIAL', bought: 'ESSENTIAL', status: 'SCHEDULED', upgrade: false },
    { running: 'ESSENTIAL', bought: 'ENTERPRISE', status: 'ACTIVE', upgrade: true },
  ] as const)('places $bought with $running running', async (test) => {
    const active = test.running ? await seedPeriod(test.running) : null;
    const result = await add(await purchase({ plan: test.bought }));
    expect(result.purchased.status).toBe(test.status);
    expect(result.purchased.startsAt).toEqual(test.status === 'SCHEDULED' ? active!.endsAt : NOW);
    expect(result.endedIds).toEqual(test.upgrade ? [active!.id] : []);
    if (!test.upgrade) expect(result.conversion).toBeNull();
    else expect(result.conversion).not.toBeNull();
  });

  it('journals every absorbed and added period and exactly one plan change', async () => {
    const { active, scheduled } = await seedQueue();
    const input = await purchase();
    const result = await add(input);
    const journal = await events();
    expect(journal.map((event) => event.kind)).toEqual([
      'FORFAIT_ENDED', 'FORFAIT_ENDED', 'FORFAIT_ADDED', 'FORFAIT_ADDED', 'PLAN_CHANGED',
    ]);
    expect(journal.filter((event) => event.kind === 'FORFAIT_ENDED')
      .map((event) => event.subscription_id)).toEqual([active.id, scheduled.id]);
    expect(journal.filter((event) => event.kind === 'FORFAIT_ADDED')
      .map((event) => event.subscription_id)).toEqual([result.purchased.id, result.conversion!.id]);
    expect(journal.at(-1)?.details).toEqual({ from: 'ESSENTIAL', to: 'PRO' });
    for (const event of journal) {
      expect(event).toMatchObject({
        actor: 'PAYER', payment_id: input.paymentId, administrator_id: null,
        admin_action_id: null, occurred_at: NOW,
      });
    }
  });

  it('rejects replay of the same payment without changing periods or events', async () => {
    await seedQueue();
    const input = await purchase();
    await add(input);
    const before = await periods();
    const journal = await events();
    await expect(add(input)).rejects.toMatchObject({ code: 'P2002' });
    expect(await periods()).toEqual(before);
    expect(await events()).toEqual(journal);
  });

  it('rolls back endings, additions and events when the caller transaction fails', async () => {
    await seedQueue();
    const before = await periods();
    const input = await purchase();
    await expect(runInTransaction(async (tx) => {
      await addPaidForfait(tx, input);
      throw new Error('caller rollback');
    })).rejects.toThrow('caller rollback');
    expect(await periods()).toEqual(before);
    expect(await events()).toEqual([]);
  });

  it('rolls back absorbed periods when an administrator journal fails', async () => {
    await seedQueue();
    const before = await periods();
    const input = await purchase({ actor: {
      actor: 'ADMINISTRATOR', administratorId: uuidv7(), adminActionId: uuidv7(),
    } });
    await expect(add(input)).rejects.toThrow();
    expect(await periods()).toEqual(before);
    expect(await events()).toEqual([]);
  });

  it('never absorbs another organization periods', async () => {
    const otherId = uuidv7();
    await prisma.$executeRaw`
      INSERT INTO organizations (id, name) VALUES (${otherId}::uuid, 'Other Fixture Business')
    `;
    const foreign = await seedPeriod('ESSENTIAL', 'ACTIVE',
      new Date(NOW.getTime() - 10 * DAY), new Date(NOW.getTime() + 20 * DAY), otherId);
    const active = await seedPeriod();
    const result = await add(await purchase());
    expect(result.endedIds).toEqual([active.id]);
    expect(await prisma.subscription.findUnique({ where: { id: foreign.id } })).toEqual(foreign);
  });

  it('serializes concurrent upgrades without losing converted days', async () => {
    const active = await seedPeriod();
    const [first, second] = await Promise.all([purchase(), purchase()]);
    const results = await Promise.all([add(first), add(second)]);
    const upgraded = results.find((result) => result.endedIds.length > 0)!;
    const queued = results.find((result) => result.endedIds.length === 0)!;
    expect(upgraded.endedIds).toEqual([active.id]);
    expect(queued.purchased).toMatchObject({
      status: 'SCHEDULED', startsAt: upgraded.conversion!.endsAt,
    });
    expect((await periods()).filter((period) => period.status === 'ACTIVE')).toHaveLength(1);
    expect((await events()).filter((event) => event.kind === 'PLAN_CHANGED')).toHaveLength(1);
  });
});
