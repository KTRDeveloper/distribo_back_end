import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { app } from '../../../src/app.js';
import { signAccessToken, signAdminToken } from '../../../src/lib/jwt.js';
import * as adjustment from '../../../src/modules/billing/adjustment-notice.js';
import { recordPayment } from '../../../src/modules/billing/record-payment.service.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { prisma } from '../../setup.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');
let org: string;
let otherOrg: string;
let owner: string;
let admin: string;
let adminPerson: string;
let moderator: string;
let modPerson: string;
let payment: string;
const input = { reason: 'Fixture mistaken payment' };
const url = (organizationId = org, paymentId = payment) =>
  `/api/v1/admin/organizations/${organizationId}/billing/payments/${paymentId}/refund`;
const token = (role: 'SUPER_ADMIN' | 'MODERATOR' = 'SUPER_ADMIN') => signAdminToken({
  personId: role === 'SUPER_ADMIN' ? adminPerson : modPerson,
  administratorId: role === 'SUPER_ADMIN' ? admin : moderator, role,
});
const post = (organizationId = org, paymentId = payment) =>
  request(app).post(url(organizationId, paymentId)).auth(token(), { type: 'bearer' }).send(input);

async function snapshot() {
  return {
    payments: await prisma.subscriptionPayment.findMany({ orderBy: { id: 'asc' } }),
    periods: await prisma.subscription.findMany({ orderBy: { id: 'asc' } }),
    receipts: await prisma.subscriptionReceipt.findMany({ orderBy: { id: 'asc' } }),
    actions: await prisma.adminAction.findMany({ orderBy: { id: 'asc' } }),
    events: await prisma.subscriptionEvent.findMany({ orderBy: { id: 'asc' } }),
    notices: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    organizations: await prisma.organization.findMany({ orderBy: { id: 'asc' } }),
    seats: await prisma.collaboration.findMany({ orderBy: { id: 'asc' } }),
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  [org, otherOrg, owner, admin, adminPerson, moderator, modPerson, payment] = Array.from({ length: 8 }, () => uuidv7());
  await prisma.person.createMany({ data: [owner, adminPerson, modPerson].map((id, index) => ({
    id, fullName: 'Fixture Person', phoneNumber: `+22507000250${index}1`,
    phoneVerifiedAt: NOW, registeredAt: NOW, preferredLanguage: 'FR',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
  })) });
  await prisma.administrator.createMany({ data: [
    { id: admin, personId: adminPerson, role: 'SUPER_ADMIN', totpSecret: 'fixture-encrypted-secret' },
    { id: moderator, personId: modPerson, role: 'MODERATOR', totpSecret: 'fixture-encrypted-secret' },
  ] });
  await prisma.$transaction(async (tx) => {
    await tx.organization.createMany({ data: [
      { id: org, name: 'Fixture Business' }, { id: otherOrg, name: 'Fixture Other Business' },
    ] });
    await tx.collaboration.createMany({ data: [
      { id: uuidv7(), personId: owner, organizationId: org, role: 'OWNER', status: 'ACTIVE' },
      { id: uuidv7(), personId: adminPerson, organizationId: otherOrg, role: 'OWNER', status: 'ACTIVE' },
    ] });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function succeeded() {
  await recordPayment({ administratorId: admin }, org, {
    id: payment, plan: 'ESSENTIAL', months: 3, reason: 'Fixture external payment',
  }, new Date('2026-10-01T12:00:00.000Z'));
}

async function addTeam() {
  for (let index = 0; index < 4; index++) {
    const personId = uuidv7();
    await prisma.person.create({ data: {
      id: personId, phoneNumber: `+22507000251${index}1`, fullName: 'Fixture Seller',
      registeredAt: NOW, phoneVerifiedAt: NOW,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    } });
    await prisma.collaboration.create({ data: {
      id: uuidv7(), personId, organizationId: org, role: 'SELLER', status: 'ACTIVE',
    } });
  }
}

describe('BIL-025 administrator refund gesture', () => {
  it('refund: returns only the credit-note view and atomically stops rights and excess seats', async () => {
    await succeeded();
    await addTeam();
    const response = await post();
    expect(response.status).toBe(200);
    const original = await prisma.subscriptionReceipt.findFirstOrThrow({ where: { kind: 'RECEIPT' } });
    const credit = await prisma.subscriptionReceipt.findFirstOrThrow({ where: { kind: 'CREDIT_NOTE' } });
    expect(bodyOf<unknown>(response)).toEqual({ payment_id: payment, status: 'REFUNDED', credit_note: {
      number: credit.number, kind: 'CREDIT_NOTE', label: credit.label,
      customer_name: original.customerName, customer_tax_id: original.customerTaxId,
      amount_excl_tax: Number(original.amountExclTax), vat_rate_bp: original.vatRateBp,
      vat_amount: Number(original.vatAmount), amount: Number(original.amount), issued_at: NOW.toISOString(),
    } });
    expect(credit.cancelsReceiptId).toBe(original.id);
    expect(credit.amount).toBe(credit.amountExclTax + credit.vatAmount);
    expect(Number(credit.number.split('-').at(-1))).toBe(Number(original.number.split('-').at(-1)) + 1);
    expect(await prisma.subscriptionReceipt.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await prisma.subscriptionPayment.findUnique({ where: { id: payment } })).toMatchObject({ status: 'REFUNDED' });
    expect(await prisma.subscription.findFirst()).toMatchObject({ status: 'ENDED', endReason: 'REFUNDED', endsAt: NOW });
    expect(await prisma.organization.findUnique({ where: { id: org } })).toMatchObject({ plan: 'FREE', planEndsAt: null });
    expect(await prisma.collaboration.count({ where: { organizationId: org, role: 'SELLER', status: 'PAUSED' } })).toBe(2);
    const actions = await prisma.adminAction.findMany({ where: { action: 'REFUND_PAYMENT' } });
    expect(actions).toEqual([expect.objectContaining({ administratorId: admin, targetOrganizationId: org, reason: input.reason })]);
    const notices = await prisma.notification.findMany({ where: { recipientId: owner, sourceEvent: 'subscription.adjusted' } });
    expect(notices).toHaveLength(2);
    for (const notice of notices) expect(notice.content).not.toContain(input.reason);
  });

  it('repeat: returns the first response without any writes, even with a new reason and clock', async () => {
    await succeeded();
    const first = await post();
    expect(first.status).toBe(200);
    const before = await snapshot();
    vi.setSystemTime(new Date('2026-10-27T12:00:00.000Z'));
    const repeat = await request(app).post(url()).auth(token(), { type: 'bearer' }).send({ reason: 'Fixture retry' });
    expect(repeat.status).toBe(200);
    expect(bodyOf<unknown>(repeat)).toEqual(bodyOf<unknown>(first));
    expect(await snapshot()).toEqual(before);
    expect(before.receipts.filter((row) => row.kind === 'CREDIT_NOTE')).toHaveLength(1);
  });

  it.each(['PENDING', 'FAILED', 'EXPIRED'] as const)('refused: %s writes nothing', async (status) => {
    await prisma.subscriptionPayment.create({ data: {
      id: payment, organizationId: org, plan: 'ESSENTIAL', months: 3, amount: 15000n,
      operator: 'MTN_MOMO', payerPhoneNumber: '+2250700025099', providerReference: `fixture-${payment}`, termsVersion: 'fixture',
    } });
    if (status !== 'PENDING') await prisma.subscriptionPayment.update({ where: { id: payment }, data: { status } });
    const before = await snapshot();
    const response = await post();
    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('PAYMENT_NOT_REFUNDABLE');
    expect(await snapshot()).toEqual(before);
  });

  it('other business: hides foreign and unknown payment ids without writes', async () => {
    await succeeded();
    const before = await snapshot();
    for (const [organizationId, paymentId] of [[otherOrg, payment], [org, uuidv7()]]) {
      const response = await post(organizationId, paymentId);
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each([{}, { reason: '' }, { reason: 'x'.repeat(2001) }, { ...input, status: 'REFUNDED' }])(
    'refused: invalid body %j writes nothing', async (body) => {
      await succeeded();
      const before = await snapshot();
      const response = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(body);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await snapshot()).toEqual(before);
    },
  );

  it('refused: validates both UUIDs without writes', async () => {
    const before = await snapshot();
    for (const [organizationId, paymentId] of [['invalid', payment], [org, 'invalid']]) {
      const response = await post(organizationId, paymentId);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    expect(await snapshot()).toEqual(before);
  });

  it('refused: requires an administration token', async () => {
    await succeeded();
    const before = await snapshot();
    const missing = await request(app).post(url()).send(input);
    expect(missing.status).toBe(401);
    expect(bodyOf<ErrorBody>(missing).error.code).toBe('UNAUTHORIZED');
    const wrong = await request(app).post(url()).auth(signAccessToken({ personId: owner, deviceId: payment }), { type: 'bearer' }).send(input);
    expect(wrong.status).toBe(401);
    expect(await snapshot()).toEqual(before);
  });

  it('moderator: denies valid and invalid bodies before validation, without writes', async () => {
    await succeeded();
    const before = await snapshot();
    for (const body of [input, {}]) {
      const response = await request(app).post(url()).auth(token('MODERATOR'), { type: 'bearer' }).send(body);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    }
    expect(await snapshot()).toEqual(before);
  });

  it('serializes concurrent refunds into one credit note, action and notice', async () => {
    await succeeded();
    const responses = await Promise.all(Array.from({ length: 3 }, () => post()));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    for (const response of responses) expect(bodyOf<unknown>(response)).toEqual(bodyOf<unknown>(responses[0]));
    expect(await prisma.subscriptionReceipt.count({ where: { kind: 'CREDIT_NOTE' } })).toBe(1);
    expect(await prisma.adminAction.count({ where: { action: 'REFUND_PAYMENT' } })).toBe(1);
    expect(await prisma.notification.count({ where: { recipientId: owner, sourceEvent: 'subscription.adjusted' } })).toBe(2);
  });

  it('rolls back refund, audit, credit note, rights and seats if the final notice fails', async () => {
    await succeeded();
    await addTeam();
    const before = await snapshot();
    vi.spyOn(adjustment, 'notifyOwnerOfAdjustment').mockRejectedValueOnce(new Error('Fixture notice failure'));
    const response = await post();
    expect(response.status).toBe(500);
    expect(await snapshot()).toEqual(before);
    const retry = await post();
    expect(retry.status).toBe(200);
    const original = await prisma.subscriptionReceipt.findFirstOrThrow({ where: { kind: 'RECEIPT' } });
    const credit = await prisma.subscriptionReceipt.findFirstOrThrow({ where: { kind: 'CREDIT_NOTE' } });
    expect(Number(credit.number.split('-').at(-1))).toBe(Number(original.number.split('-').at(-1)) + 1);
  });
});
