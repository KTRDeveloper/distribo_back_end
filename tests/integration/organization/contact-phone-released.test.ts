import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/app.js';
import { firePhoneReleased } from '../../../src/modules/person/phone-released.js';
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

const OWNER_A = '0199c037-0000-7000-8000-000000000001';
const OWNER_B = '0199c037-0000-7000-8000-000000000002';
const MANAGER_A = '0199c037-0000-7000-8000-000000000003';
const REVOKED_OWNER_C = '0199c037-0000-7000-8000-000000000004';
const BYSTANDER = '0199c037-0000-7000-8000-000000000005';

const ORG_A = '0199c037-0000-7000-8000-0000000000a1';
const ORG_B = '0199c037-0000-7000-8000-0000000000b1';
const ORG_C = '0199c037-0000-7000-8000-0000000000c1';

const C_A = '0199c037-0000-7000-8000-0000000000d1';
const C_B = '0199c037-0000-7000-8000-0000000000d2';
const C_C = '0199c037-0000-7000-8000-0000000000d3';
const C_EXTRA = '0199c037-0000-7000-8000-0000000000d4';
const C_EXTRA2 = '0199c037-0000-7000-8000-0000000000d5';

const REG = new Date('2026-01-01T00:00:00.000Z');
const NUMBER = '+237677123456';
const OTHER_NUMBER = '+237677123457';

async function seedPerson(id: string, phone: string, preferredLanguage?: 'FR' | 'EN') {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
      ...(preferredLanguage ? { preferredLanguage } : {}),
    },
  });
}

