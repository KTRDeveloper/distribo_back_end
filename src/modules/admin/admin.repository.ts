import type { AdminAction, AdministratorRole, Person, Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { newId } from '../../shared/ids.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
import type { ListReportsQuery } from './admin.schemas.js';

/** Kinds of administrator action recorded in the journal. */
export type AdminActionType =
  | 'SUSPEND'
  | 'REACTIVATE'
  | 'DISMISS_REPORT'
  | 'APPOINT_ADMIN'
  | 'REMOVE_ADMIN'
  | 'REPLAY_SYNC'
  | 'RECOVER_2FA';

/** Fields a caller supplies; the id and the server time are never client-provided. */
export interface AdminActionInput {
  administratorId: string;
  action: AdminActionType;
  /** Exactly one of targetPersonId and targetOrganizationId (enforced by the database). */
  targetPersonId?: string | null;
  targetOrganizationId?: string | null;
  reportId?: string | null;
  /** Required for REPLAY_SYNC, forbidden otherwise (enforced by the database). */
  syncArchiveId?: string | null;
  reason: string;
}

/**
 * Appends one entry to the immutable administration journal (v5.0.0-16.3.1).
 *
 * Takes a transaction client so the entry is saved atomically with the action it
 * records. Generates a new UUIDv7 id; `occurred_at` is set by the database.
 * Database rule violations (targets, reason, REPLAY_SYNC role) surface as
 * errors and abort the surrounding transaction (fail closed).
 *
 * @param tx Transaction client of the action being recorded.
 * @param input Author, action, target and reason.
 * @returns The inserted row.
 */
export async function recordAdminAction(
  tx: Prisma.TransactionClient,
  input: AdminActionInput
): Promise<AdminAction> {
  return tx.adminAction.create({
    data: {
      id: newId(),
      administratorId: input.administratorId,
      action: input.action,
      targetPersonId: input.targetPersonId ?? null,
      targetOrganizationId: input.targetOrganizationId ?? null,
      reportId: input.reportId ?? null,
      syncArchiveId: input.syncArchiveId ?? null,
      reason: input.reason,
    },
  });
}

/** Arbitrary constant naming the advisory lock that serializes first-administrator bootstrap. */
const BOOTSTRAP_LOCK_KEY = 7_265_001;

/**
 * Takes a transaction-scoped lock so two concurrent bootstraps cannot both see "no live
 * SUPER_ADMIN" and both insert one (CWE-362). Released when the transaction ends.
 */
export async function lockSuperAdminBootstrap(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`;
}

/** Arbitrary constant naming the advisory lock that serializes removals of administrators. */
const REMOVAL_LOCK_KEY = 7_265_002;

/**
 * Takes a transaction-scoped lock so two concurrent removals cannot each see another live
 * SUPER_ADMIN and both remove the last two (CWE-362). Released when the transaction ends.
 */
export async function lockAdministratorRemoval(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REMOVAL_LOCK_KEY})`;
}

/** The live administrator row with this id (`removed_at` empty), or null. */
export async function findLiveAdministratorById(
  tx: Prisma.TransactionClient,
  administratorId: string
): Promise<{ id: string; personId: string; role: AdministratorRole } | null> {
  return tx.administrator.findFirst({
    where: { id: administratorId, removedAt: null },
    select: { id: true, personId: true, role: true },
  });
}

/** Number of live SUPER_ADMIN rows other than `exceptId`. */
export async function countOtherLiveSuperAdmins(
  tx: Prisma.TransactionClient,
  exceptId: string
): Promise<number> {
  return tx.administrator.count({
    where: { role: 'SUPER_ADMIN', removedAt: null, id: { not: exceptId } },
  });
}

/**
 * Marks a live administrator removed; the row stays so the journal keeps its author.
 *
 * @returns false when the row was not live (nothing changed).
 */
export async function markAdministratorRemoved(
  tx: Prisma.TransactionClient,
  administratorId: string
): Promise<boolean> {
  const result = await tx.administrator.updateMany({
    where: { id: administratorId, removedAt: null },
    data: { removedAt: new Date() },
  });
  return result.count === 1;
}

/** True when at least one SUPER_ADMIN row has not been removed. */
export async function hasLiveSuperAdmin(tx: Prisma.TransactionClient): Promise<boolean> {
  const count = await tx.administrator.count({ where: { role: 'SUPER_ADMIN', removedAt: null } });
  return count > 0;
}

/** Finds a registered (non-guest) person by E.164 phone number; null for a guest or unknown number. */
export async function findRegisteredPersonIdByPhone(
  tx: Prisma.TransactionClient,
  e164: string
): Promise<string | null> {
  const person = await tx.person.findFirst({
    where: { phoneNumber: e164, registeredAt: { not: null } },
    select: { id: true },
  });
  return person?.id ?? null;
}

/** Finds a registered (non-guest) person by E.164 phone number; null for a guest or unknown number. */
export async function findRegisteredPersonByPhone(
  tx: Prisma.TransactionClient,
  e164: string
): Promise<Person | null> {
  return tx.person.findFirst({ where: { phoneNumber: e164, registeredAt: { not: null } } });
}

/** True when the person has a live administrator row (`removed_at` empty). */
export async function hasLiveAdministrator(
  tx: Prisma.TransactionClient,
  personId: string
): Promise<boolean> {
  const count = await tx.administrator.count({ where: { personId, removedAt: null } });
  return count > 0;
}

/**
 * Inserts an administrator row with an already-encrypted two-factor secret. The id is the
 * client-generated UUIDv7 of the appointment.
 */
export async function insertAdministrator(
  tx: Prisma.TransactionClient,
  input: { id: string; personId: string; role: AdministratorRole; encryptedTotpSecret: string }
): Promise<void> {
  await tx.administrator.create({
    data: {
      id: input.id,
      personId: input.personId,
      role: input.role,
      totpSecret: input.encryptedTotpSecret,
    },
  });
}

/**
 * Inserts a SUPER_ADMIN row with an already-encrypted two-factor secret.
 *
 * @returns The new administrator id (a new UUIDv7).
 */
export async function insertSuperAdministrator(
  tx: Prisma.TransactionClient,
  personId: string,
  encryptedTotpSecret: string
): Promise<string> {
  const id = newId();
  await tx.administrator.create({
    data: { id, personId, role: 'SUPER_ADMIN', totpSecret: encryptedTotpSecret },
  });
  return id;
}

/** The fields a sign-in or a request check needs from a live administrator. */
export interface LiveAdministrator {
  id: string;
  personId: string;
  role: 'MODERATOR' | 'SUPER_ADMIN';
  totpSecret: string;
}

/**
 * Finds the person's live administrator row (`removed_at` empty); null when the person was
 * never appointed or was removed. At most one live row exists per person.
 */
export async function findLiveAdministratorByPerson(
  personId: string
): Promise<LiveAdministrator | null> {
  return prisma.administrator.findFirst({
    where: { personId, removedAt: null },
    select: { id: true, personId: true, role: true, totpSecret: true },
  });
}

/**
 * Finds a live administrator by id and person together, so a token naming a mismatched pair
 * finds nothing. Null once the administrator is removed (v5.0.0-7.2.1).
 */
export async function findLiveAdministrator(
  administratorId: string,
  personId: string
): Promise<LiveAdministrator | null> {
  return prisma.administrator.findFirst({
    where: { id: administratorId, personId, removedAt: null },
    select: { id: true, personId: true, role: true, totpSecret: true },
  });
}

/** The person's own email, or null when none is saved. */
export async function findPersonEmail(personId: string): Promise<string | null> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { email: true },
  });
  return person?.email ?? null;
}

