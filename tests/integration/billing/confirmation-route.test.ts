import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';
import { app } from '../../../src/app.js';
import { logger } from '../../../src/lib/logger.js';
import { jsonBodyParser } from '../../../src/middleware/body-parser.js';
import { getPaymentAggregator } from '../../../src/modules/billing/aggregator.js';
import { FakeAggregator } from '../../../src/modules/billing/aggregator.fake.js';
import { handleConfirmation } from '../../../src/modules/billing/billing.service.js';

const PATH = '/api/v1/billing/confirmations';
const ORG = '0199c034-0000-7000-8000-000000000001';
const OWNER = '0199c034-0000-7000-8000-000000000011';
const PAYMENT = '0199c034-0000-7000-8000-000000000021';
const aggregator = getPaymentAggregator() as FakeAggregator;
let reference: string;

beforeEach(async () => {
  aggregator.reset();
  await prisma.person.create({ data: {
    id: OWNER, phoneNumber: '+2250700034011', fullName: 'Fixture Owner',
    phoneVerifiedAt: new Date(), registeredAt: new Date(), passwordHash: 'fixture',
  } });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG}::uuid, 'Fixture Business')`;
    await tx.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status)
      VALUES ('0199c034-0000-7000-8000-000000000041'::uuid, ${OWNER}::uuid, ${ORG}::uuid, 'OWNER', 'ACTIVE')
    `;
  });
  ({ providerReference: reference } = await aggregator.requestPayment({
    clientReference: PAYMENT, amount: 15000n, operator: 'MTN_MOMO',
    payerPhone: '+2250700034011', description: 'Fixture payment',
  }));
  await prisma.subscriptionPayment.create({ data: {
    id: PAYMENT, organizationId: ORG, plan: 'ESSENTIAL', months: 3, amount: 15000n,
    operator: 'MTN_MOMO', payerPhoneNumber: '+2250700034011', providerReference: reference,
    termsVersion: 'fixture-v1',
  } });
});

afterEach(() => vi.restoreAllMocks());

function postSigned(providerReference = reference) {
  const { rawBody } = aggregator.confirmationFor(providerReference);
  return request(app).post(PATH).set('Content-Type', 'application/json')
    .set('X-Fake-Signature', 'valid').send(rawBody.toString('utf8'));
}

async function expectNoActivation(status = 'PENDING') {
  expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: PAYMENT } }))
    .toMatchObject({ status, confirmedAt: null });
  expect(await prisma.subscription.count()).toBe(0);
  expect(await prisma.subscriptionReceipt.count()).toBe(0);
}

