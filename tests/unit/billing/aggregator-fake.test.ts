/**
 * Unit tests for the payment aggregator port and its fake adapter (BIL-008)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeAggregator } from '../../../src/modules/billing/aggregator.fake.js';
import { getPaymentAggregator } from '../../../src/modules/billing/aggregator.js';

const request = (clientReference: string, amount = 15000n) => ({
  clientReference,
  amount,
  operator: 'MTN_MOMO' as const,
  payerPhone: '+237670000001',
  description: 'Subscription',
});

describe('FakeAggregator', () => {
  let aggregator: FakeAggregator;

  beforeEach(() => {
    aggregator = new FakeAggregator();
  });

  describe('AC-1: A request', () => {
    it('gives one reference for a repeated clientReference, PENDING with the amount', async () => {
      const first = await aggregator.requestPayment(request('client-1'));
      const second = await aggregator.requestPayment(request('client-1'));
      expect(second.providerReference).toBe(first.providerReference);

      const payment = await aggregator.getStatus(first.providerReference);
      expect(payment?.status).toBe('PENDING');
      expect(payment?.amount).toBe(15000n);
      expect(payment?.paidAt).toBeNull();
    });

    it('gives different references for different clientReferences', async () => {
      const a = await aggregator.requestPayment(request('client-a'));
      const b = await aggregator.requestPayment(request('client-b'));
      expect(a.providerReference).not.toBe(b.providerReference);
    });

    it('throws a RangeError for an amount of 0 or less (v5.0.0-2.2.1)', async () => {
      await expect(aggregator.requestPayment(request('c0', 0n))).rejects.toBeInstanceOf(RangeError);
      await expect(aggregator.requestPayment(request('c-1', -5n))).rejects.toBeInstanceOf(
        RangeError
      );
    });
  });

  describe('AC-2: Settling', () => {
    it('reads SUCCEEDED with the paidAt given; unknown reference gives null', async () => {
      const { providerReference } = await aggregator.requestPayment(request('client-2'));
      const paidAt = new Date('2026-03-04T10:00:00.000Z');
      aggregator.settle(providerReference, 'SUCCEEDED', paidAt);

      const payment = await aggregator.getStatus(providerReference);
      expect(payment?.status).toBe('SUCCEEDED');
      expect(payment?.paidAt).toEqual(paidAt);
      expect(await aggregator.getStatus('unknown-ref')).toBeNull();
    });
  });

  describe('AC-3: Confirmations', () => {
    it('accepts the output of confirmationFor', async () => {
      const { providerReference } = await aggregator.requestPayment(request('client-3'));
      expect(aggregator.verifyConfirmation(aggregator.confirmationFor(providerReference))).toEqual({
        providerReference,
      });
    });

    it('rejects the same body without the signature header', async () => {
      const { providerReference } = await aggregator.requestPayment(request('client-3'));
      const { rawBody } = aggregator.confirmationFor(providerReference);
      expect(aggregator.verifyConfirmation({ headers: {}, rawBody })).toBeNull();
    });

    it('rejects a wrong signature value', async () => {
      const { providerReference } = await aggregator.requestPayment(request('client-3'));
      const { rawBody } = aggregator.confirmationFor(providerReference);
      expect(
        aggregator.verifyConfirmation({ headers: { 'x-fake-signature': 'forged' }, rawBody })
      ).toBeNull();
    });

    it('rejects a body that is not JSON', () => {
      expect(
        aggregator.verifyConfirmation({
          headers: { 'x-fake-signature': 'valid' },
          rawBody: Buffer.from('not json {'),
        })
      ).toBeNull();
    });

    it('rejects a signed body without a providerReference string', () => {
      expect(
        aggregator.verifyConfirmation({
          headers: { 'x-fake-signature': 'valid' },
          rawBody: Buffer.from(JSON.stringify({ providerReference: 42 })),
        })
      ).toBeNull();
    });
  });

  describe('AC-4: Statement', () => {
    it('lists both payments for the settled day and none for the next', async () => {
      const a = await aggregator.requestPayment(request('client-4a'));
      const b = await aggregator.requestPayment(request('client-4b'));
      await aggregator.requestPayment(request('client-4c')); // never settled
      aggregator.settle(a.providerReference, 'SUCCEEDED', new Date('2026-03-04T00:00:00.000Z'));
      aggregator.settle(b.providerReference, 'SUCCEEDED', new Date('2026-03-04T23:59:59.999Z'));

      const day = await aggregator.listStatement('2026-03-04');
      expect(day.map((p) => p.providerReference).sort()).toEqual(
        [a.providerReference, b.providerReference].sort()
      );
      expect(await aggregator.listStatement('2026-03-05')).toEqual([]);
    });
  });

  describe('AB-1: A forged confirmation is believed (CWE-345)', () => {
    it('gives null for an unsigned body naming a pending reference, which stays PENDING', async () => {
      const { providerReference } = await aggregator.requestPayment(request('client-5'));
      const forged = Buffer.from(JSON.stringify({ providerReference, status: 'SUCCEEDED' }));

      expect(aggregator.verifyConfirmation({ headers: {}, rawBody: forged })).toBeNull();
      expect((await aggregator.getStatus(providerReference))?.status).toBe('PENDING');
    });
  });

  describe('reset', () => {
    it('forgets every payment', async () => {
      const { providerReference } = await aggregator.requestPayment(request('client-6'));
      aggregator.reset();
      expect(await aggregator.getStatus(providerReference)).toBeNull();
    });
  });
});

describe('getPaymentAggregator', () => {
  it('returns the one fake instance', () => {
    expect(getPaymentAggregator()).toBe(getPaymentAggregator());
    expect(getPaymentAggregator()).toBeInstanceOf(FakeAggregator);
  });
});

describe('AC-5: PAYMENT_DRIVER setting', () => {
  const original = process.env.PAYMENT_DRIVER;

  afterEach(() => {
    if (original === undefined) delete process.env.PAYMENT_DRIVER;
    else process.env.PAYMENT_DRIVER = original;
    vi.resetModules();
  });

  beforeEach(() => {
    vi.resetModules();
  });

  const loadEnv = (value: string | undefined) => {
    if (value === undefined) delete process.env.PAYMENT_DRIVER;
    else process.env.PAYMENT_DRIVER = value;
    return import('../../../src/config/env');
  };

  it('passes with fake by default when unset', async () => {
    const { env } = await loadEnv(undefined);
    expect(env.PAYMENT_DRIVER).toBe('fake');
  });

  it('fails and names the variable for PAYMENT_DRIVER=momo', async () => {
    await expect(loadEnv('momo')).rejects.toThrow(/PAYMENT_DRIVER/);
  });
});
