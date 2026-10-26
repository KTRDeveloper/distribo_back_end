import { beforeEach, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import type { PaidPlanCode } from '../../../src/shared/plans.js';
import { prisma } from '../../setup.js';
import { addGiftForfait, type GiftInput } from '../../../src/modules/billing/forfait.service.js';
import { findPeriod } from '../../../src/modules/billing/subscription.repository.js';

const organizationId = uuidv7();
const administratorId = uuidv7();
const adminActionId = uuidv7();
const now = new Date('2026-10-12T09:00:00Z');

function gift(overrides: Partial<GiftInput> = {}): GiftInput {
  return {
    id: uuidv7(), organizationId, plan: 'PRO', days: 30,
    actor: { administratorId, adminActionId }, now, ...overrides,
  };
}

async function paidPeriod(
  plan: PaidPlanCode,
  status: 'ACTIVE' | 'SCHEDULED',
  startsAt: string,
  endsAt: string,
) {
  const payment = await prisma.subscriptionPayment.create({ data: {
    id: uuidv7(), organizationId, plan, months: 1, amount: 10000n,
    operator: 'OTHER',
    providerReference: uuidv7(), status: 'SUCCEEDED', termsVersion: 'fixture-v1',
    confirmedAt: now,
  } });
  return prisma.subscription.create({ data: {
    id: uuidv7(), organizationId, plan, months: 1, price: 10000n,
    origin: 'PAYMENT', status, paymentId: payment.id,
    startsAt: new Date(startsAt), endsAt: new Date(endsAt),
  } });
}

beforeEach(async () => {
  const person = await prisma.person.create({ data: {
    id: uuidv7(), phoneNumber: '+237690000038', fullName: 'Fixture Administrator',
    phoneVerifiedAt: now, registeredAt: now,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    preferredLanguage: 'FR',
  } });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${organizationId}::uuid, 'Fixture Gift Business')
  `;
  await prisma.$executeRaw`
    INSERT INTO administrators (id, person_id, role, totp_secret, recovery_email)
    VALUES (${administratorId}::uuid, ${person.id}::uuid, 'SUPER_ADMIN',
            'fixture-not-a-real-secret', 'fixture@example.test')
  `;
  await prisma.$executeRaw`
    INSERT INTO admin_actions (id, administrator_id, action, target_organization_id, reason)
    VALUES (${adminActionId}::uuid, ${administratorId}::uuid, 'GIFT_DAYS',
            ${organizationId}::uuid, 'Fixture gift authorization')
  `;
});

describe('addGiftForfait', () => {
  it('nothing running', async () => {
    const input = gift();
    const period = await prisma.$transaction((tx) => addGiftForfait(tx, input));
    expect(period).toMatchObject({
      id: input.id, organizationId, plan: 'PRO', status: 'ACTIVE', origin: 'GIFT',
      startsAt: now, endsAt: new Date('2026-11-11T09:00:00Z'),
      price: 0n, months: null, paymentId: null, endReason: null,
    });
  });

  it('behind', async () => {
    const active = await paidPeriod('ESSENTIAL', 'ACTIVE',
      '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');
    const scheduled = await paidPeriod('PRO', 'SCHEDULED',
      '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
    const period = await prisma.$transaction((tx) =>
      addGiftForfait(tx, gift({ plan: 'ENTERPRISE', days: 10 })));
    expect(period).toMatchObject({
      plan: 'ENTERPRISE', status: 'SCHEDULED', origin: 'GIFT', price: 0n,
      startsAt: new Date('2026-12-01T00:00:00Z'),
      endsAt: new Date('2026-12-11T00:00:00Z'), months: null, paymentId: null,
    });
    expect(await prisma.subscription.findUnique({ where: { id: active.id } })).toEqual(active);
    expect(await prisma.subscription.findUnique({ where: { id: scheduled.id } })).toEqual(scheduled);
  });

  it('lapsed', async () => {
    const active = await paidPeriod('ESSENTIAL', 'ACTIVE',
      '2026-09-11T09:00:00Z', '2026-10-11T09:00:00Z');
    const period = await prisma.$transaction((tx) => addGiftForfait(tx, gift()));
    expect(period).toMatchObject({ status: 'SCHEDULED', startsAt: now });
    expect(await prisma.subscription.findUnique({ where: { id: active.id } })).toEqual(active);
  });

  it('journal', async () => {
    const period = await prisma.$transaction((tx) => addGiftForfait(tx, gift()));
    const events = await prisma.subscriptionEvent.findMany({ where: { organizationId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      organizationId, kind: 'FORFAIT_ADDED', actor: 'ADMINISTRATOR',
      administratorId, adminActionId, subscriptionId: period.id,
      personId: null, paymentId: null, occurredAt: now,
      details: { plan: 'PRO', days: 30, status: 'ACTIVE' },
    });
    await prisma.$transaction(async (tx) => {
      expect(await findPeriod(tx, period.id)).toEqual(period);
      expect(await findPeriod(tx, uuidv7())).toBeNull();
    });
  });

  it('race', async () => {
    const inputs = [gift(), gift()];
    const periods = await Promise.all(inputs.map((input) =>
      prisma.$transaction((tx) => addGiftForfait(tx, input))));
    const active = periods.find((period) => period.status === 'ACTIVE');
    const scheduled = periods.find((period) => period.status === 'SCHEDULED');
    expect(active).toBeDefined();
    expect(scheduled).toBeDefined();
    expect(active?.startsAt).toEqual(now);
    expect(scheduled?.startsAt).toEqual(active?.endsAt);
    expect(await prisma.subscription.count({ where: { organizationId } })).toBe(2);
    expect(await prisma.subscriptionEvent.count({ where: { organizationId } })).toBe(2);
  });

  it('rolls back the period and journal with the caller transaction', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await addGiftForfait(tx, gift());
      throw new Error('caller rollback');
    })).rejects.toThrow('caller rollback');
    expect(await prisma.subscription.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.subscriptionEvent.count({ where: { organizationId } })).toBe(0);
  });
});
