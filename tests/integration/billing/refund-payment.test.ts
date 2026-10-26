import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../setup';
import { applyRefund } from '../../../src/modules/billing/refund.service';
import { insertReceipt, nextReceiptNumber } from '../../../src/modules/billing/receipt.repository';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const START = new Date('2026-06-01T00:00:00.000Z');
const END = new Date('2026-09-01T00:00:00.000Z');
const CONFIRMED = new Date('2026-06-01T00:00:00.000Z');
let organizationId: string;
let otherOrganizationId: string;
let paymentId: string;
let administratorId: string;
let adminActionId: string;

beforeEach(async () => {
  organizationId = uuidv7();
  otherOrganizationId = uuidv7();
  paymentId = uuidv7();
  administratorId = uuidv7();
  adminActionId = uuidv7();
  const personId = uuidv7();
  await prisma.person.create({ data: {
    id: personId, phoneNumber: '+2250700008038', fullName: 'Fixture Administrator',
    phoneVerifiedAt: CONFIRMED, registeredAt: CONFIRMED,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture', preferredLanguage: 'FR',
  } });
  await prisma.organization.createMany({ data: [
    { id: organizationId, name: 'Fixture Business' },
    { id: otherOrganizationId, name: 'Fixture Other Business' },
  ] });
  await prisma.administrator.create({ data: {
    id: administratorId, personId, role: 'SUPER_ADMIN',
    totpSecret: 'fixture-encrypted-totp-secret', recoveryEmail: 'fixture@example.test',
  } });
  await prisma.adminAction.create({ data: {
    id: adminActionId, administratorId, action: 'REFUND_PAYMENT',
    targetOrganizationId: organizationId, reason: 'Fixture refund',
  } });
});

async function fixture(status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'REFUNDED' = 'SUCCEEDED') {
  await prisma.subscriptionPayment.create({ data: {
    id: paymentId, organizationId, plan: 'ESSENTIAL', months: 3, amount: 15000n,
    operator: 'MTN_MOMO', payerPhoneNumber: '+2250700008039',
    providerReference: `fixture-${paymentId}`, termsVersion: '2026-01',
  } });
  if (status !== 'PENDING') {
    await prisma.subscriptionPayment.update({ where: { id: paymentId }, data: {
      status: status === 'REFUNDED' ? 'SUCCEEDED' : status,
      confirmedAt: status === 'SUCCEEDED' || status === 'REFUNDED' ? CONFIRMED : null,
    } });
  }
  if (status === 'REFUNDED') {
    await prisma.subscriptionPayment.update({ where: { id: paymentId }, data: { status: 'REFUNDED' } });
  }
  return prisma.$transaction(async (tx) => insertReceipt(tx, await nextReceiptNumber(tx, CONFIRMED), {
    organizationId, paymentId, customerName: 'Fixture Customer', customerTaxId: 'FIXTURE-TAX-38',
    label: 'Fixture Essential, 3 months', amountExclTax: 12579n,
    vatRateBp: 1925, vatAmount: 2421n, amount: 15000n, issuedAt: CONFIRMED,
  }));
}

async function period(status: 'ACTIVE' | 'SCHEDULED' | 'ENDED' = 'ACTIVE') {
  return prisma.subscription.create({ data: {
    id: uuidv7(), organizationId, paymentId, plan: 'ESSENTIAL', months: 3,
    price: 15000n, origin: 'PAYMENT', status,
    startsAt: status === 'SCHEDULED' ? END : START,
    endsAt: status === 'SCHEDULED' ? new Date('2026-12-01T00:00:00.000Z') : END,
    endReason: status === 'ENDED' ? 'EXPIRED' : null,
  } });
}

function refund(tx: Prisma.TransactionClient, scope = organizationId) {
  return applyRefund(tx, {
    paymentId, organizationId: scope, actor: { administratorId, adminActionId }, now: NOW,
  });
}

async function events() {
  return prisma.$queryRaw<Array<{
    kind: string; actor: string; administrator_id: string; admin_action_id: string;
    payment_id: string; subscription_id: string | null; occurred_at: Date;
  }>>`SELECT kind, actor, administrator_id, admin_action_id, payment_id, subscription_id, occurred_at
      FROM subscription_events WHERE organization_id = ${organizationId}::uuid`;
}

async function snapshot() {
  return {
    payment: await prisma.subscriptionPayment.findUnique({ where: { id: paymentId } }),
    receipts: await prisma.subscriptionReceipt.findMany({ where: { paymentId }, orderBy: { number: 'asc' } }),
    periods: await prisma.subscription.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
    events: await events(),
  };
}

