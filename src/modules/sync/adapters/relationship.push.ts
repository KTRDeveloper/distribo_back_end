import { Prisma } from '@prisma/client';
import { logger } from '../../../lib/logger.js';
import { LABEL_MAX, TEXT_MAX } from '../../../shared/limits.js';
import { normalizeE164 } from '../../../shared/phone.js';
import { findOrCreateByPhone } from '../../person/person.repository.js';
import {
  mergeDuplicateRelation,
  resolveMergedRelation,
} from '../../relationship/relationship.repository.js';
import type { LineOutcome, PushContext, Row, TableChange } from '../sync.types.js';
import { refuseEveryLine } from './identity.adapter.js';

const TABLE = 'customer_relationships' as const;

/**
 * Fields a phone may send on a created row. `created_by_id` is the viewer (the judge sets it) and
 * `created_at` is ignored: the server decides both.
 */
const CREATE_FIELDS = new Set([
  'id',
  'supplier_organization_id',
  'customer_phone_number',
  'customer_label',
  'delivery_address',
  'supplier_notes',
  'created_by_id',
  'created_at',
]);

type Pushed = { id: string; row: Row };

const outcome = (
  id: string,
  kind: LineOutcome['kind'],
  code?: string,
  message?: string,
  mergedInto?: string
): LineOutcome => ({
  table: TABLE,
  id,
  kind,
  ...(code ? { code } : {}),
  ...(message ? { message } : {}),
  ...(mergedInto ? { mergedInto } : {}),
});

const forbidden = (id: string, code: string, message: string): LineOutcome => {
  logger.warn({ event: 'sync_line_forbidden', table: TABLE, recordId: id, code }, 'line refused');
  return outcome(id, 'forbidden', code, message);
};

const invalidField = (id: string): LineOutcome =>
  outcome(id, 'aside', 'INVALID_FIELD', 'A field of this customer cannot be stored');

const INVALID = Symbol('invalid');

/** A text the phone sent: `undefined` when absent, `null` when empty, `INVALID` when unusable. */
function readText(
  row: Row,
  key: string,
  max: number,
  trimmed: boolean
): string | null | undefined | typeof INVALID {
  if (!(key in row)) return undefined;
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') return INVALID;
  const text = trimmed ? value.trim() : value;
  if (text.length > max) return INVALID;
  return text;
}

/** True when a created row names anything the server alone decides (credit, status, parties). */
function carriesServerOwnedField(row: Row): boolean {
  return Object.entries(row).some(([key, value]) => {
    if (CREATE_FIELDS.has(key) || value === null || value === undefined) return false;
    if (key === 'credit_limit') return value !== 0;
    if (key === 'status') return value !== 'ACTIVE';
    return true;
  });
}

type NewRow = {
  id: string;
  organizationId: string;
  personId: string | null;
  phone: string | null;
  label: string | null;
  address: string | null;
  notes: string | null;
  createdById: string;
};

/**
 * Inserts a relationship with the server's defaults (limit 0, ACTIVE, balance 0). `ON CONFLICT DO
 * NOTHING` makes a concurrent twin (same id or same customer pair, C-07) a no-op instead of an
 * error that would abort the whole batch (C-36).
 *
 * @returns True when the row was inserted.
 */
async function insertRow(tx: Prisma.TransactionClient, v: NewRow): Promise<boolean> {
  const inserted = await tx.$executeRaw`
    INSERT INTO "customer_relationships" (
      "id", "supplier_organization_id", "customer_person_id", "customer_phone_number",
      "customer_label", "delivery_address", "supplier_notes", "credit_limit", "status",
      "created_by_id"
    )
    VALUES (
      ${v.id}::uuid, ${v.organizationId}::uuid, ${v.personId}::uuid, ${v.phone},
      ${v.label}, ${v.address}, ${v.notes}, 0, 'ACTIVE'::"RelationshipStatus",
      ${v.createdById}::uuid
    )
    ON CONFLICT DO NOTHING
  `;
  return inserted === 1;
}

/** The line of a row already stored under this id: a repeat changes nothing (AC-6). */
async function answerForStoredRow(
  tx: Prisma.TransactionClient,
  id: string
): Promise<LineOutcome | null> {
  const stored = await tx.customerRelationship.findUnique({
    where: { id },
    select: { mergedIntoId: true },
  });
  if (!stored) return null;
  return outcome(id, 'accepted', undefined, undefined, stored.mergedIntoId ?? undefined);
}

/**
 * One created customer. The judge has already checked scope, the right to create and the author.
 * Never throws for a business reason: a duplicate is folded into the live relationship and an
 * unusable line is refused or set aside, so one customer cannot block the phone's batch (C-36).
 */
