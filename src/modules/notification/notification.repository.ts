import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { newId } from '../../shared/ids.js';

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
};
