import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f6-0000-7000-8000-000000000021';
const REMITTER = '0199c0f6-0000-7000-8000-000000000022';
const ORG = '0199c0f6-0000-7000-8000-0000000000c1';
const HANDOVER = '0199c0f6-0000-7000-8000-0000000007a1';
const GESTURE = '0199c0f6-0000-7000-8000-000000000901';
const REG = new Date('2026-01-01T00:00:00.000Z');

beforeEach(async () => {
  await prisma.person.createMany({
    data: [
      {
        id: OWNER,
        fullName: 'Owner Fixture',
        phoneNumber: '+237600089101',
        phoneVerifiedAt: REG,
        passwordHash: 'test-password-hash',
        registeredAt: REG,
        preferredLanguage: 'FR',
      },
      {
        id: REMITTER,
        fullName: 'Remitter Fixture',
        phoneNumber: '+237600089102',
        phoneVerifiedAt: REG,
        passwordHash: 'test-password-hash',
        registeredAt: REG,
        preferredLanguage: 'EN',
      },
    ],
  });
  await prisma.organization.create({ data: { id: ORG, name: 'Fixture Business', status: 'ACTIVE' } });
  await prisma.collaboration.createMany({
    data: [
      {
        id: '0199c0f6-0000-7000-8000-000000000601',
        personId: OWNER,
        organizationId: ORG,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
      {
        id: '0199c0f6-0000-7000-8000-000000000602',
        personId: REMITTER,
        organizationId: ORG,
        role: 'DRIVER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    ],
  });
  await prisma.handover.create({
    data: {
      id: HANDOVER,
      organizationId: ORG,
      fromPersonId: REMITTER,
      toPersonId: OWNER,
      amount: 5000n,
      occurredAt: REG,
    },
  });
});

describe('FIN-022 dispute notice wording', () => {
  it.each([
    ['FR', 'Remitter Fixture conteste le montant de 5000 noté pour son versement.'],
    ['EN', 'Remitter Fixture disputes the amount of 5000 noted for their handover.'],
  ] as const)('uses the exact %s wording in the owner notification (AC-1)', async (language, content) => {
    await prisma.person.update({ where: { id: OWNER }, data: { preferredLanguage: language } });
    await prisma.person.update({
      where: { id: REMITTER },
      data: { preferredLanguage: language === 'FR' ? 'EN' : 'FR' },
    });

    const response = await createAuthenticatedRequest(app, REMITTER)
      .post(`/api/v1/organizations/${ORG}/handovers/${HANDOVER}/dispute`)
      .send({ id: GESTURE });

    expect(response.status).toBe(200);
    const notifications = await prisma.notification.findMany();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      recipientId: OWNER,
      sourceEvent: 'handover.disputed',
      content,
    });
  });
});
