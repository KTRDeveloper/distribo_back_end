import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../setup.js';
import '../../../src/app.js';
import { registerBillingLifecycleHooks } from '../../../src/modules/billing/lifecycle.service.js';
import { closeOrganization, reopenOrganization } from '../../../src/modules/organization/organization.service.js';
import * as subscriptions from '../../../src/modules/billing/subscription.repository.js';
import * as limits from '../../../src/modules/billing/limits.service.js';
import { PLANS } from '../../../src/shared/plans.js';

const OWNER = '0199c031-0000-7000-8000-000000000001';
const ORG = '0199c031-0000-7000-8000-000000000002';
const OTHER = '0199c031-0000-7000-8000-000000000003';
const DAY = 86_400_000;
let now: Date;
const actor = (organizationId = ORG) => ({ personId: OWNER, organizationId, role: 'OWNER' as const });
const close = () => closeOrganization(actor(), { id: uuidv7() });
const fields = (plan: 'FREE' | 'ESSENTIAL', planEndsAt: Date | null = null, graceEndsAt: Date | null = null) => ({
  plan, planEndsAt, graceEndsAt,
  maxCollaborators: PLANS[plan].maxCollaborators, maxProducts: PLANS[plan].maxProducts,
});

async function organization(organizationId = ORG, status: 'ACTIVE' | 'CLOSED' = 'ACTIVE') {
  await prisma.organization.create({ data: { id: organizationId, name: 'Fixture Business', status } });
  await prisma.collaboration.create({ data: {
    id: uuidv7(), organizationId, personId: OWNER, role: 'OWNER', status: 'ACTIVE',
  } });
}

async function period(
  status: 'ACTIVE' | 'SCHEDULED' | 'ENDED', startsAt: Date, endsAt: Date,
  organizationId = ORG, paid = false,
) {
  const paymentId = paid ? uuidv7() : null;
  if (paymentId) {
    await prisma.subscriptionPayment.create({ data: {
      id: paymentId, organizationId, plan: 'ESSENTIAL', months: 1, amount: 5000n,
      operator: 'OTHER', providerReference: uuidv7(), termsVersion: 'fixture-v1',
      status: 'SUCCEEDED', confirmedAt: now,
    } });
  }
  return prisma.subscription.create({ data: {
    id: uuidv7(), organizationId, plan: 'ESSENTIAL', status, startsAt, endsAt,
    origin: paid ? 'PAYMENT' : 'GIFT', price: paid ? 5000n : 0n,
    paymentId, months: paid ? 1 : null, endReason: status === 'ENDED' ? 'EXPIRED' : null,
  } });
}

async function paidQueue() {
  const end = new Date(now.getTime() + 20 * DAY);
  const active = await period('ACTIVE', new Date(now.getTime() - 10 * DAY), end);
  const scheduled = await period('SCHEDULED', end, new Date(end.getTime() + 30 * DAY));
  await prisma.organization.update({ where: { id: ORG }, data: fields('ESSENTIAL', scheduled.endsAt) });
  return { active, scheduled };
}

async function products(count: number) {
  for (let i = 0; i < count; i++) {
    const id = uuidv7();
    await prisma.product.create({ data: {
      id, organizationId: ORG, name: `Fixture product ${i}`, price: 100n,
      variants: { create: { id: uuidv7(), unit: 'piece', price: 100n } },
    } });
  }
}

async function state(organizationId = ORG) {
  return {
    organization: await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    periods: await prisma.subscription.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
    events: await prisma.subscriptionEvent.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
    products: await prisma.product.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
  };
}

beforeEach(async () => {
  now = new Date();
  await prisma.person.create({ data: {
    id: OWNER, fullName: 'Fixture Owner', phoneNumber: '+2250700031011',
    phoneVerifiedAt: now, registeredAt: now, preferredLanguage: 'FR',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
  } });
  await organization();
});

afterEach(() => vi.restoreAllMocks());

