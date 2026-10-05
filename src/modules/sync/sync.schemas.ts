import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/pagination.js';
import { moneyExceptionsQuerySchema } from '../finance/finance.schemas.js';

/** Epoch milliseconds stay far below 16 digits; the cap bounds the input (ASVS v5.0.0-2.2.1). */
const EPOCH_MS_DIGITS = /^\d{1,15}$/;

/**
 * Strict query of the pull: only `last_pulled_at`, a non-negative epoch in milliseconds that is not
 * in the future, or empty/absent for a first pull. The result is the epoch as a number, or null.
 */
export const pullQuerySchema = z
  .object({
    last_pulled_at: z
      .string()
      .max(15)
      .refine((value) => value === '' || EPOCH_MS_DIGITS.test(value), 'Expected epoch milliseconds')
      .optional(),
  })
  .strict()
  .transform((query) =>
    query.last_pulled_at === undefined || query.last_pulled_at === ''
      ? null
      : Number(query.last_pulled_at)
  )
  .refine((value) => value === null || value <= Date.now(), 'last_pulled_at is in the future');

export type PullQuery = z.infer<typeof pullQuerySchema>;

/**
 * `X-Scope-Version`: the rights version the phone knows, a non-negative integer of at most 9 digits
 * (ASVS v5.0.0-2.2.1). Absent means 0, so a phone that does not say what it knows is asked to start
 * again rather than trusted. The value is only compared, never stored (ASVS v5.0.0-8.2.2).
 */
export const scopeVersionHeaderSchema = z
  .string()
  .regex(/^\d{1,9}$/, 'Expected a non-negative integer')
  .optional()
  .transform((value) => (value === undefined ? 0 : Number(value)));

/** Most rows one push may carry, counted over every table and list (ASVS v5.0.0-2.2.1). */
export const MAX_PUSH_ROWS = 2000;

const rowSchema = z.record(z.string().max(64), z.unknown());

/** What a phone sends for one table: the three lists are required and nothing else is allowed. */
const pushTableSchema = z
  .object({
    created: z.array(rowSchema).max(MAX_PUSH_ROWS),
    updated: z.array(rowSchema).max(MAX_PUSH_ROWS),
    deleted: z.array(z.string().max(100)).max(MAX_PUSH_ROWS),
  })
  .strict();

/**
 * Body of the push: `{ changes: { <table>: { created, updated, deleted } } }`. A table name the
 * registry does not know is accepted here and set aside later (C-36), so the keys are free text with
 * a length cap. The total of rows is capped at 2000 and the number of tables at 100.
 */
export const pushBodySchema = z
  .object({
    changes: z
      .record(z.string().min(1).max(64), pushTableSchema)
      .refine((changes) => Object.keys(changes).length <= 100, 'Too many tables')
      .refine(
        (changes) =>
          Object.values(changes).reduce(
            (total, t) => total + t.created.length + t.updated.length + t.deleted.length,
            0
          ) <= MAX_PUSH_ROWS,
        `At most ${MAX_PUSH_ROWS} rows per push`
      ),
  })
  .strict();

export type PushBatch = z.infer<typeof pushBodySchema>['changes'];

/**
 * Strict query of the push: `last_pulled_at` is required, a non-negative epoch in milliseconds that
 * is not in the future. A future value would hide every newer server change from the conflict check.
 */
export const pushQuerySchema = z
  .object({
    last_pulled_at: z.string().regex(EPOCH_MS_DIGITS, 'Expected epoch milliseconds'),
  })
  .strict()
  .transform((query) => Number(query.last_pulled_at))
  .refine((value) => value <= Date.now(), 'last_pulled_at is in the future');

/** `X-App-Version`: dotted numbers such as `1.4.2` (at most 4 parts); absent is allowed here. */
export const appVersionHeaderSchema = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,6}){0,3}$/, 'Expected dotted numbers')
  .optional();

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * `X-Client-Time`: the phone's clock, as epoch milliseconds or an ISO 8601 instant. The result is
 * epoch milliseconds, or undefined when the header is absent.
 */
export const clientTimeHeaderSchema = z
  .string()
  .max(40)
  .transform((value) =>
    /^\d{1,15}$/.test(value)
      ? Number(value)
      : ISO_INSTANT.test(value)
        ? Date.parse(value)
        : Number.NaN
  )
  .refine((value) => Number.isFinite(value), 'Expected epoch milliseconds or an ISO 8601 date')
  .optional();

/** Strict query of the issues list: `limit` (1 to 100, default 50) and an opaque `cursor`. */
export const issuesQuerySchema = paginationQuerySchema
  .extend({ cursor: z.string().max(300).optional() })
  .strict();

export type IssuesQuery = z.infer<typeof issuesQuerySchema>;

/**
 * Strict query of the synchronization exceptions (SYNC-021): optional `from` and `to` as ISO dates,
 * at most 92 days apart, with the same rules and defaults as the money exceptions (FIN-019).
 */
export const syncExceptionsQuerySchema = moneyExceptionsQuerySchema;

export type SyncExceptionsQuery = z.infer<typeof syncExceptionsQuerySchema>;
