import { z } from 'zod';
import { httpError } from '../lib/http-error.js';
import { PAGE_DEFAULT, PAGE_MAX } from './limits.js';

/**
 * Pagination query parameters schema.
 * Validates and coerces limit to an integer between 1 and PAGE_MAX (100).
 * Optional cursor for keyset pagination.
 */
export const paginationQuerySchema = z.object({
  limit: z
    .union([z.number().int(), z.string()])
    .pipe(z.coerce.number().int())
    .pipe(z.number().min(1).max(PAGE_MAX))
    .default(PAGE_DEFAULT),
  cursor: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Cursor object containing created_at and id for keyset pagination.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

/**
 * Encodes a cursor to a base64url JSON string.
 * @param cursor - The cursor object with createdAt and id
 * @returns Base64url encoded JSON representation
 */
export function encodeCursor(cursor: Cursor): string {
  const json = JSON.stringify({
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
  });
  return Buffer.from(json).toString('base64url');
}

/**
 * Decodes a base64url JSON cursor string.
 * Validates that it contains valid createdAt (ISO string) and id (UUIDv7) fields.
 * @param text - The base64url encoded cursor
 * @returns Decoded cursor object
 * @throws httpError(400, 'VALIDATION_ERROR', ...) if cursor is invalid
 */
export function decodeCursor(text: string): Cursor {
  let json: string;
  try {
    json = Buffer.from(text, 'base64url').toString('utf8');
  } catch {
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid cursor format');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid cursor format');
  }

  const schema = z.object({
    createdAt: z.string().datetime(),
    id: z.string().uuid(),
  });

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid cursor format');
  }

  return {
    createdAt: new Date(result.data.createdAt),
    id: result.data.id,
  };
}
