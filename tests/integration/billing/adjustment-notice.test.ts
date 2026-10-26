import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { notifyOwnerOfAdjustment } from '../../../src/modules/billing/adjustment-notice';
import type { AdjustmentInput } from '../../../src/modules/billing/notices';

const ORG_ID = '0199c036-0000-7000-8000-000000000001';
const OWNER_ID = '0199c036-0000-7000-8000-000000000011';
const OWNER_COLLAB_ID = '0199c036-0000-7000-8000-000000000021';
const OTHER_ORG_ID = '0199c036-0000-7000-8000-000000000002';
const OTHER_OWNER_ID = '0199c036-0000-7000-8000-000000000012';
const OTHER_COLLAB_ID = '0199c036-0000-7000-8000-000000000022';
const GIFT = { kind: 'GIFT', plan: 'ESSENTIAL', days: 30 } as const;

const examples: Array<{ input: AdjustmentInput; FR: string; EN: string }> = [
  {
    input: GIFT,
    FR: 'Cadeau : 30 jours de forfait Essentiel offerts à votre commerce.',
    EN: 'Gift: 30 days of the Essential plan added to your business.',
  },
  {
    input: { kind: 'PAYMENT_RECORDED', plan: 'ESSENTIAL', months: 3, amount: 15000n },
    FR: 'Paiement de 15 000 enregistré par Distribo : forfait Essentiel, 3 mois.',
    EN: 'Payment of 15,000 recorded by Distribo: Essential plan, 3 months.',
  },
  {
    input: { kind: 'PAYMENT_RECORDED', plan: 'PRO', months: 1, amount: 30000n },
    FR: 'Paiement de 30 000 enregistré par Distribo : forfait Pro, 1 mois.',
    EN: 'Payment of 30,000 recorded by Distribo: Pro plan, 1 month.',
  },
  {
    input: { kind: 'REFUNDED', plan: 'ESSENTIAL', amount: 15000n },
    FR: 'Remboursement de 15 000 : le forfait Essentiel acheté par ce paiement est arrêté.',
    EN: 'Refund of 15,000: the Essential plan bought with that payment has ended.',
  },
];

beforeEach(async () => {
  await prisma.person.createMany({
    data: [
      {
        id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700003611',
        phoneVerifiedAt: new Date(), passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
        registeredAt: new Date(), preferredLanguage: 'FR',
      },
      {
        id: OTHER_OWNER_ID, fullName: 'Other Fixture Owner', phoneNumber: '+2250700003612',
        phoneVerifiedAt: new Date(), passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
        registeredAt: new Date(), preferredLanguage: 'EN',
      },
    ],
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO organizations (id, name)
      VALUES (${ORG_ID}::uuid, 'Fixture Business'), (${OTHER_ORG_ID}::uuid, 'Other Fixture Business')
    `;
    await tx.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status)
      VALUES (${OWNER_COLLAB_ID}::uuid, ${OWNER_ID}::uuid, ${ORG_ID}::uuid, 'OWNER', 'ACTIVE'),
             (${OTHER_COLLAB_ID}::uuid, ${OTHER_OWNER_ID}::uuid, ${OTHER_ORG_ID}::uuid, 'OWNER', 'ACTIVE')
    `;
  });
});

describe('notifyOwnerOfAdjustment', () => {
  for (const language of ['FR', 'EN'] as const) {
    it.each(examples)(`texts in ${language}: $input`, async (example) => {
      await prisma.person.update({ where: { id: OWNER_ID }, data: { preferredLanguage: language } });
      await prisma.$transaction((tx) => notifyOwnerOfAdjustment(tx, ORG_ID, example.input));

      const notices = await prisma.notification.findMany();
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        recipientId: OWNER_ID,
        organizationId: ORG_ID,
        sourceEvent: 'subscription.adjusted',
        content: example[language],
        readStatus: 'UNREAD',
      });
    });
  }

  it('no owner: does not notify another organization owner', async () => {
    await prisma.collaboration.delete({ where: { id: OWNER_COLLAB_ID } });
    await prisma.$transaction((tx) => notifyOwnerOfAdjustment(tx, ORG_ID, GIFT));
    expect(await prisma.notification.count()).toBe(0);
  });

  it('does not notify an inactive owner', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.collaboration.update({ where: { id: OWNER_COLLAB_ID }, data: { status: 'REVOKED' } });
      await notifyOwnerOfAdjustment(tx, ORG_ID, GIFT);
      await tx.collaboration.update({ where: { id: OWNER_COLLAB_ID }, data: { status: 'ACTIVE' } });
    });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('does not notify a soft-deleted owner', async () => {
    await prisma.collaboration.update({ where: { id: OWNER_COLLAB_ID }, data: { deletedAt: new Date() } });
    await prisma.$transaction((tx) => notifyOwnerOfAdjustment(tx, ORG_ID, GIFT));
    expect(await prisma.notification.count()).toBe(0);
  });

  it('rollback: leaves no notice after the caller transaction fails', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await notifyOwnerOfAdjustment(tx, ORG_ID, GIFT);
      expect(await tx.notification.count()).toBe(1);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await prisma.notification.count()).toBe(0);
  });
});
