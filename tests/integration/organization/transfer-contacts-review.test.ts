import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const failing = vi.hoisted(() => ({ onReview: false }));

vi.mock('../../../src/modules/notification/notification.service.js', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('../../../src/modules/notification/notification.service.js')
    >();
  return {
    ...original,
    notify: (...args: Parameters<typeof original.notify>) => {
      if (failing.onReview && args[0].sourceEvent === 'organization.contacts_review') {
        throw new Error('forced notification failure');
      }
      return original.notify(...args);
    },
  };
});

const OWNER = '0199c033-0000-7000-8000-000000000001';
const MANAGER = '0199c033-0000-7000-8000-000000000002';
const OTHER_OWNER = '0199c033-0000-7000-8000-000000000006';

const ORG_A = '0199c033-0000-7000-8000-0000000000a1';
const ORG_B = '0199c033-0000-7000-8000-0000000000b1';
const OWNER_ROW = '0199c033-0000-7000-8000-0000000000a9';
const MANAGER_ROW = '0199c033-0000-7000-8000-0000000000a2';
const OTHER_OWNER_ROW = '0199c033-0000-7000-8000-0000000000b9';

const GESTURE = '0199c033-0000-7000-8000-0000000000c1';
const C1 = '0199c033-0000-7000-8000-0000000000d1';
const C2 = '0199c033-0000-7000-8000-0000000000d2';
const C3 = '0199c033-0000-7000-8000-0000000000d3';
const C_OTHER = '0199c033-0000-7000-8000-0000000000d4';

const REG = new Date('2026-01-01T00:00:00.000Z');
const OWNER_PHONE = '+237600330001';
const OWNER_EMAIL = 'former.owner@example.test';
const OWNER_NAME = 'Former Owner Fixture';
const OTHER_PHONE = '+237677330111';
const THIRD_PHONE = '+237677330222';

async function seedPerson(
  id: string,
  phone: string,
  extra: { fullName?: string; email?: string; preferredLanguage?: 'FR' | 'EN' } = {}
) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
      ...extra,
    },
  });
}

function seedContact(data: {
  id: string;
  organizationId?: string;
  kind: 'PHONE' | 'EMAIL';
  slot: number | null;
  value: string;
  verified?: boolean;
  deleted?: boolean;
}) {
  return prisma.organizationContact.create({
    data: {
      id: data.id,
      organizationId: data.organizationId ?? ORG_A,
      kind: data.kind,
      slot: data.slot,
      value: data.value,
      createdById: OWNER,
      ...(data.verified ? { verifiedAt: REG, verificationMethod: 'CODE' as const } : {}),
      ...(data.deleted ? { deletedAt: REG } : {}),
    },
  });
}

const transfer = () =>
  createAuthenticatedRequest(app, OWNER)
    .post(`/api/v1/organizations/${ORG_A}/transfer-ownership`)
    .send({ id: GESTURE, collaboration_id: MANAGER_ROW });

const reviewNotices = (recipientId = MANAGER) =>
  prisma.notification.findMany({
    where: { recipientId, sourceEvent: 'organization.contacts_review' },
  });

beforeEach(async () => {
  failing.onReview = false;
  await seedPerson(OWNER, OWNER_PHONE, { fullName: OWNER_NAME, email: OWNER_EMAIL });
  await seedPerson(MANAGER, '+237600330002');
  await seedPerson(OTHER_OWNER, '+237600330006');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A' } });
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B' } });
  for (const [id, personId, orgId, role] of [
    [OWNER_ROW, OWNER, ORG_A, 'OWNER'],
    [MANAGER_ROW, MANAGER, ORG_A, 'MANAGER'],
    [OTHER_OWNER_ROW, OTHER_OWNER, ORG_B, 'OWNER'],
  ] as const) {
    await prisma.collaboration.create({
      data: { id, personId, organizationId: orgId, role, status: 'ACTIVE', acceptedAt: REG },
    });
  }
});

