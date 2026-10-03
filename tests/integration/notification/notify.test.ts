import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { notify, recipientLanguage } from '../../../src/modules/notification/notification.service.js';
import { LABEL_MAX, TEXT_MAX } from '../../../src/shared/limits.js';
import { prisma } from '../../setup';

const REGISTERED_ID = '0199b002-0000-7000-8000-000000000001';
const ENGLISH_ID = '0199b002-0000-7000-8000-000000000002';
const DEFAULT_LANGUAGE_ID = '0199b002-0000-7000-8000-000000000003';
const GUEST_ID = '0199b002-0000-7000-8000-000000000004';
const UNKNOWN_ID = '0199b002-0000-7000-8000-000000000005';
const TRANSACTION_ID = '0199b002-0000-7000-8000-000000000006';
const RELATED_ID = '0199b002-0000-7000-8000-000000000010';

const personIds = [
  REGISTERED_ID,
  ENGLISH_ID,
  DEFAULT_LANGUAGE_ID,
  GUEST_ID,
  TRANSACTION_ID,
];
const registeredFields = {
  phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
  registeredAt: new Date('2026-01-01T00:00:00.000Z'),
};

async function expectValidationError(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
}

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM notifications`;
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.person.createMany({
    data: [
      {
        id: REGISTERED_ID,
        fullName: 'Notification Recipient',
        phoneNumber: '+2250700009101',
        ...registeredFields,
        preferredLanguage: 'FR',
      },
      {
        id: ENGLISH_ID,
        fullName: 'English Recipient',
        phoneNumber: '+2250700009102',
        ...registeredFields,
        preferredLanguage: 'EN',
      },
      {
        id: DEFAULT_LANGUAGE_ID,
        fullName: 'Default Language Recipient',
        phoneNumber: '+2250700009103',
        ...registeredFields,
        preferredLanguage: null,
      },
      { id: GUEST_ID, phoneNumber: '+2250700009104' },
    ],
  });
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM notifications`;
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
});