async function createOne(ctx: PushContext, { id, row }: Pushed): Promise<LineOutcome> {
  const { tx, viewer } = ctx;
  const repeat = await answerForStoredRow(tx, id);
  if (repeat) return repeat;

  if (carriesServerOwnedField(row)) {
    return forbidden(id, 'FIELD_NOT_ALLOWED', 'Your role may not make this change');
  }
  const organizationId = row['supplier_organization_id'];
  if (typeof organizationId !== 'string') return invalidField(id);

  const rawPhone = row['customer_phone_number'];
  if (rawPhone === undefined || rawPhone === null || rawPhone === '') {
    return forbidden(id, 'COUNTER_ONLINE_ONLY', 'A counter can only be added online');
  }
  const phone = typeof rawPhone === 'string' ? normalizeE164(rawPhone) : null;
  if (phone === null) {
    return outcome(id, 'issue', 'INVALID_PHONE', 'The phone number is not a valid mobile number');
  }

  const label = readText(row, 'customer_label', LABEL_MAX, true);
  const address = readText(row, 'delivery_address', TEXT_MAX, false);
  const notes = readText(row, 'supplier_notes', TEXT_MAX, false);
  if (label === INVALID || label === '' || address === INVALID || notes === INVALID) {
    return invalidField(id);
  }

  const person = await findOrCreateByPhone(phone, tx);
  const fields = {
    id,
    organizationId,
    label: label ?? null,
    address: address ?? null,
    notes: notes ?? null,
    createdById: viewer.personId,
  };
  const live = await findLive(tx, organizationId, person.id);
  if (!live) {
    const inserted = await insertRow(tx, { ...fields, personId: person.id, phone: null });
    if (inserted) return outcome(id, 'accepted');
    const twin = await answerForStoredRow(tx, id);
    if (twin) return twin;
  }

  const kept = live ?? (await findLive(tx, organizationId, person.id));
  if (!kept) throw new Error('Customer relationship neither created nor found');
  return mergeInto(tx, kept, { ...fields, label: label ?? kept.customerLabel ?? phone, phone });
}

function findLive(tx: Prisma.TransactionClient, organizationId: string, personId: string) {
  return tx.customerRelationship.findFirst({
    where: {
      supplierOrganizationId: organizationId,
      customerPersonId: personId,
      deletedAt: null,
      mergedIntoId: null,
    },
    select: { id: true, customerLabel: true },
  });
}

/**
 * Stores the duplicate as the phone built it (typed number, no person) and folds it into the
 * relationship the organization already holds with that person (C-07, C-36).
 */
async function mergeInto(
  tx: Prisma.TransactionClient,
  kept: { id: string },
  duplicate: Omit<NewRow, 'personId' | 'phone'> & { phone: string }
): Promise<LineOutcome> {
  if (!(await insertRow(tx, { ...duplicate, personId: null }))) {
    const twin = await answerForStoredRow(tx, duplicate.id);
    if (twin) return twin;
    throw new Error('Duplicate relationship neither created nor found');
  }
  await mergeDuplicateRelation(tx, duplicate.id, kept.id);
  logger.info(
    { event: 'sync_customer_merged', duplicateId: duplicate.id, keptId: kept.id },
    'duplicate customer folded'
  );
  return outcome(
    duplicate.id,
    'issue',
    'MERGED',
    `${duplicate.label ?? ''} ajoutée deux fois : fiches réunies`,
    kept.id
  );
}

/**
 * One edited customer: only the three SELLER fields are written, whatever else the row echoes (the
 * judge has refused any other change). An edit aimed at a merged duplicate lands on its survivor.
 */
async function updateOne(tx: Prisma.TransactionClient, { id, row }: Pushed): Promise<LineOutcome> {
  const stored = await tx.customerRelationship.findUnique({
    where: { id },
    select: { deletedAt: true, mergedIntoId: true },
  });
  if (!stored) return outcome(id, 'aside', 'NOT_FOUND', 'This customer no longer exists');
  if (stored.deletedAt && !stored.mergedIntoId) {
    return outcome(id, 'aside', 'ROW_DELETED', 'This customer was deleted');
  }
  const targetId = stored.mergedIntoId ? await resolveMergedRelation(id, tx) : id;

  const label = readText(row, 'customer_label', LABEL_MAX, true);
  const address = readText(row, 'delivery_address', TEXT_MAX, false);
  const notes = readText(row, 'supplier_notes', TEXT_MAX, false);
  if (label === INVALID || label === '' || address === INVALID || notes === INVALID) {
    return invalidField(id);
  }
  const data: Prisma.CustomerRelationshipUpdateInput = {};
  if (label !== undefined) data.customerLabel = label;
  if (address !== undefined) data.deliveryAddress = address;
  if (notes !== undefined) data.supplierNotes = notes;
  if (Object.keys(data).length === 0) return outcome(id, 'accepted');

  if (label === null) {
    // Only a counter needs its label (C-06).
    const target = await tx.customerRelationship.findUnique({
      where: { id: targetId },
      select: { customerPersonId: true, customerOrganizationId: true },
    });
    if (!target || (target.customerPersonId === null && target.customerOrganizationId === null)) {
      return invalidField(id);
    }
  }
  await tx.customerRelationship.update({ where: { id: targetId }, data });
  return outcome(id, 'accepted', undefined, undefined, stored.mergedIntoId ? targetId : undefined);
}

/**
 * Push side of `customer_relationships` (SYNC-011): customers added by phone number, found or
 * created as persons, merged when the organization already has them, and edited in three fields.
 * Credit limit, balance, status and parties are the server's (CWE-915). Person, relationship and
 * merge share the batch's transaction (ASVS v5.0.0-2.3.3). Persons created are bounded by the
 * batch row limit of the push schema (v5.0.0-2.4.1). Deletions stay refused.
 *
 * @param ctx - Viewer and the batch's transaction; lines arrive already judged.
 * @param change - Judged lines of the table.
 */
export async function pushRelationships(
  ctx: PushContext,
  change: TableChange
): Promise<LineOutcome[]> {
  const outcomes: LineOutcome[] = [];
  const pushed = (row: Row): Pushed => ({ id: String(row['id']), row });
  for (const row of change.created) outcomes.push(await createOne(ctx, pushed(row)));
  for (const row of change.updated) outcomes.push(await updateOne(ctx.tx, pushed(row)));
  outcomes.push(...refuseEveryLine({ ...change, created: [], updated: [] }));
  return outcomes;
}
