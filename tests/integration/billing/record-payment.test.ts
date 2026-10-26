import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { signAccessToken, signAdminToken } from '../../../src/lib/jwt.js';
import * as receipts from '../../../src/modules/billing/receipt.service.js';
import * as adjustment from '../../../src/modules/billing/adjustment-notice.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { prisma } from '../../setup.js';

const ORG = '0199c024-0000-7000-8000-000000000001';
const OTHER_ORG = '0199c024-0000-7000-8000-000000000002';
const OWNER = '0199c024-0000-7000-8000-000000000011';
const ADMIN_PERSON = '0199c024-0000-7000-8000-000000000012';
const MOD_PERSON = '0199c024-0000-7000-8000-000000000013';
const ADMIN = '0199c024-0000-7000-8000-000000000021';
const MOD = '0199c024-0000-7000-8000-000000000022';
const PAYMENT = '0199c024-0000-7000-8000-000000000031';
const NOW = new Date('2026-10-26T00:00:00.000Z');
const input = { id: PAYMENT, plan: 'ESSENTIAL', months: 3, customer_tax_id: 'P123456789012A', reason: 'Fixture external payment' };
const url = (organizationId = ORG) => `/api/v1/admin/organizations/${organizationId}/billing/payments`;
const token = (role: 'SUPER_ADMIN' | 'MODERATOR' = 'SUPER_ADMIN') => signAdminToken({
  personId: role === 'SUPER_ADMIN' ? ADMIN_PERSON : MOD_PERSON,
  administratorId: role === 'SUPER_ADMIN' ? ADMIN : MOD, role,
});
const emptyCounts = { payments: 0, periods: 0, receipts: 0, actions: 0, events: 0, notices: 0 };
const singleCounts = { payments: 1, periods: 1, receipts: 1, actions: 1, events: 2, notices: 1 };

async function counts() {
  return {
    payments: await prisma.subscriptionPayment.count(),
    periods: await prisma.subscription.count(),
    receipts: await prisma.subscriptionReceipt.count(),
    actions: await prisma.adminAction.count(),
    events: await prisma.subscriptionEvent.count(),
    notices: await prisma.notification.count(),
  };
}