describe('ORG-033 transfer asks the new owner to review the public contacts', () => {
  it('AC-1 two live contacts: one notice in French, besides ownership.received', async () => {
    await seedContact({ id: C1, kind: 'PHONE', slot: 1, value: OTHER_PHONE, verified: true });
    await seedContact({ id: C2, kind: 'PHONE', slot: 2, value: THIRD_PHONE });

    expect((await transfer()).status).toBe(200);

    const notices = await reviewNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      organizationId: ORG_A,
      relatedEntityType: 'organization',
      relatedEntityId: ORG_A,
      readStatus: 'UNREAD',
      content: 'Les contacts publics de Org A restent en place. Revoyez-les dans les reglages.',
    });
    expect(
      await prisma.notification.count({
        where: { recipientId: MANAGER, sourceEvent: 'ownership.received' },
      })
    ).toBe(1);
    expect(await prisma.notification.count({ where: { recipientId: OWNER } })).toBe(0);
  });

  it('AC-1 the text follows the language of the new owner', async () => {
    await prisma.person.update({ where: { id: MANAGER }, data: { preferredLanguage: 'EN' } });
    await seedContact({ id: C1, kind: 'PHONE', slot: 1, value: OTHER_PHONE });

    expect((await transfer()).status).toBe(200);

    expect((await reviewNotices())[0]?.content).toBe(
      'The public contacts of Org A stay in place. Review them in the settings.'
    );
  });

  it('AC-2 no contact: no review notice', async () => {
    expect((await transfer()).status).toBe(200);

    expect(await reviewNotices()).toHaveLength(0);
  });

  it('AC-2 only deleted contacts: no review notice', async () => {
    await seedContact({ id: C1, kind: 'PHONE', slot: 1, value: OTHER_PHONE, deleted: true });

    expect((await transfer()).status).toBe(200);

    expect(await reviewNotices()).toHaveLength(0);
  });

  it('a contact of another business does not trigger the notice', async () => {
    await seedContact({
      id: C_OTHER,
      organizationId: ORG_B,
      kind: 'PHONE',
      slot: 1,
      value: OTHER_PHONE,
    });

    expect((await transfer()).status).toBe(200);

    expect(await reviewNotices()).toHaveLength(0);
  });

  it('AC-3 the former owner number in slot 2: mention with the slot, no number, no name', async () => {
    await seedContact({ id: C1, kind: 'PHONE', slot: 1, value: OTHER_PHONE });
    await seedContact({ id: C2, kind: 'PHONE', slot: 2, value: OWNER_PHONE });

    expect((await transfer()).status).toBe(200);

    const content = (await reviewNotices())[0]?.content ?? '';
    expect(content).toBe(
      "Les contacts publics de Org A restent en place. Revoyez-les dans les reglages. Le contact 2 est le numero de l'ancien proprietaire. Le garder ?"
    );
    expect(content).not.toContain(OWNER_PHONE);
    expect(content).not.toContain('600330001');
    expect(content).not.toContain(OWNER_NAME);
  });

  it('AC-3 the mention is in English for an English new owner', async () => {
    await prisma.person.update({ where: { id: MANAGER }, data: { preferredLanguage: 'EN' } });
    await seedContact({ id: C3, kind: 'PHONE', slot: 3, value: OWNER_PHONE });

    expect((await transfer()).status).toBe(200);

    expect((await reviewNotices())[0]?.content).toBe(
      "The public contacts of Org A stay in place. Review them in the settings. Contact 3 is the former owner's number. Keep it?"
    );
  });

  describe('AC-4 other contacts get no mention', () => {
    it('a PHONE contact with another number', async () => {
      await seedContact({ id: C1, kind: 'PHONE', slot: 1, value: OTHER_PHONE });

      expect((await transfer()).status).toBe(200);

      const content = (await reviewNotices())[0]?.content ?? '';
      expect(content).toBe(
        'Les contacts publics de Org A restent en place. Revoyez-les dans les reglages.'
      );
    });

    it('an EMAIL contact equal to the former owner email', async () => {
      await seedContact({ id: C1, kind: 'EMAIL', slot: null, value: OWNER_EMAIL });

      expect((await transfer()).status).toBe(200);

      const content = (await reviewNotices())[0]?.content ?? '';
      expect(content).toBe(
        'Les contacts publics de Org A restent en place. Revoyez-les dans les reglages.'
      );
    });

    it('a deleted contact with the former owner number', async () => {
      await seedContact({ id: C1, kind: 'PHONE', slot: 1, value: OTHER_PHONE });
      await seedContact({ id: C2, kind: 'PHONE', slot: 2, value: OWNER_PHONE, deleted: true });

      expect((await transfer()).status).toBe(200);

      const content = (await reviewNotices())[0]?.content ?? '';
      expect(content).not.toContain('ancien proprietaire');
    });
  });

  it('AC-5 contacts keep their value, slot and verification', async () => {
    await seedContact({ id: C1, kind: 'PHONE', slot: 1, value: OWNER_PHONE, verified: true });
    await seedContact({ id: C2, kind: 'PHONE', slot: 2, value: OTHER_PHONE });
    const before = await prisma.organizationContact.findMany({ orderBy: { id: 'asc' } });

    expect((await transfer()).status).toBe(200);

    expect(await prisma.organizationContact.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('AC-5 a failing review notification rolls the transfer back', async () => {
    await seedContact({ id: C1, kind: 'PHONE', slot: 1, value: OTHER_PHONE });
    failing.onReview = true;

    expect((await transfer()).status).toBe(500);

    const owner = await prisma.collaboration.findUniqueOrThrow({ where: { id: OWNER_ROW } });
    const manager = await prisma.collaboration.findUniqueOrThrow({ where: { id: MANAGER_ROW } });
    expect(owner.role).toBe('OWNER');
    expect(manager.role).toBe('MANAGER');
    expect(await prisma.notification.count({ where: { recipientId: MANAGER } })).toBe(0);
  });

  it('AB-1 an EMAIL equal to the former owner email never reaches the notice', async () => {
    await seedContact({ id: C1, kind: 'EMAIL', slot: null, value: OWNER_EMAIL });
    await seedContact({ id: C2, kind: 'PHONE', slot: 1, value: OWNER_PHONE });

    expect((await transfer()).status).toBe(200);

    const notices = await prisma.notification.findMany({ where: { recipientId: MANAGER } });
    for (const notice of notices) {
      expect(notice.content).not.toContain(OWNER_EMAIL);
      expect(notice.content).not.toContain('@');
    }
  });
});