describe('billing organization lifecycle', () => {
  it('close ends active and scheduled periods and journals SYSTEM transitions to FREE', async () => {
    const { active, scheduled } = await paidQueue();
    const before = new Date();
    await close();
    const after = new Date();
    const result = await state();
    expect(result.organization).toMatchObject({ status: 'CLOSED', ...fields('FREE') });
    const endedActive = result.periods.find((row) => row.id === active.id)!;
    expect(endedActive).toMatchObject({ status: 'ENDED', endReason: 'CLOSED' });
    expect(endedActive.endsAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(endedActive.endsAt.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(result.periods.find((row) => row.id === scheduled.id)).toMatchObject({
      status: 'ENDED', endReason: 'CLOSED', endsAt: scheduled.startsAt,
    });
    expect(result.events).toHaveLength(3);
    expect(result.events.filter((row) => row.kind === 'FORFAIT_ENDED')).toEqual(expect.arrayContaining([
      expect.objectContaining({ subscriptionId: active.id, actor: 'SYSTEM', details: { reason: 'CLOSED' } }),
      expect.objectContaining({ subscriptionId: scheduled.id, actor: 'SYSTEM', details: { reason: 'CLOSED' } }),
    ]));
    expect(result.events.find((row) => row.kind === 'PLAN_CHANGED')).toMatchObject({
      actor: 'SYSTEM', subscriptionId: null, details: { from: 'ESSENTIAL', to: 'FREE' },
    });
    expect(new Set(result.events.map((row) => row.occurredAt.getTime())).size).toBe(1);
  });

  it('grace is cleared even when there is no live period', async () => {
    const end = new Date(now.getTime() - 3 * DAY);
    await period('ENDED', new Date(end.getTime() - 30 * DAY), end);
    await prisma.organization.update({ where: { id: ORG }, data: fields('ESSENTIAL', end, new Date(end.getTime() + 7 * DAY)) });
    await close();
    const result = await state();
    expect(result.organization).toMatchObject(fields('FREE'));
    expect(result.periods[0]).toMatchObject({ status: 'ENDED', endReason: 'EXPIRED', endsAt: end });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ kind: 'PLAN_CHANGED', details: { from: 'ESSENTIAL', to: 'FREE' } });
  });

  it('free business writes no period or event', async () => {
    await close();
    const result = await state();
    expect(result.organization).toMatchObject({ status: 'CLOSED', ...fields('FREE') });
    expect(result.periods).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it('reopen on FREE pauses exactly the 15 excess products', async () => {
    await prisma.organization.update({ where: { id: ORG }, data: { status: 'CLOSED' } });
    await products(45);
    await reopenOrganization(actor());
    const result = await state();
    expect(result.organization).toMatchObject({ status: 'ACTIVE', ...fields('FREE') });
    expect(result.products.filter((row) => row.pausedAt !== null)).toHaveLength(15);
    expect(result.products.filter((row) => row.pausedAt === null)).toHaveLength(30);
  });

  it('reopen honors an ESSENTIAL period purchased while closed without pausing products', async () => {
    await prisma.organization.update({ where: { id: ORG }, data: { status: 'CLOSED' } });
    const purchased = await period('ACTIVE', new Date(now.getTime() - DAY), new Date(now.getTime() + 29 * DAY), ORG, true);
    await products(45);
    await reopenOrganization(actor());
    const result = await state();
    expect(result.organization).toMatchObject({ status: 'ACTIVE', ...fields('ESSENTIAL', purchased.endsAt) });
    expect(result.products.every((row) => row.pausedAt === null)).toBe(true);
    expect(result.periods[0]).toEqual(purchased);
  });

  it('abort rolls back the close, first period ending and event when the next ending fails', async () => {
    const { scheduled } = await paidQueue();
    const before = await state();
    const original = subscriptions.endPeriod;
    vi.spyOn(subscriptions, 'endPeriod').mockImplementation(async (tx, id, end, reason) => {
      if (id === scheduled.id) throw new Error('fixture ending failure');
      await original(tx, id, end, reason);
    });
    await expect(close()).rejects.toThrow('fixture ending failure');
    expect(await state()).toEqual(before);
  });

  it('once registers a single hook even when explicitly called twice after startup', async () => {
    const register = await import('../../../src/modules/organization/lifecycle-hooks.js');
    const spy = vi.spyOn(register, 'registerLifecycleHook');
    registerBillingLifecycleHooks();
    registerBillingLifecycleHooks();
    expect(spy).not.toHaveBeenCalled();
    await paidQueue();
    await close();
    const result = await state();
    expect(result.events.filter((row) => row.kind === 'FORFAIT_ENDED')).toHaveLength(2);
    expect(result.events.filter((row) => row.kind === 'PLAN_CHANGED')).toHaveLength(1);
  });

  it('other business periods, events and plan fields are unchanged', async () => {
    await paidQueue();
    await organization(OTHER);
    const otherPeriod = await period('ACTIVE', new Date(now.getTime() - DAY), new Date(now.getTime() + 29 * DAY), OTHER);
    await prisma.organization.update({ where: { id: OTHER }, data: fields('ESSENTIAL', otherPeriod.endsAt) });
    const before = await state(OTHER);
    await close();
    expect(await state(OTHER)).toEqual(before);
  });

  it('close never extends a stale ACTIVE period that already ended', async () => {
    const end = new Date(now.getTime() - DAY);
    const stale = await period('ACTIVE', new Date(end.getTime() - 30 * DAY), end);
    await prisma.organization.update({ where: { id: ORG }, data: fields('ESSENTIAL', end) });
    await close();
    expect((await state()).periods[0]).toMatchObject({ id: stale.id, endsAt: end, status: 'ENDED', endReason: 'CLOSED' });
  });

  it('close does not pause products even when resetting the paid plan to FREE', async () => {
    await paidQueue();
    await products(31);
    await close();
    expect((await state()).products.every((row) => row.pausedAt === null)).toBe(true);
  });

  it('reopen rolls back rights, product pauses and events if enforcement fails', async () => {
    await prisma.organization.update({ where: { id: ORG }, data: {
      status: 'CLOSED', ...fields('ESSENTIAL', new Date(now.getTime() - 10 * DAY)),
    } });
    await products(31);
    const before = await state();
    const original = limits.enforceLimits;
    vi.spyOn(limits, 'enforceLimits').mockImplementation(async (...args) => {
      await original(...args);
      throw new Error('fixture enforcement failure');
    });
    await expect(reopenOrganization(actor())).rejects.toThrow('fixture enforcement failure');
    expect(await state()).toEqual(before);
  });

  it('repeated close and reopen does not revive ended paid periods or duplicate ending events', async () => {
    await paidQueue();
    await close();
    const ended = (await state()).periods;
    await reopenOrganization(actor());
    await close();
    await reopenOrganization(actor());
    const result = await state();
    expect(result.organization).toMatchObject({ status: 'ACTIVE', ...fields('FREE') });
    expect(result.periods).toEqual(ended);
    expect(result.events.filter((row) => row.kind === 'FORFAIT_ENDED')).toHaveLength(2);
    expect(result.events.filter((row) => row.kind === 'PLAN_CHANGED')).toHaveLength(1);
  });
});