describe('applyRefund', () => {
  it('active: preserves the confirmation and receipt amounts and ends the period with administrator events', async () => {
    const receipt = await fixture();
    const active = await period();
    const result = await prisma.$transaction((tx) => refund(tx));
    expect(result.endedIds).toEqual([active.id]);
    expect(result.creditNote).toMatchObject({
      number: 'R-2026-000002', kind: 'CREDIT_NOTE', cancelsReceiptId: receipt.id,
      organizationId, paymentId, label: `Avoir — ${receipt.label}`,
      customerName: receipt.customerName, customerTaxId: receipt.customerTaxId,
      amountExclTax: receipt.amountExclTax, vatRateBp: receipt.vatRateBp,
      vatAmount: receipt.vatAmount, amount: receipt.amount, issuedAt: NOW,
    });
    expect(await prisma.subscriptionPayment.findUnique({ where: { id: paymentId } }))
      .toMatchObject({ status: 'REFUNDED', confirmedAt: CONFIRMED });
    expect(await prisma.subscriptionReceipt.findUnique({ where: { id: receipt.id } })).toEqual(receipt);
    expect(await prisma.subscription.findUnique({ where: { id: active.id } }))
      .toMatchObject({ status: 'ENDED', endReason: 'REFUNDED', startsAt: START, endsAt: NOW });
    const journal = await events();
    expect(journal).toHaveLength(2);
    expect(journal).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'FORFAIT_ENDED', subscription_id: active.id }),
      expect.objectContaining({ kind: 'PAYMENT', payment_id: paymentId }),
    ]));
    for (const event of journal) {
      expect(event).toMatchObject({ actor: 'ADMINISTRATOR', administrator_id: administratorId,
        admin_action_id: adminActionId, occurred_at: NOW });
    }
  });

  it('scheduled: ends at its start and leaves the following period unchanged', async () => {
    await fixture();
    const scheduled = await period('SCHEDULED');
    const following = await prisma.subscription.create({ data: {
      id: uuidv7(), organizationId, plan: 'ESSENTIAL', origin: 'GIFT', status: 'SCHEDULED',
      price: 0n, startsAt: scheduled.endsAt, endsAt: new Date('2026-12-10T00:00:00.000Z'),
    } });
    const result = await prisma.$transaction((tx) => refund(tx));
    expect(result.endedIds).toEqual([scheduled.id]);
    expect(await prisma.subscription.findUnique({ where: { id: scheduled.id } }))
      .toMatchObject({ status: 'ENDED', endReason: 'REFUNDED', endsAt: scheduled.startsAt });
    expect(await prisma.subscription.findUnique({ where: { id: following.id } })).toEqual(following);
  });

  it('over: issues a credit note without changing an already expired period', async () => {
    await fixture();
    const expired = await period('ENDED');
    const result = await prisma.$transaction((tx) => refund(tx));
    expect(result.creditNote.kind).toBe('CREDIT_NOTE');
    expect(result.endedIds).toEqual([]);
    expect(await prisma.subscription.findUnique({ where: { id: expired.id } })).toEqual(expired);
    expect(await events()).toEqual([expect.objectContaining({ kind: 'PAYMENT', payment_id: paymentId })]);
  });

  it.each(['PENDING', 'FAILED', 'EXPIRED', 'REFUNDED'] as const)('refused: %s writes nothing', async (status) => {
    await fixture(status);
    const before = await snapshot();
    await expect(prisma.$transaction((tx) => refund(tx)))
      .rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_NOT_REFUNDABLE' });
    expect(await snapshot()).toEqual(before);
  });

  it('refused: another business sees NOT_FOUND and no changes', async () => {
    await fixture();
    await period();
    const before = await snapshot();
    await expect(prisma.$transaction((tx) => refund(tx, otherOrganizationId)))
      .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(await snapshot()).toEqual(before);
  });

  it('refused: an unknown payment sees NOT_FOUND and no changes', async () => {
    const before = await snapshot();
    await expect(prisma.$transaction((tx) => refund(tx)))
      .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(await snapshot()).toEqual(before);
  });

  it('race: concurrent refunds create one credit note and the loser receives 409', async () => {
    await fixture();
    await period();
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => refund(tx)), prisma.$transaction((tx) => refund(tx)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected'))
      .toMatchObject({ reason: { statusCode: 409, code: 'PAYMENT_NOT_REFUNDABLE' } });
    expect(await prisma.subscriptionReceipt.count({ where: { paymentId, kind: 'CREDIT_NOTE' } })).toBe(1);
    expect(await events()).toHaveLength(2);
  });

  it('rolls back every refund write and reuses its number when the caller aborts', async () => {
    await fixture();
    await period();
    const before = await snapshot();
    await expect(prisma.$transaction(async (tx) => {
      await refund(tx);
      throw new Error('caller rollback');
    })).rejects.toThrow('caller rollback');
    expect(await snapshot()).toEqual(before);
    const result = await prisma.$transaction((tx) => refund(tx));
    expect(result.creditNote.number).toBe('R-2026-000002');
  });
});