/**
 * Stores the recovery email on the administrator's live row.
 *
 * @returns false when the row is gone or removed (nothing stored).
 */
export async function setRecoveryEmail(administratorId: string, email: string): Promise<boolean> {
  const result = await prisma.administrator.updateMany({
    where: { id: administratorId, removedAt: null },
    data: { recoveryEmail: email },
  });
  return result.count === 1;
}

/** Runs `fn` in one transaction so an action and its journal row succeed or fail together. */
export function inTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}

/** True when a person row with this id exists. */
export async function personExists(
  tx: Prisma.TransactionClient,
  personId: string
): Promise<boolean> {
  const count = await tx.person.count({ where: { id: personId } });
  return count > 0;
}

/** True when a live (not deleted) organization with this id exists. */
export async function organizationExists(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<boolean> {
  const count = await tx.organization.count({ where: { id: organizationId, deletedAt: null } });
  return count > 0;
}

/** True when the person is the ACTIVE OWNER of the organization. */
export async function isActiveOwner(
  tx: Prisma.TransactionClient,
  personId: string,
  organizationId: string
): Promise<boolean> {
  const count = await tx.collaboration.count({
    where: { personId, organizationId, role: 'OWNER', status: 'ACTIVE', deletedAt: null },
  });
  return count > 0;
}

/** The fields of a stored report that the reporter gets back. */
export interface StoredReport {
  id: string;
  status: 'PENDING';
  reportedAt: Date;
}

/**
 * Inserts a report. Status is always PENDING and `reported_at` comes from the database; the
 * decision and the resolver stay empty until a moderator resolves it.
 */
export async function insertReport(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    reporterId: string;
    targetPersonId: string | null;
    targetOrganizationId: string | null;
    reason: string;
    description: string;
  }
): Promise<StoredReport> {
  const row = await tx.report.create({
    data: { ...input, status: 'PENDING' },
    select: { id: true, reportedAt: true },
  });
  return { id: row.id, status: 'PENDING', reportedAt: row.reportedAt };
}

const reportInclude = {
  reporter: true,
  targetPerson: true,
  targetOrganization: { select: { id: true, name: true, status: true } },
} satisfies Prisma.ReportInclude;

/** A report with its reporter and target loaded, for the moderators' views. */
export type ReportRow = Prisma.ReportGetPayload<{ include: typeof reportInclude }>;

/**
 * Lists reports, keyset-paged on (`reported_at`, `id`). PENDING is oldest first so the queue
 * is worked in order; any other filter is newest first. The cursor carries the last item.
 */
export async function listReportRows(
  query: ListReportsQuery
): Promise<{ rows: ReportRow[]; nextCursor: string | null }> {
  const oldestFirst = query.status === 'PENDING';
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const after = oldestFirst ? 'gt' : 'lt';
  const rows = await prisma.report.findMany({
    where: {
      ...(query.status ? { status: query.status } : {}),
      ...(cursor
        ? {
            OR: [
              { reportedAt: { [after]: cursor.createdAt } },
              { reportedAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    include: reportInclude,
    orderBy: [{ reportedAt: oldestFirst ? 'asc' : 'desc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ createdAt: last.reportedAt, id: last.id })
        : null,
  };
}

/** One report with its reporter and target, or null when none has this id. */
export function findReportRow(reportId: string): Promise<ReportRow | null> {
  return prisma.report.findUnique({ where: { id: reportId }, include: reportInclude });
}
