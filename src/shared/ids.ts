import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

/** Generate a UUIDv7 identifier for a new record. */
export function newId(): string {
  return uuidv7();
}

/** Accept only canonical UUIDv7 values, regardless of letter case. */
export const uuidV7Schema: z.ZodString = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'Expected a UUIDv7 identifier'
  );