async function seedCollaboration(
  suffix: string,
  personId: string,
  organizationId: string,
  role: 'OWNER' | 'MANAGER',
  status: 'ACTIVE' | 'REVOKED' = 'ACTIVE'
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c037-0000-7000-8000-0000000000${suffix}`,
      personId,
      organizationId,
      role,
      status,
      acceptedAt: REG,
    },
  });
}

function seedContact(data: {
  id: string;
  organizationId?: string;
  kind?: 'PHONE' | 'EMAIL';
  slot?: number | null;
  value?: string;
  verified?: boolean;
  deleted?: boolean;
}) {
  const kind = data.kind ?? 'PHONE';
  return prisma.organizationContact.create({
    data: {
      id: data.id,
      organizationId: data.organizationId ?? ORG_A,
      kind,
      slot: data.slot === undefined ? (kind === 'PHONE' ? 1 : null) : data.slot,
      value: data.value ?? NUMBER,
      createdById: OWNER_A,
      ...(data.verified === false ? {} : { verifiedAt: REG, verificationMethod: 'CODE' as const }),
      ...(data.deleted ? { deletedAt: REG } : {}),
    },
  });
}

const release = (phone = NUMBER) =>
  prisma.$transaction(async (tx) => {
    await firePhoneReleased(phone, tx);
  });

const reviewNotices = (recipientId: string) =>
  prisma.notification.findMany({
    where: { recipientId, sourceEvent: 'organization.contacts_review' },
  });

const contact = (id: string) =>
  prisma.organizationContact.findUniqueOrThrow({
    where: { id },
    select: { verifiedAt: true, verificationMethod: true, value: true, slot: true },
  });

beforeEach(async () => {
  failing.onReview = false;
  await seedPerson(OWNER_A, '+237600370001', 'FR');
  await seedPerson(OWNER_B, '+237600370002', 'EN');
  await seedPerson(MANAGER_A, '+237600370003', 'FR');
  await seedPerson(REVOKED_OWNER_C, '+237600370004', 'FR');
  await seedPerson(BYSTANDER, '+237600370005', 'FR');
  for (const [id, name] of [
    [ORG_A, 'Org A'],
    [ORG_B, 'Org B'],
    [ORG_C, 'Org C'],
  ] as const) {
    await prisma.organization.create({ data: { id, name } });
  }
  await seedCollaboration('a9', OWNER_A, ORG_A, 'OWNER');
  await seedCollaboration('a2', MANAGER_A, ORG_A, 'MANAGER');
  await seedCollaboration('b9', OWNER_B, ORG_B, 'OWNER');
  await seedCollaboration('a8', REVOKED_OWNER_C, ORG_A, 'OWNER', 'REVOKED');
});

describe('ORG-037 a recycled number sends its public contacts back to pending', () => {
  it('AC-1 a verified contact loses its verification, value and slot stay', async () => {
    await seedContact({ id: C_A, slot: 2 });

    await release();

    expect(await contact(C_A)).toEqual({
      verifiedAt: null,
      verificationMethod: null,
      value: NUMBER,
      slot: 2,
    });
  });

  it.each([
    ['holding another number', { value: OTHER_NUMBER }],
    ['of kind EMAIL', { kind: 'EMAIL' as const, value: 'shop@example.test' }],
    ['already pending', { verified: false }],
    ['deleted', { deleted: true }],
  ])('AC-2 a contact %s is left as it was', async (_label, extra) => {
    await seedContact({ id: C_A, ...extra });
    const before = await prisma.organizationContact.findUniqueOrThrow({ where: { id: C_A } });

    await release();

    const after = await prisma.organizationContact.findUniqueOrThrow({ where: { id: C_A } });
    expect(after).toEqual(before);
    expect(await reviewNotices(OWNER_A)).toHaveLength(0);
  });

  it('AC-3 each ACTIVE owner is told once, in their language, and nobody else', async () => {
    await seedContact({ id: C_A, organizationId: ORG_A, slot: 1 });
    await seedContact({ id: C_EXTRA, organizationId: ORG_A, slot: 2, value: '+237677999001' });
    await seedContact({ id: C_EXTRA2, organizationId: ORG_A, slot: 3, value: '+237677999002' });
    await seedContact({ id: C_B, organizationId: ORG_B, slot: 1 });
    await seedContact({ id: C_C, organizationId: ORG_C, slot: 1 });

    await release();

    const noticeA = await reviewNotices(OWNER_A);
    expect(noticeA).toHaveLength(1);
    expect(noticeA[0]).toMatchObject({
      readStatus: 'UNREAD',
      organizationId: ORG_A,
      content:
        "Un de vos numeros de contact public a change de titulaire. Il n'est plus affiche. Verifiez vos contacts dans les reglages.",
    });
    expect(noticeA[0]?.content).not.toContain(NUMBER);
    const noticeB = await reviewNotices(OWNER_B);
    expect(noticeB).toHaveLength(1);
    expect(noticeB[0]?.content).toBe(
      'One of your public contact numbers has a new holder. It is no longer shown. Check your contacts in the settings.'
    );
    expect(await reviewNotices(MANAGER_A)).toHaveLength(0);
    expect(await reviewNotices(REVOKED_OWNER_C)).toHaveLength(0);
    expect(await reviewNotices(BYSTANDER)).toHaveLength(0);
    // ORG_C has no collaboration at all: downgraded all the same, nobody to tell.
    expect((await contact(C_C)).verifiedAt).toBeNull();
    expect((await contact(C_B)).verifiedAt).toBeNull();
  });

  it('AC-3 related points at the organization', async () => {
    await seedContact({ id: C_A });

    await release();

    const [notice] = await reviewNotices(OWNER_A);
    expect(notice?.relatedEntityType).toBe('organization');
    expect(notice?.relatedEntityId).toBe(ORG_A);
  });

  it('AC-4 the handler is registered when the application loads', async () => {
    await seedContact({ id: C_A });

    await release();

    expect((await contact(C_A)).verifiedAt).toBeNull();
  });

  it('AC-5 a failing notification rolls the release back, the contact stays verified', async () => {
    await seedContact({ id: C_A });
    failing.onReview = true;

    await expect(release()).rejects.toThrow('forced notification failure');

    expect((await contact(C_A)).verifiedAt).not.toBeNull();
    expect(await reviewNotices(OWNER_A)).toHaveLength(0);
  });

  it('AB-1 a number released to a new holder no longer speaks for the business', async () => {
    await seedContact({ id: C_A });
    await seedContact({ id: C_B, organizationId: ORG_B });

    await release();

    for (const id of [C_A, C_B]) {
      const row = await contact(id);
      expect(row.verifiedAt).toBeNull();
      expect(row.verificationMethod).toBeNull();
    }
  });

  it('a second release of the same number notifies nobody again', async () => {
    await seedContact({ id: C_A });

    await release();
    await release();

    expect(await reviewNotices(OWNER_A)).toHaveLength(1);
  });
});
