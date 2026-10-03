import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
import { newId } from '../../shared/ids.js';

export type ListQuery = { limit: number; cursor?: string; unread?: boolean };

export type NotificationView = {
  id: string;
  organization_id: string | null;
  content: string;
  source_event: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  read_status: 'UNREAD' | 'READ';
  created_at: string;
};

export type NotificationInsert = {
  recipientId: string;
  organizationId?: string;
  sourceEvent: string;
  content: string;
  related?: { type: string; id: string };
};

/** Database operations shared by notification services, with optional transaction participation. */
export const notificationRepository = {
  async findRecipient(personId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma;
    return client.person.findUnique({
      where: { id: personId },
      select: { registeredAt: true, preferredLanguage: true },
    });
  },

  async create(input: NotificationInsert, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? prisma;
    await client.notification.create({
      data: {
        id: newId(),
        recipientId: input.recipientId,
        organizationId: input.organizationId,
        sourceEvent: input.sourceEvent,
        content: input.content,
        relatedEntityType: input.related?.type,
        relatedEntityId: input.related?.id,
      },
    });
  },

  /** Lists the person's own live notifications (recipient from the session), keyset-paged. */
  async listNotifications(
    personId: string,
    query: ListQuery
  ): Promise<{ items: NotificationView[]; next_cursor: string | null }> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await prisma.notification.findMany({
      where: {
        recipientId: personId,
        deletedAt: null,
        ...(query.unread ? { readStatus: 'UNREAD' as const } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        organization_id: r.organizationId,
        content: r.content,
        source_event: r.sourceEvent,
        related_entity_type: r.relatedEntityType,
        related_entity_id: r.relatedEntityId,
        read_status: r.readStatus,
        created_at: r.createdAt.toISOString(),
      })),
      next_cursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  },
};