describe('public aggregator confirmations', () => {
  it('accepts a genuine confirmation and activates the plan with only an OK response', async () => {
    aggregator.settle(reference, 'SUCCEEDED');
    const response = await postSigned();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'OK' });
    expect(await prisma.subscription.findFirstOrThrow()).toMatchObject({
      paymentId: PAYMENT, status: 'ACTIVE', plan: 'ESSENTIAL',
    });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: ORG } }))
      .toMatchObject({ plan: 'ESSENTIAL' });
  });

  it('answers OK twice for a repeat with only one period and receipt', async () => {
    aggregator.settle(reference, 'SUCCEEDED');
    for (let i = 0; i < 2; i++) {
      const response = await postSigned();
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'OK' });
    }
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.subscriptionReceipt.count()).toBe(1);
  });

  it.each(['missing signature', 'wrong signature', 'empty body'])('rejects %s without querying status', async (problem) => {
    const getStatus = vi.spyOn(aggregator, 'getStatus');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const call = request(app).post(PATH).set('Content-Type', 'application/json');
    if (problem !== 'missing signature') {
      call.set('X-Fake-Signature', problem === 'wrong signature' ? 'wrong' : 'valid');
    }
    const response = await call.send(problem === 'empty body' ? '' : JSON.stringify({
      providerReference: reference, status: 'SUCCEEDED', private: 'untrusted-private-body',
    }));
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    await expectNoActivation();
    expect(getStatus).not.toHaveBeenCalled();
    const rejected = warn.mock.calls.filter(([entry]) =>
      typeof entry === 'object' && entry !== null && 'event' in entry
      && entry.event === 'payment_confirmation_rejected');
    expect(rejected).toEqual([[{ event: 'payment_confirmation_rejected' }, 'Payment confirmation rejected']]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('untrusted-private-body');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(reference);
  });

  it('answers NOT_FOUND for an authenticated unknown reference', async () => {
    const response = await postSigned('unknown-reference');
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    await expectNoActivation();
  });

  it('does not trust a signed success claim when the provider is still pending', async () => {
    const response = await request(app).post(PATH).set('X-Fake-Signature', 'valid')
      .send({ providerReference: reference, status: 'SUCCEEDED' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'OK' });
    await expectNoActivation();
  });

  it.each(['FAILED', 'EXPIRED'] as const)('acknowledges provider %s without exposing the outcome', async (status) => {
    aggregator.settle(reference, status);
    const response = await postSigned();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'OK' });
    await expectNoActivation(status);
  });

  it('retains exact raw bytes and lower-case string headers for verification', async () => {
    aggregator.settle(reference, 'SUCCEEDED');
    const verify = vi.spyOn(aggregator, 'verifyConfirmation');
    const raw = ` { "providerReference" : "${reference}", "status": "SUCCEEDED" }\n`;
    const response = await request(app).post(PATH).set('Content-Type', 'application/json')
      .set('X-Fake-Signature', 'valid').send(raw);
    expect(response.status).toBe(200);
    expect(verify).toHaveBeenCalledExactlyOnceWith({
      headers: expect.objectContaining({ 'x-fake-signature': 'valid' }) as unknown, rawBody: Buffer.from(raw),
    });
    const headers = verify.mock.calls[0]?.[0].headers ?? {};
    expect(Object.entries(headers).every(([key, value]) => key === key.toLowerCase()
      && (typeof value === 'string' || value === undefined))).toBe(true);
    expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: PAYMENT } }))
      .toMatchObject({ providerPayload: { received: { providerReference: reference, status: 'SUCCEEDED' } } });
  });

  it('keeps ordinary JSON parsing unchanged and captures bytes only on the exact path', async () => {
    const parserApp = express();
    parserApp.use(jsonBodyParser);
    parserApp.post(/.*/, (req, res) => {
      res.json({ parsed: req.body as unknown, hasRawBody: Buffer.isBuffer(req.rawBody) });
    });
    for (const path of ['/ordinary', `${PATH}/`, `${PATH}/other`]) {
      const response = await request(parserApp).post(path).send({ value: 'fixture' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ parsed: { value: 'fixture' }, hasRawBody: false });
    }
    const response = await request(parserApp).post(`${PATH}?attempt=1`).send({ value: 'fixture' });
    expect(response.body).toEqual({ parsed: { value: 'fixture' }, hasRawBody: true });
  });

  it('rejects a body over 100 kb before verification', async () => {
    const verify = vi.spyOn(aggregator, 'verifyConfirmation');
    const response = await request(app).post(PATH).set('X-Fake-Signature', 'valid')
      .send({ providerReference: reference, padding: 'x'.repeat(100 * 1024) });
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(verify).not.toHaveBeenCalled();
    await expectNoActivation();
  });

  it('fails closed when no raw body is available even if the parsed body claims success', async () => {
    const verify = vi.spyOn(aggregator, 'verifyConfirmation');
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await expect(handleConfirmation({ 'x-fake-signature': 'valid' }, undefined,
      { providerReference: reference, status: 'SUCCEEDED' }, new Date()))
      .rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    expect(verify).not.toHaveBeenCalled();
    await expectNoActivation();
  });

  it('returns PAYMENT_MISMATCH without activating on a verified wrong amount', async () => {
    vi.spyOn(aggregator, 'getStatus').mockResolvedValue({
      providerReference: reference, status: 'SUCCEEDED', amount: 1n, paidAt: new Date(),
    });
    const response = await postSigned();
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: 'PAYMENT_MISMATCH' } });
    await expectNoActivation();
  });
});
