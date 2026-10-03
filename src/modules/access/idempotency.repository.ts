import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';

export type IdempotencyRecord = {
  personId: string;
  key: string;
  statusCode: number | null;
  responseBody: unknown;
};

export const idempotencyRepository = {
  /** Atomically reserves a person-scoped key, returning whether this request won the race. */
  async reserve(personId: string, key: string): Promise<boolean> {
    const inserted = await prisma.$queryRaw<Array<{ key: string }>>`
      INSERT INTO idempotency_keys (person_id, key)
      VALUES (${personId}::uuid, ${key}::uuid)
      ON CONFLICT (person_id, key) DO NOTHING
      RETURNING key::text
    `;
    return inserted.length === 1;
  },

  /** Finds the prior response for a person without exposing another person's record. */
  async find(personId: string, key: string): Promise<IdempotencyRecord | null> {
    const record = await prisma.idempotencyKey.findUnique({
      where: { personId_key: { personId, key } },
    });
    if (!record) return null;
    return {
      personId: record.personId,
      key: record.key,
      statusCode: record.statusCode,
      responseBody: record.responseBody,
    };
  },

  /** Persists the exact successful HTTP status and JSON body used for future replays. */
  async complete(personId: string, key: string, statusCode: number, responseBody: unknown): Promise<void> {
    await prisma.idempotencyKey.update({
      where: { personId_key: { personId, key } },
      data: {
        statusCode,
        responseBody: responseBody as Prisma.InputJsonValue,
      },
    });
  },

  /** Releases a key after a server failure so a safe client retry can execute again. */
  async remove(personId: string, key: string): Promise<void> {
    await prisma.idempotencyKey.deleteMany({ where: { personId, key } });
  },
};
