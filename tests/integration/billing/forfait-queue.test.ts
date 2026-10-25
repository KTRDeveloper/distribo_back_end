import { beforeEach, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../setup.js';
import {
  startOrQueueForfait,
  UpgradeRequiredError,
  type ForfaitPurchase,
} from '../../../src/modules/billing/forfait.service.js';
import { runInTransaction } from '../../../src/modules/billing/subscription.repository.js';

const NOW = new Date('2026-10-12T09:00:00Z');
const END = new Date('2026-11-12T09:00:00Z');
const QUEUED_END = new Date('2026-12-12T09:00:00Z');
const DAY = 86_400_000;
let organizationId: string;

beforeEach(async () => {
  organizationId = uuidv7();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${organizationId}::uuid, 'Fixture Business')
  `;
});

async function purchase(overrides: Partial<ForfaitPurchase> = {}): Promise<ForfaitPurchase> {
  const input: ForfaitPurchase = {
    organizationId, plan: 'ESSENTIAL', months: 1, price: 5000n,
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
  plan: 'ESSENTIAL' | 'PRO',
  status: 'ACTIVE' | 'SCHEDULED' | 'ENDED',
  startsAt: Date,
  endsAt: Date,
  endReason: 'EXPIRED' | 'REFUNDED' | null = null,
  orgId = organizationId,
) {
  return prisma.subscription.create({ data: {
    id: uuidv7(), organizationId: orgId, plan, status, startsAt, endsAt,
    origin: 'GIFT', price: 0n, endReason,
  } });
}

async function events() {
  return prisma.$queryRaw<Array<{
    kind: string; actor: string; payment_id: string; subscription_id: string;
    administrator_id: string | null; admin_action_id: string | null;
    details: { plan: string; months: number; status: string };
  }>>`SELECT kind, actor, payment_id, subscription_id, administrator_id, admin_action_id, details
      FROM subscription_events WHERE organization_id = ${organizationId}::uuid`;
}

const place = (input: ForfaitPurchase) => runInTransaction((tx) => startOrQueueForfait(tx, input));

describe('purchased forfait placement', () => {
  it('starts three months at once', async () => {
    const period = await place(await purchase({ months: 3, price: 15000n }));
    expect(period).toMatchObject({
      organizationId, plan: 'ESSENTIAL', months: 3, price: 15000n,
      origin: 'PAYMENT', status: 'ACTIVE', startsAt: NOW,
      endsAt: new Date('2027-01-12T09:00:00Z'), endReason: null,
    });
    expect(await prisma.subscription.findUnique({ where: { id: period.id } })).toEqual(period);
  });

  it.each([
    { running: 'ESSENTIAL' as const, bought: 'ESSENTIAL' as const, scheduled: false },
    { running: 'PRO' as const, bought: 'ESSENTIAL' as const, scheduled: false },
    { running: 'PRO' as const, bought: 'PRO' as const, scheduled: true },
  ])('queues $bought behind $running (scheduled=$scheduled)', async (test) => {
    await seedPeriod(test.running, 'ACTIVE', NOW, END);
    if (test.scheduled) await seedPeriod('ESSENTIAL', 'SCHEDULED', END, QUEUED_END);
    const period = await place(await purchase({ plan: test.bought }));
    expect(period).toMatchObject({
      status: 'SCHEDULED', startsAt: test.scheduled ? QUEUED_END : END,
      endsAt: new Date(test.scheduled ? '2027-01-12T09:00:00Z' : '2026-12-12T09:00:00Z'),
    });
    expect(await events()).toEqual([expect.objectContaining({
      details: { plan: test.bought, months: 1, status: 'SCHEDULED' },
    })]);
  });

  it.each([3, 8])('handles the grace period after %i days', async (days) => {
    const expired = new Date(NOW.getTime() - days * DAY);
    await seedPeriod('ESSENTIAL', 'ENDED', new Date('2026-09-01T09:00:00Z'), expired, 'EXPIRED');
    expect(await place(await purchase())).toMatchObject({
      status: 'ACTIVE', startsAt: days < 7 ? expired : NOW,
      endsAt: new Date(days < 7 ? '2026-11-09T09:00:00Z' : '2026-11-12T09:00:00Z'),
    });
  });

  it('rejects upgrades without inserting a period or event', async () => {
    await seedPeriod('ESSENTIAL', 'ACTIVE', NOW, END);
    await expect(place(await purchase({ plan: 'PRO' }))).rejects.toBeInstanceOf(UpgradeRequiredError);
    expect(await prisma.subscription.count({ where: { organizationId } })).toBe(1);
    expect(await events()).toEqual([]);
  });

  it('journals exactly one payer event with the payment and period ids', async () => {
    const input = await purchase();
    const period = await place(input);
    expect(await events()).toEqual([{
      kind: 'FORFAIT_ADDED', actor: 'PAYER', payment_id: input.paymentId,
      subscription_id: period.id, administrator_id: null, admin_action_id: null,
      details: { plan: 'ESSENTIAL', months: 1, status: 'ACTIVE' },
    }]);
  });

  it('journals the administrator and admin action ids for an administrator purchase', async () => {
    const personId = uuidv7();
    const administratorId = uuidv7();
    const adminActionId = uuidv7();
    await prisma.person.create({ data: {
      id: personId, phoneNumber: '+2250700007011', fullName: 'Fixture Administrator',
      phoneVerifiedAt: NOW, registeredAt: NOW, preferredLanguage: 'FR',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    } });
    await prisma.administrator.create({ data: {
      id: administratorId, personId, role: 'SUPER_ADMIN', totpSecret: 'fixture-not-a-secret',
    } });
    await prisma.adminAction.create({ data: {
      id: adminActionId, administratorId, action: 'RECORD_PAYMENT',
      targetOrganizationId: organizationId, reason: 'Fixture payment',
    } });
    const input = await purchase({ actor: { actor: 'ADMINISTRATOR', administratorId, adminActionId } });
    const period = await place(input);
    expect(await events()).toEqual([{
      kind: 'FORFAIT_ADDED', actor: 'ADMINISTRATOR', payment_id: input.paymentId,
      subscription_id: period.id, administrator_id: administratorId, admin_action_id: adminActionId,
      details: { plan: 'ESSENTIAL', months: 1, status: 'ACTIVE' },
    }]);
  });

  it('serializes concurrent payments into active and scheduled periods', async () => {
    const first = await purchase();
    const second = await purchase();
    const periods = await Promise.all([place(first), place(second)]);
    expect(periods.map((p) => p.status).sort()).toEqual(['ACTIVE', 'SCHEDULED']);
    const active = periods.find((p) => p.status === 'ACTIVE')!;
    const scheduled = periods.find((p) => p.status === 'SCHEDULED')!;
    expect(active.startsAt).toEqual(NOW);
    expect(scheduled.startsAt).toEqual(active.endsAt);
    expect((await events()).length).toBe(2);
  });

  it('rolls back both the period and journal when the caller transaction fails', async () => {
    const input = await purchase();
    await expect(runInTransaction(async (tx) => {
      await startOrQueueForfait(tx, input);
      throw new Error('caller rollback');
    })).rejects.toThrow('caller rollback');
    expect(await prisma.subscription.count({ where: { organizationId } })).toBe(0);
    expect(await events()).toEqual([]);
  });

  it('rolls back the inserted period when the administrator journal cannot be written', async () => {
    const input = await purchase({ actor: {
      actor: 'ADMINISTRATOR', administratorId: uuidv7(), adminActionId: uuidv7(),
    } });
    await expect(place(input)).rejects.toThrow();
    expect(await prisma.subscription.count({ where: { organizationId } })).toBe(0);
    expect(await events()).toEqual([]);
  });

  it('does not use another organization queue or expiry', async () => {
    const otherId = uuidv7();
    await prisma.$executeRaw`
      INSERT INTO organizations (id, name) VALUES (${otherId}::uuid, 'Other Fixture Business')
    `;
    await seedPeriod('PRO', 'ENDED', new Date('2026-09-01T09:00:00Z'),
      new Date(NOW.getTime() - DAY), 'EXPIRED', otherId);
    await seedPeriod('PRO', 'ACTIVE', NOW, END, null, otherId);
    expect(await place(await purchase())).toMatchObject({ status: 'ACTIVE', startsAt: NOW });
  });

  it('uses the latest EXPIRED period rather than older history', async () => {
    const expired = new Date(NOW.getTime() - 3 * DAY);
    await seedPeriod('ESSENTIAL', 'ENDED', new Date('2026-08-01T09:00:00Z'),
      new Date(NOW.getTime() - 10 * DAY), 'EXPIRED');
    await seedPeriod('ESSENTIAL', 'ENDED', new Date(NOW.getTime() - 10 * DAY), expired, 'EXPIRED');
    expect(await place(await purchase())).toMatchObject({ status: 'ACTIVE', startsAt: expired });
  });
});