describe('notify', () => {
  it('stores an unread notification and preserves valid content verbatim', async () => {
    const content = '  Nouvelle commande  ';

    await notify({ recipientId: REGISTERED_ID, sourceEvent: 'order.placed', content });

    const rows = await prisma.$queryRaw<
      Array<{ recipient_id: string; content: string; source_event: string; read_status: string }>
    >`SELECT recipient_id, content, source_event, read_status FROM notifications`;
    expect(rows).toEqual([
      {
        recipient_id: REGISTERED_ID,
        content,
        source_event: 'order.placed',
        read_status: 'UNREAD',
      },
    ]);
  });

  it('uses the caller transaction for both recipient lookup and insertion', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.person.create({
          data: {
            id: TRANSACTION_ID,
            fullName: 'Transaction Recipient',
            phoneNumber: '+2250700009106',
            ...registeredFields,
          },
        });
        await notify(
          { recipientId: TRANSACTION_ID, sourceEvent: 'order.placed', content: 'Rolled back' },
          tx
        );
        throw new Error('ROLLBACK');
      })
    ).rejects.toThrow('ROLLBACK');

    expect(await prisma.person.count({ where: { id: TRANSACTION_ID } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it.each(['order.placed', 'customer.added', 'delivery.assigned'])(
    'accepts the extensible source event %s',
    async (sourceEvent) => {
      await notify({ recipientId: REGISTERED_ID, sourceEvent, content: 'Event' });
      expect(await prisma.notification.count()).toBe(1);
    }
  );

  it.each([
    ['', 'Content'],
    ['   ', 'Content'],
    ['Order.placed', 'Content'],
    [' order.placed', 'Content'],
    ['order.placed ', 'Content'],
    ['order', 'Content'],
    ['order..placed', 'Content'],
    ['order.Placed', 'Content'],
    ['order-placed.done', 'Content'],
    [`a.${'b'.repeat(LABEL_MAX - 1)}`, 'Content'],
    ['order.placed', ''],
    ['order.placed', ' \n\t '],
    ['order.placed', 'x'.repeat(TEXT_MAX + 1)],
  ])('rejects invalid source event or content %#', async (sourceEvent, content) => {
    await expectValidationError(notify({ recipientId: REGISTERED_ID, sourceEvent, content }));
    expect(await prisma.notification.count()).toBe(0);
  });

  it('accepts exact content and source-event length boundaries', async () => {
    const sourceEvent = `a.${'b'.repeat(LABEL_MAX - 2)}`;
    await notify({ recipientId: REGISTERED_ID, sourceEvent, content: 'x'.repeat(TEXT_MAX) });
    expect(await prisma.notification.count()).toBe(1);
  });

  it.each([
    { type: 'Order' },
    { id: RELATED_ID },
    { type: '', id: RELATED_ID },
    { type: '   ', id: RELATED_ID },
    { type: 'x'.repeat(LABEL_MAX + 1), id: RELATED_ID },
    { type: 'Order', id: 'not-an-id' },
    { type: 'Order', id: '0199b002-0000-4000-8000-000000000010' },
  ])('rejects invalid related input %#', async (related) => {
    await expectValidationError(
      notify({
        recipientId: REGISTERED_ID,
        sourceEvent: 'order.placed',
        content: 'Related',
        related: related as { type: string; id: string },
      })
    );
    expect(await prisma.notification.count()).toBe(0);
  });

  it('stores a related entity at the label boundary', async () => {
    await notify({
      recipientId: REGISTERED_ID,
      sourceEvent: 'order.placed',
      content: 'Related',
      related: { type: 'x'.repeat(LABEL_MAX), id: RELATED_ID },
    });
    const [row] = await prisma.$queryRaw<Array<{ type: string; id: string }>>`
      SELECT related_entity_type AS type, related_entity_id AS id FROM notifications
    `;
    expect(row).toEqual({ type: 'x'.repeat(LABEL_MAX), id: RELATED_ID });
  });

  it.each([
    ['not-an-id', 'malformed'],
    ['0199b002-0000-4000-8000-000000000001', 'non-v7'],
    [UNKNOWN_ID, 'missing'],
    [GUEST_ID, 'guest'],
  ])('rejects a %s recipient', async (recipientId) => {
    await expectValidationError(
      notify({ recipientId, sourceEvent: 'order.placed', content: 'Invalid recipient' })
    );
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe('recipientLanguage', () => {
  it('returns FR, EN, and defaults an empty preference to FR', async () => {
    await expect(recipientLanguage(REGISTERED_ID)).resolves.toBe('FR');
    await expect(recipientLanguage(ENGLISH_ID)).resolves.toBe('EN');
    await expect(recipientLanguage(DEFAULT_LANGUAGE_ID)).resolves.toBe('FR');
  });

  it.each(['not-an-id', '0199b002-0000-4000-8000-000000000001', UNKNOWN_ID, GUEST_ID])(
    'rejects an invalid, missing, or guest person %s',
    async (personId) => {
      await expectValidationError(recipientLanguage(personId));
    }
  );

  it('reads through the caller transaction', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.person.create({
        data: {
          id: TRANSACTION_ID,
          fullName: 'Transaction Recipient',
          phoneNumber: '+2250700009106',
          ...registeredFields,
          preferredLanguage: 'EN',
        },
      });
      await expect(recipientLanguage(TRANSACTION_ID, tx)).resolves.toBe('EN');
      throw new Prisma.PrismaClientKnownRequestError('rollback', {
        code: 'P0001',
        clientVersion: 'test',
      });
    }).catch(() => undefined);
  });
});

describe('notification validation checks', () => {
  async function directInsert(content: string, sourceEvent: string, relatedType?: string) {
    return prisma.$executeRaw`
      INSERT INTO notifications (
        id, recipient_id, content, source_event, related_entity_type, related_entity_id
      ) VALUES (
        gen_random_uuid(), ${REGISTERED_ID}::uuid, ${content}, ${sourceEvent},
        ${relatedType ?? null}, ${relatedType ? RELATED_ID : null}::uuid
      )
    `;
  }

  it.each([
    ['', 'order.placed', undefined],
    ['   ', 'order.placed', undefined],
    ['x'.repeat(TEXT_MAX + 1), 'order.placed', undefined],
    ['Content', 'ORDER.PLACED', undefined],
    ['Content', 'order', undefined],
    ['Content', `a.${'b'.repeat(LABEL_MAX - 1)}`, undefined],
    ['Content', 'order.placed', '   '],
    ['Content', 'order.placed', 'x'.repeat(LABEL_MAX + 1)],
  ])('rejects invalid direct inserts %#', async (content, sourceEvent, relatedType) => {
    await expect(directInsert(content, sourceEvent, relatedType)).rejects.toBeDefined();
  });
});
