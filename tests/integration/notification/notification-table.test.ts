import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const REGISTERED_ID = '0199b001-0000-7000-8000-000000000001';
const GUEST_ID = '0199b001-0000-7000-8000-000000000002';
const UNKNOWN_ID = '0199b001-0000-7000-8000-000000000003';
const NOTIFICATION_ID = '0199b001-0000-7000-8000-000000000010';
const ORG_ID = '0199b001-0000-7000-8000-000000000004';
const UNKNOWN_ORG_ID = '0199b001-0000-7000-8000-000000000005';
const RELATED_ID = '0199b001-0000-7000-8000-000000000020';

type SqlError = {
  code?: string;
  message?: string;
  meta?: {
    code?: string;
    driverAdapterError?: {
      cause?: { code?: string; originalCode?: string; message?: string };
    };
  };
};

/** Extracts the PostgreSQL code wrapped by the Prisma driver adapter. */
function sqlCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as SqlError;
  const cause = candidate.meta?.driverAdapterError?.cause;
  const message = [candidate.message, cause?.message].filter(Boolean).join(' ');
  return (
    cause?.code ??
    cause?.originalCode ??
    candidate.meta?.code ??
    candidate.code ??
    message.match(/Code:\s*(\w+)/)?.[1]
  );
}

async function captureSqlCode(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation;
  } catch (error) {
    return sqlCode(error);
  }
  return undefined;
}

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM notifications`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG_ID}::uuid`;
  await prisma.person.deleteMany({ where: { id: { in: [REGISTERED_ID, GUEST_ID] } } });
  await prisma.person.createMany({
    data: [
      {
        id: REGISTERED_ID,
        fullName: 'Registered Notification Person',
        phoneNumber: '+2250700009001',
        phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
        registeredAt: new Date('2026-01-01T00:00:00.000Z'),
        preferredLanguage: 'FR',
      },
      { id: GUEST_ID, phoneNumber: '+2250700009002' },
    ],
  });
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM notifications`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG_ID}::uuid`;
  await prisma.person.deleteMany({ where: { id: { in: [REGISTERED_ID, GUEST_ID] } } });
});

describe('notifications table', () => {
  it('stores required fields with synchronized defaults and correct column types', async () => {
    await prisma.$executeRaw`
      INSERT INTO notifications (id, recipient_id, content, source_event)
      VALUES (${NOTIFICATION_ID}::uuid, ${REGISTERED_ID}::uuid, 'Order created', 'order.created')
    `;

    const [row] = await prisma.$queryRaw<
      Array<{
        read_status: string;
        pushed_at: Date | null;
        created_at: Date;
        server_updated_at: Date;
      }>
    >`
      SELECT read_status, pushed_at, created_at, server_updated_at
      FROM notifications WHERE id = ${NOTIFICATION_ID}::uuid
    `;
    expect(row).toMatchObject({ read_status: 'UNREAD', pushed_at: null });
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.server_updated_at).toBeInstanceOf(Date);

    const columns = await prisma.$queryRaw<
      Array<{ column_name: string; data_type: string; is_nullable: string }>
    >`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications'
    `;
    const byName = Object.fromEntries(columns.map((column) => [column.column_name, column]));
    expect(byName.id?.data_type).toBe('uuid');
    expect(byName.recipient_id?.data_type).toBe('uuid');
    expect(byName.organization_id?.data_type).toBe('uuid');
    expect(byName.related_entity_id?.data_type).toBe('uuid');
    for (const name of ['pushed_at', 'created_at', 'server_updated_at', 'deleted_at']) {
      expect(byName[name]?.data_type).toBe('timestamp with time zone');
    }
    for (const name of ['recipient_id', 'content', 'source_event', 'read_status', 'created_at']) {
      expect(byName[name]?.is_nullable).toBe('NO');
    }
  });

  it('rejects a guest recipient with 23514', async () => {
    const code = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO notifications (id, recipient_id, content, source_event)
        VALUES (${NOTIFICATION_ID}::uuid, ${GUEST_ID}::uuid, 'Guest event', 'guest.event')
      `
    );
    expect(code).toBe('23514');
  });

  it.each([
    ['Order', RELATED_ID, true],
    [null, null, true],
    ['Order', null, false],
    [null, RELATED_ID, false],
  ] as const)('enforces the related entity pair for type %s and id %s', async (type, id, accepts) => {
    const operation = prisma.$executeRaw`
      INSERT INTO notifications (
        id, recipient_id, content, source_event, related_entity_type, related_entity_id
      ) VALUES (
        ${NOTIFICATION_ID}::uuid, ${REGISTERED_ID}::uuid, 'Related event', 'related.event',
        ${type}, ${id}::uuid
      )
    `;

    if (accepts) {
      await expect(operation).resolves.toBe(1);
    } else {
      expect(await captureSqlCode(operation)).toBe('23514');
    }
  });

  it('rejects an invalid read status and an unknown recipient', async () => {
    const invalidStatus = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO notifications (id, recipient_id, content, source_event, read_status)
        VALUES (
          ${NOTIFICATION_ID}::uuid, ${REGISTERED_ID}::uuid, 'Seen event', 'seen.event',
          'SEEN'::text::public."NotificationReadStatus"
        )
      `
    );
    expect(invalidStatus).toBe('22P02');

    const unknownRecipient = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO notifications (id, recipient_id, content, source_event)
        VALUES (${NOTIFICATION_ID}::uuid, ${UNKNOWN_ID}::uuid, 'Unknown event', 'unknown.event')
      `
    );
    expect(unknownRecipient).toBe('23503');
  });
});

describe('notifications organization key', () => {
  it('rejects an unknown organization with 23503', async () => {
    const code = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO notifications (id, recipient_id, organization_id, content, source_event)
        VALUES (
          ${NOTIFICATION_ID}::uuid, ${REGISTERED_ID}::uuid, ${UNKNOWN_ORG_ID}::uuid,
          'Org event', 'org.event'
        )
      `
    );
    expect(code).toBe('23503');
  });

  it('accepts an existing organization and none', async () => {
    await prisma.$executeRaw`
      INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')
    `;
    await expect(
      prisma.$executeRaw`
        INSERT INTO notifications (id, recipient_id, organization_id, content, source_event)
        VALUES (
          ${NOTIFICATION_ID}::uuid, ${REGISTERED_ID}::uuid, ${ORG_ID}::uuid,
          'Org event', 'org.event'
        )
      `
    ).resolves.toBe(1);
    await expect(
      prisma.$executeRaw`
        INSERT INTO notifications (id, recipient_id, organization_id, content, source_event)
        VALUES (
          ${RELATED_ID}::uuid, ${REGISTERED_ID}::uuid, NULL, 'No org event', 'no.org.event'
        )
      `
    ).resolves.toBe(1);
  });
});
