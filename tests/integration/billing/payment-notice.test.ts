import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup.js';
import { getPaymentAggregator } from '../../../src/modules/billing/aggregator.js';
import { confirmPayment } from '../../../src/modules/billing/confirmation.service.js';
import * as notifications from '../../../src/modules/notification/notification.service.js';

const ORG = '0199c035-0000-7000-8000-000000000001';
const OWNER = '0199c035-0000-7000-8000-000000000011';
const PAYMENT = '0199c035-0000-7000-8000-000000000021';
const REFERENCE = 'payment-notice-fixture';
const NOW = new Date('2026-10-12T12:00:00Z');
const PAYER_PHONE = '+237677123456';

beforeEach(async () => {
  vi.spyOn(getPaymentAggregator(), 'getStatus').mockResolvedValue({
    providerReference: REFERENCE, status: 'SUCCEEDED', amount: 15000n, paidAt: NOW,
  });
  await prisma.person.create({ data: {
    id: OWNER, phoneNumber: '+2250700035011', fullName: 'Fixture Owner',
    phoneVerifiedAt: NOW, registeredAt: NOW, passwordHash: 'fixture', preferredLanguage: 'FR',
  } });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG}::uuid, 'Fixture Business')`;
    await tx.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status)
      VALUES ('0199c035-0000-7000-8000-000000000031'::uuid, ${OWNER}::uuid, ${ORG}::uuid, 'OWNER', 'ACTIVE')
    `;
  });
  await prisma.subscriptionPayment.create({ data: {
    id: PAYMENT, organizationId: ORG, plan: 'ESSENTIAL', months: 3, amount: 15000n,
    operator: 'MTN_MOMO', payerPhoneNumber: PAYER_PHONE, providerReference: REFERENCE,
    termsVersion: 'fixture-v1',
  } });
});

afterEach(() => vi.restoreAllMocks());

describe('payment notice', () => {
  it.each([
    ['FR', "Paiement de 15 000 reçu du +237 6 77… : Essentiel actif jusqu'au 12 janvier 2027."],
    ['EN', 'Payment of 15,000 received from +237 6 77…: Essential active until January 12, 2027.'],
  ] as const)('notifies the owner in %s with a masked payer number', async (language, content) => {
    await prisma.person.update({ where: { id: OWNER }, data: { preferredLanguage: language } });
    expect(await confirmPayment(REFERENCE, {}, NOW)).toBe('ACTIVATED');
    const notices = await prisma.notification.findMany();
    expect(notices).toEqual([expect.objectContaining({
      recipientId: OWNER, organizationId: ORG, sourceEvent: 'subscription.paid',
      readStatus: 'UNREAD', content,
    })]);
    expect(JSON.stringify(notices)).not.toContain(PAYER_PHONE);
  });

  it('activates without a notice when there is no active owner', async () => {
    await prisma.collaboration.deleteMany({ where: { organizationId: ORG } });
    expect(await confirmPayment(REFERENCE, {}, NOW)).toBe('ACTIVATED');
    expect(await prisma.subscription.findFirstOrThrow()).toMatchObject({
      paymentId: PAYMENT, status: 'ACTIVE',
    });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('does not duplicate the notice on replay', async () => {
    expect(await confirmPayment(REFERENCE, {}, NOW)).toBe('ACTIVATED');
    expect(await confirmPayment(REFERENCE, {}, NOW)).toBe('ALREADY_DONE');
    expect(await prisma.notification.count({ where: { sourceEvent: 'subscription.paid' } })).toBe(1);
  });

  it('writes only one notice for concurrent confirmations', async () => {
    const outcomes = await Promise.all([
      confirmPayment(REFERENCE, {}, NOW), confirmPayment(REFERENCE, {}, NOW),
    ]);
    expect(outcomes.sort()).toEqual(['ACTIVATED', 'ALREADY_DONE']);
    expect(await prisma.notification.count({ where: { sourceEvent: 'subscription.paid' } })).toBe(1);
  });

  it('rolls back the activation and notice together when notification fails', async () => {
    const notify = notifications.notify;
    vi.spyOn(notifications, 'notify').mockImplementation(async (input, tx) => {
      await notify(input, tx);
      throw new Error('notification failure');
    });
    await expect(confirmPayment(REFERENCE, {}, NOW)).rejects.toThrow('notification failure');
    expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: PAYMENT } }))
      .toMatchObject({ status: 'PENDING', confirmedAt: null });
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.subscriptionReceipt.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });
});