async function addOtherBusiness() {
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: OTHER_ORG, name: 'Fixture Other Business' } });
    await tx.collaboration.create({ data: {
      id: '0199c024-0000-7000-8000-000000000042', personId: ADMIN_PERSON,
      organizationId: OTHER_ORG, role: 'OWNER', status: 'ACTIVE',
    } });
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await prisma.person.createMany({ data: [OWNER, ADMIN_PERSON, MOD_PERSON].map((id, index) => ({
    id, fullName: 'Fixture Person', phoneNumber: `+22507000240${index}1`,
    phoneVerifiedAt: NOW, registeredAt: NOW, preferredLanguage: 'FR',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
  })) });
  await prisma.administrator.createMany({ data: [
    { id: ADMIN, personId: ADMIN_PERSON, role: 'SUPER_ADMIN', totpSecret: 'fixture-encrypted-secret' },
    { id: MOD, personId: MOD_PERSON, role: 'MODERATOR', totpSecret: 'fixture-encrypted-secret' },
  ] });
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: ORG, name: 'Fixture Business' } });
    await tx.collaboration.create({ data: {
      id: '0199c024-0000-7000-8000-000000000041', personId: OWNER,
      organizationId: ORG, role: 'OWNER', status: 'ACTIVE',
    } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('BIL-024 administrator recorded payments', () => {
  it('recorded: prices the pack, activates its period and returns the BIL-015 receipt projection', async () => {
    const response = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(input);
    expect(response.status).toBe(201);
    const [receipt] = await prisma.subscriptionReceipt.findMany();
    expect(bodyOf<unknown>(response)).toEqual({
      id: PAYMENT, status: 'SUCCEEDED', business_name: 'Fixture Business', plan: 'ESSENTIAL',
      months: 3, amount: 15000, operator: 'OTHER',
      period: { starts_at: NOW.toISOString(), ends_at: '2027-01-26T00:00:00.000Z' },
      receipt: {
        number: receipt.number, label: receipt.label, customer_name: 'Fixture Business',
        customer_tax_id: input.customer_tax_id, amount_excl_tax: Number(receipt.amountExclTax),
        vat_rate_bp: receipt.vatRateBp, vat_amount: Number(receipt.vatAmount), amount: 15000,
        issued_at: NOW.toISOString(),
      },
    });
    expect(await prisma.subscriptionPayment.findUnique({ where: { id: PAYMENT } })).toMatchObject({
      status: 'SUCCEEDED', operator: 'OTHER', payerPhoneNumber: null, amount: 15000n,
      providerReference: `ADMIN-${PAYMENT}`, termsVersion: 'ADMIN', confirmedAt: NOW,
    });
    const [period] = await prisma.subscription.findMany();
    expect(period).toMatchObject({ status: 'ACTIVE', plan: 'ESSENTIAL', months: 3, price: 15000n, paymentId: PAYMENT });
    const [action] = await prisma.adminAction.findMany();
    expect(action).toMatchObject({ action: 'RECORD_PAYMENT', administratorId: ADMIN, targetOrganizationId: ORG, reason: input.reason });
    expect(await prisma.subscriptionEvent.findMany({ where: { kind: 'PAYMENT' } })).toEqual([
      expect.objectContaining({ actor: 'ADMINISTRATOR', administratorId: ADMIN, adminActionId: action.id,
        subscriptionId: period.id, paymentId: PAYMENT, personId: null }),
    ]);
    const [notice] = await prisma.notification.findMany();
    expect(notice).toMatchObject({ recipientId: OWNER, organizationId: ORG, sourceEvent: 'subscription.adjusted' });
    expect(notice.content).not.toContain(input.reason);
    expect(await prisma.organization.findUnique({ where: { id: ORG } })).toMatchObject({ plan: 'ESSENTIAL', planEndsAt: period.endsAt });
    expect(await counts()).toEqual(singleCounts);
  });

  it('repeat: returns the first payment without writes and rejects another plan or months', async () => {
    const first = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(input);
    const second = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(input);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(bodyOf<unknown>(second)).toEqual(bodyOf<unknown>(first));
    for (const change of [{ plan: 'PRO' }, { months: 6 }]) {
      const conflict = await request(app).post(url()).auth(token(), { type: 'bearer' }).send({ ...input, ...change });
      expect(conflict.status).toBe(409);
      expect(bodyOf<ErrorBody>(conflict).error.code).toBe('ID_USED');
    }
    expect(await counts()).toEqual(singleCounts);
  });

  it.each([
    { amount: 1 }, { status: 'SUCCEEDED' }, { operator: 'OTHER' }, { months: 2 }, { plan: 'FREE' },
    { reason: undefined }, { reason: '' }, { reason: 'x'.repeat(2001) },
    { customer_tax_id: 'P 123' }, { customer_tax_id: '' }, { customer_tax_id: 'a'.repeat(21) },
    { id: 'bad-id' },
  ])('refused: rejects invalid body %j without writes', async (change) => {
    const response = await request(app).post(url()).auth(token(), { type: 'bearer' }).send({ ...input, ...change });
    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await counts()).toEqual(emptyCounts);
  });

  it('refused: requires an administration token and an existing business', async () => {
    const missingToken = await request(app).post(url()).send(input);
    expect(missingToken.status).toBe(401);
    expect(bodyOf<ErrorBody>(missingToken).error.code).toBe('UNAUTHORIZED');
    const appToken = signAccessToken({ personId: OWNER, deviceId: PAYMENT });
    const wrongToken = await request(app).post(url()).auth(appToken, { type: 'bearer' }).send(input);
    expect(wrongToken.status).toBe(401);
    const missing = await request(app).post(url(OTHER_ORG)).auth(token(), { type: 'bearer' }).send(input);
    expect(missing.status).toBe(404);
    expect(bodyOf<ErrorBody>(missing).error.code).toBe('NOT_FOUND');
    expect(await counts()).toEqual(emptyCounts);
  });

  it('moderator: rejects valid and invalid bodies before validation', async () => {
    for (const body of [input, { months: 2 }]) {
      const response = await request(app).post(url()).auth(token('MODERATOR'), { type: 'bearer' }).send(body);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    }
    expect(await counts()).toEqual(emptyCounts);
  });

  it('half done: rolls back all writes when receipt issuance throws', async () => {
    vi.spyOn(receipts, 'issueReceipt').mockRejectedValueOnce(new Error('Fixture receipt failure'));
    const response = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(input);
    expect(response.status).toBe(500);
    expect(await counts()).toEqual(emptyCounts);
    expect(await prisma.organization.findUnique({ where: { id: ORG } })).toMatchObject({ plan: 'FREE', planEndsAt: null });
  });

  it('serializes simultaneous repeats into one payment and one set of effects', async () => {
    const responses = await Promise.all(Array.from({ length: 3 }, () =>
      request(app).post(url()).auth(token(), { type: 'bearer' }).send(input)));
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);
    for (const response of responses) expect(bodyOf<unknown>(response)).toEqual(bodyOf<unknown>(responses[0]));
    expect(await counts()).toEqual(singleCounts);
  });

  it('returns ID_USED when two businesses concurrently use the same payment id', async () => {
    await addOtherBusiness();
    const responses = await Promise.all([ORG, OTHER_ORG].map((organizationId) =>
      request(app).post(url(organizationId)).auth(token(), { type: 'bearer' }).send(input)));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(bodyOf<ErrorBody>(responses.find((response) => response.status === 409)!).error.code).toBe('ID_USED');
    expect(await counts()).toEqual(singleCounts);
  });

  it('rolls back payment, rights, audit and receipt if the final owner notice fails', async () => {
    vi.spyOn(adjustment, 'notifyOwnerOfAdjustment').mockRejectedValueOnce(new Error('Fixture notice failure'));
    const response = await request(app).post(url()).auth(token(), { type: 'bearer' }).send(input);
    expect(response.status).toBe(500);
    expect(await counts()).toEqual(emptyCounts);
    expect(await prisma.organization.findUnique({ where: { id: ORG } })).toMatchObject({ plan: 'FREE', planEndsAt: null });
  });
});
