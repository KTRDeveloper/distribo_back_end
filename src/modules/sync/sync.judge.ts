import { subject, type MongoAbility } from '@casl/ability';
import type { Prisma } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { abilityFor } from '../../shared/access/ability.js';
import {
  adoptRestRows,
  dropClosing,
  findRestOrders,
  runClosings,
  splitRestRows,
  takeDeliveries,
  takeLedger,
  takeLines,
  takeOrders,
  type ClosingBook,
} from './adapters/closing.push.js';
import { runBatchControls } from './sync.controls.js';
import { getAdapters } from './sync.registry.js';
import {
  findOrderOwner,
  findRelationshipOwner,
  findStoredRow,
  withPushTransaction,
  type RowOwner,
} from './sync.repository.js';
import type { PushBatch } from './sync.schemas.js';
import {
  SYNC_TABLES,
  type LineOutcome,
  type Row,
  type SyncTable,
  type TableChange,
  type Viewer,
} from './sync.types.js';

/** What a processed batch comes to, as the push answer reports it. */
export type PushResult = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
  resync_required: boolean;
};

export type JudgeOptions = {
  /**
   * Set by a super-administrator replay (SYNC-022). The judging is the same: the batch is judged
   * as if sent by its author with their current rights, never the caller's.
   */
  replay?: boolean;
  /** Runs first in the batch's transaction (the push uses it for the conflict check). */
  beforeApply?: (tx: Prisma.TransactionClient) => Promise<void>;
};

/** Tables judged line by line, parents before children (AC-5). */
export const JUDGE_TABLE_ORDER = [
  'customer_relationships',
  'orders',
  'order_lines',
  'deliveries',
  'ledger_entries',
  'notifications',
] as const satisfies readonly SyncTable[];

type JudgedTable = (typeof JUDGE_TABLE_ORDER)[number];

/** The server writes these from its own rules, never from a phone (CM-27, ASVS v5.0.0-15.3.3). */
const COMPUTED_EVERYWHERE = [
  'balance',
  'amount_held',
  'balance_effect',
  'total_amount',
  'price_updated_at',
  'credit_limit_set_at',
  'ended_by_party',
  'last_synced_at',
  'scope_version',
  'server_updated_at',
] as const;

type Right = { action: string; subject: string; withRow?: boolean };

type TableRules = {
  /** The subject of the rules table (ACC). */
  subject: string;
  /** Computed fields of this table on top of the common ones. */
  computed: string[];
  /** Any one of these lets the role create a row. */
  create: Right[];
  /**
   * Fields whose right depends on the step the row goes through (status, delivery times): the
   * rules table grants them as transitions, not as `update`. The judge only requires that the role
   * holds one of the transitions; the adapter checks the step itself (SYNC-012 onward).
   */
  steps?: { fields: string[]; any: Right[] };
  /** Fields that name the author of a create: always the viewer's id. */
  author: string[];
  /** Fields of a row in scope that any role may change: the viewer's own (a notification's read state). */
  ownFields?: string[];
  /** Author fields written only when the row already carries them. */
  authorIfPresent?: string[];
  /** The field that points to the parent row whose owner decides the scope of a create. */
  parent?: { field: string; find: typeof findRelationshipOwner };
};

const ORDER_STEPS: Right[] = [
  'depart',
  'deliver',
  'fail_delivery',
  'accept',
  'refuse',
  'cancel',
].map((action) => ({ action, subject: 'Order' }));

const RULES_OF: Record<JudgedTable, TableRules> = {
  customer_relationships: {
    subject: 'CustomerRelationship',
    computed: [],
    create: [{ action: 'create', subject: 'CustomerRelationship', withRow: true }],
    author: ['created_by_id'],
  },
  orders: {
    subject: 'Order',
    computed: ['sync_issue'],
    create: [{ action: 'create', subject: 'Order', withRow: true }],
    steps: {
      fields: [
        'status',
        'delivered_at',
        'delivered_by_id',
        'cancelled_by_party',
        'cancelled_by_id',
        'cancelled_at',
        'cancellation_reason',
      ],
      any: ORDER_STEPS,
    },
    author: ['entered_by_id'],
    parent: { field: 'customer_relationship_id', find: findRelationshipOwner },
  },
  order_lines: {
    subject: 'OrderLine',
    computed: ['amount', 'price_set_at'],
    // A line is written together with its order: the right to create it is the order's.
    create: [{ action: 'create', subject: 'Order' }],
    steps: { fields: ['delivered_quantity'], any: [{ action: 'deliver', subject: 'Order' }] },
    author: [],
    authorIfPresent: ['price_set_by_id'],
    parent: { field: 'order_id', find: findOrderOwner },
  },
  deliveries: {
    subject: 'Delivery',
    computed: ['sync_issue'],
    create: [
      { action: 'depart', subject: 'Order' },
      { action: 'assign', subject: 'Delivery' },
    ],
    steps: {
      fields: ['departed_at', 'arrived_at', 'failed_at', 'failure_reason'],
      any: [
        { action: 'depart', subject: 'Order' },
        { action: 'deliver', subject: 'Order' },
        { action: 'fail_delivery', subject: 'Order' },
      ],
    },
    author: [],
    parent: { field: 'order_id', find: findOrderOwner },
  },
  ledger_entries: {
    subject: 'LedgerEntry',
    computed: [],
    create: [{ action: 'create', subject: 'LedgerEntry', withRow: true }],
    author: ['recorded_by_id'],
    parent: { field: 'customer_relationship_id', find: findRelationshipOwner },
  },
  notifications: {
    subject: 'Notification',
    computed: [],
    // The server writes notifications; a phone only reads them and marks its own as read.
    create: [],
    ownFields: ['read_status'],
    author: ['recipient_id'],
  },
};

const isJudged = (table: SyncTable): table is JudgedTable =>
  (JUDGE_TABLE_ORDER as readonly string[]).includes(table);

/**
 * Removes from a pushed row the fields the server computes (balance, totals, line and sale
 * amounts, price and limit dates, last sync, scope version, server time). The caller keeps the
 * result; the server recomputes the values (CM-27, ASVS v5.0.0-15.3.3).
 *
 * @returns A copy of the row without computed fields; the input is not changed.
 */
export function stripComputed(table: SyncTable, row: Row): Row {
  const removed = new Set<string>(COMPUTED_EVERYWHERE);
  if (isJudged(table)) for (const field of RULES_OF[table].computed) removed.add(field);
  // A sale's amount comes from its order; a payment's amount is what the phone collected.
  if (table === 'ledger_entries' && row['kind'] === 'SALE') removed.add('amount');
  return Object.fromEntries(Object.entries(row).filter(([key]) => !removed.has(key)));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** Abilities as the server judges: never online, never past the 3-day window (ACC rules table). */
const SERVER_CONTEXT = { onServer: true, online: false, daysSinceSync: 0 } as const;

type Verdict = { ok: true; row: Row } | { ok: false; code: string; message: string };
const refuse = (code: string, message: string): Verdict => ({ ok: false, code, message });
const OUT_OF_SCOPE = refuse('OUT_OF_SCOPE', 'This line is outside your scope');
const NOT_ALLOWED = refuse('FIELD_NOT_ALLOWED', 'Your role may not make this change');
const ONLINE_ONLY = refuse('ONLINE_ONLY', 'This gesture can only be made online');

type Judge = {
  viewer: Viewer;
  tx: Prisma.TransactionClient;
  abilities: Map<string, MongoAbility>;
  /** The orders closed in this batch (SYNC-014): their SALE and PAYMENT rows are not SYNC-015's. */
  closings: ClosingBook;
};

/**
 * The ledger only grows through a SELLER payment (SYNC-015): any other kind, and any update or
 * delete of a row, is online-only whatever the role. The SALE and PAYMENT rows of an order closed
 * in this batch belong to the closing (SYNC-014). Checked before scope and role, so the answer
 * never says whether a row exists (ASVS v5.0.0-8.2.1).
 */
function isOnlineOnlyLedger(judge: Judge, row: Row | null, listed: 'created' | 'updated'): boolean {
  if (row === null || listed === 'updated') return true;
  if (row['kind'] === 'PAYMENT' && (row['order_id'] ?? null) === null) return false;
  const orderId = row['order_id'];
  const closing = typeof orderId === 'string' && judge.closings.has(orderId);
  return !(closing && (row['kind'] === 'SALE' || row['kind'] === 'PAYMENT'));
}

/**
 * The viewer's role for a row's owner: a customer person acts as a customer (no write right) even
 * if also a collaborator of the supplier, otherwise the role of an ACTIVE membership in the
 * supplier organization; null when neither holds, so the row is outside the scope.
 */
function roleFor(viewer: Viewer, owner: RowOwner): string | null {
  if (owner.customerPersonId !== null && owner.customerPersonId === viewer.personId) {
    return 'CUSTOMER';
  }
  const membership = viewer.memberships.find((m) => m.organizationId === owner.organizationId);
  return membership?.role ?? null;
}

function abilityOf(judge: Judge, role: string): MongoAbility {
  let ability = judge.abilities.get(role);
  if (!ability) {
    ability = abilityFor(role, SERVER_CONTEXT);
    judge.abilities.set(role, ability);
  }
  return ability;
}

/** True when the role holds any of the rights; `row` is the instance rule conditions read. */
function holdsAny(ability: MongoAbility, rights: Right[], type: string, row: Row): boolean {
  return rights.some((right) =>
    right.withRow
      ? ability.can(right.action, subject(right.subject, row))
      : ability.can(right.action, right.subject) && type !== ''
  );
}

function sameValue(stored: unknown, pushed: unknown): boolean {
  const normalized = (value: unknown): unknown => {
    if (value === undefined || value === null) return null;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'object' && 'toNumber' in value)
      return (value as { toNumber(): number }).toNumber();
    return value;
  };
  const left = normalized(stored);
  const right = normalized(pushed);
  if (left === right) return true;
  if (typeof left === 'number' && typeof right === 'string') return Number(right) === left;
  if (stored instanceof Date && typeof right === 'string') {
    // A date column travels as `YYYY-MM-DD`, a timestamp as epoch milliseconds or ISO.
    return Date.parse(right) === stored.getTime() || right === stored.toISOString().slice(0, 10);
  }
  return false;
}

/** Where a row to create belongs: from the row's own references; 'unresolved' when it names none. */
async function ownerOfNewRow(
  judge: Judge,
  table: JudgedTable,
  row: Row
): Promise<RowOwner | 'unresolved' | null> {
  if (table === 'customer_relationships') {
    const organization = row['supplier_organization_id'] ?? null;
    const person = row['customer_person_id'] ?? null;
    if ((organization !== null && !isUuid(organization)) || (person !== null && !isUuid(person))) {
      return null;
    }
    return { organizationId: organization, customerPersonId: person };
  }
  if (table === 'notifications') {
    const recipient = row['recipient_id'] ?? null;
    return isUuid(recipient) ? { organizationId: null, customerPersonId: recipient } : null;
  }
  const parent = RULES_OF[table].parent;
  if (!parent) return null;
  const ref = row[parent.field] ?? null;
  // No parent named: nothing can be written under it, and the adapter refuses the malformed row.
  if (ref === null) return 'unresolved';
  return isUuid(ref) ? parent.find(judge.tx, ref) : null;
}

/** Judges one created or updated row: scope, then rights, then the clean row for the adapter. */
async function judgeRow(judge: Judge, table: JudgedTable, row: Row, listed: 'created' | 'updated') {
  if (table === 'ledger_entries' && isOnlineOnlyLedger(judge, row, listed)) return ONLINE_ONLY;
  const id = row['id'];
  if (!isUuid(id)) return OUT_OF_SCOPE;
  const rules = RULES_OF[table];
  const stored = await findStoredRow(judge.tx, table, id);
  // An update of a row that does not exist is answered like one outside the scope.
  if (!stored && listed === 'updated') return OUT_OF_SCOPE;

  const owner = stored ? stored.owner : await ownerOfNewRow(judge, table, row);
  if (owner === null) return OUT_OF_SCOPE;
  const role = owner === 'unresolved' ? null : roleFor(judge.viewer, owner);
  if (owner !== 'unresolved' && role === null) return OUT_OF_SCOPE;

  const clean = stripComputed(table, row);
  if (role === null) return { ok: true, row: clean } satisfies Verdict;
  const ability = abilityOf(judge, role);

  if (listed === 'created' || !stored) {
    if (!holdsAny(ability, rules.create, rules.subject, row)) return NOT_ALLOWED;
    for (const field of rules.author) clean[field] = judge.viewer.personId;
    for (const field of rules.authorIfPresent ?? []) {
      if (field in clean) clean[field] = judge.viewer.personId;
    }
    return { ok: true, row: clean } satisfies Verdict;
  }

  const instance = subject(rules.subject, stored.row);
  for (const [field, value] of Object.entries(clean)) {
    if (field === 'id' || rules.ownFields?.includes(field)) continue;
    if (field in stored.row && sameValue(stored.row[field], value)) continue;
    const step = rules.steps?.fields.includes(field) === true;
    const allowed = step
      ? holdsAny(ability, rules.steps?.any ?? [], rules.subject, stored.row)
      : ability.can('update', instance, field);
    if (!allowed) return NOT_ALLOWED;
  }
  return { ok: true, row: clean } satisfies Verdict;
}

/** Judges the deletion of a row by id: it must be in scope and the role must hold `delete`. */
async function judgeDeletion(judge: Judge, table: JudgedTable, id: string): Promise<Verdict> {
  if (table === 'ledger_entries' && isOnlineOnlyLedger(judge, null, 'updated')) return ONLINE_ONLY;
  if (!isUuid(id)) return OUT_OF_SCOPE;
  const stored = await findStoredRow(judge.tx, table, id);
  if (!stored) return OUT_OF_SCOPE;
  const role = roleFor(judge.viewer, stored.owner);
  if (role === null) return OUT_OF_SCOPE;
  const allowed = abilityOf(judge, role).can(
    'delete',
    subject(RULES_OF[table].subject, stored.row)
  );
  return allowed ? { ok: true, row: {} } : NOT_ALLOWED;
}

/** Judges every line of one table; returns the lines to hand over and the forbidden outcomes. */
async function judgeTable(judge: Judge, table: JudgedTable, change: TableChange) {
  const passed: TableChange = { table, created: [], updated: [], deleted: [] };
  const forbidden: LineOutcome[] = [];
  const refuseLine = (id: string, verdict: Verdict & { ok: false }) => {
    logger.warn(
      {
        event: 'sync_line_forbidden',
        personId: judge.viewer.personId,
        deviceId: judge.viewer.deviceId,
        table,
        recordId: id,
        code: verdict.code,
      },
      'pushed line refused by the judge'
    );
    forbidden.push({ table, id, kind: 'forbidden', code: verdict.code, message: verdict.message });
  };

  for (const listed of ['created', 'updated'] as const) {
    for (const row of change[listed]) {
      const verdict = await judgeRow(judge, table, row, listed);
      if (verdict.ok) passed[listed].push(verdict.row);
      else refuseLine(typeof row['id'] === 'string' ? row['id'] : '', verdict);
    }
  }
  for (const id of change.deleted) {
    const verdict = await judgeDeletion(judge, table, id);
    if (verdict.ok) passed.deleted.push(id);
    else refuseLine(id, verdict);
  }
  return { passed, forbidden };
}

/**
 * Points the lines that name a merged duplicate's relationship to the surviving one, for the rest
 * of the batch (SYNC-011 AC-3). Rows are copied; the input is not changed.
 */
function redirectRelationshipRefs(
  change: TableChange,
  redirects: Map<string, string>
): TableChange {
  const FIELD = 'customer_relationship_id';
  const redirect = (row: Row): Row => {
    const target = typeof row[FIELD] === 'string' ? redirects.get(row[FIELD]) : undefined;
    return target ? { ...row, [FIELD]: target } : row;
  };
  return {
    ...change,
    created: change.created.map(redirect),
    updated: change.updated.map(redirect),
  };
}

/**
 * Lines whose order was not stored (an issue, set aside or refused by the orders adapter) are
 * answered like their order, and not judged: there is nothing to attach them to, and an honest
 * phone must not read that as a forbidden line (SYNC-012 AC-4). The same goes for the deliveries
 * of an order that was never stored (SYNC-013).
 *
 * @returns The change without those lines, and an outcome for each removed line.
 */
function withoutLinesOfUnstoredOrders(
  change: TableChange,
  unstored: Map<string, LineOutcome>
): { change: TableChange; outcomes: LineOutcome[] } {
  const outcomes: LineOutcome[] = [];
  const created = change.created.filter((row) => {
    const order = typeof row['order_id'] === 'string' ? unstored.get(row['order_id']) : undefined;
    if (!order || typeof row['id'] !== 'string') return true;
    outcomes.push({
      table: change.table,
      id: row['id'],
      kind: order.kind,
      ...(order.code ? { code: order.code } : {}),
      ...(order.message ? { message: order.message } : {}),
    });
    return false;
  });
  return { change: { ...change, created }, outcomes };
}

const countRows = (t: { created: unknown[]; updated: unknown[]; deleted: unknown[] }): number =>
  t.created.length + t.updated.length + t.deleted.length;

/**
 * The only way a batch is applied, from a push or a replay (SYNC-009, SYNC-022). In one
 * transaction, tables run in `JUDGE_TABLE_ORDER` then the others in sync order; each line of a
 * judged table is checked for scope (ASVS v5.0.0-8.2.2) and, field by field, against the rules
 * table with the server context (v5.0.0-8.2.3), its computed fields are removed and its author set
 * to the viewer (v5.0.0-15.3.3) before the table's adapter sees it. A refused line never stops
 * the others (CM-28). A table without adapter is set aside, line by line (C-36).
 *
 * A customer pushed twice and merged by its adapter (SYNC-011) sends its id to the survivor: the
 * later lines of the batch that name the duplicate are redirected before they are judged.
 *
 * An order the adapter did not store (SYNC-012) takes its lines of the batch with it: they get the
 * order's outcome instead of being judged.
 *
 * Once every table is applied, the controls on arrival run on the orders the batch created
 * (SYNC-016): they flag old prices and odd dates in `sync_issue` and notify the owners, never
 * refusing anything.
 *
 * A ledger line the phone may not write (any kind but a payment, an update, a delete) is answered
 * `ONLINE_ONLY` before the role check (SYNC-015).
 *
 * Tables outside the six judged ones go to their adapter as sent: their adapters own the rules.
 * Rows that name no parent are not scope-checked here, only handed over; the adapter refuses them.
 *
 * @param viewer - Built from the database for this exchange (the batch's author, on a replay).
 * @param batch - Already validated by the push schema.
 * @param options - `beforeApply` runs first, inside the transaction; an error it throws rolls back.
 */
export async function judgeBatch(
  viewer: Viewer,
  batch: PushBatch,
  options: JudgeOptions = {}
): Promise<PushResult> {
  return withPushTransaction(async (tx) => {
    await options.beforeApply?.(tx);

    const adapters = new Map(getAdapters().map((a) => [a.table, a]));
    const closings: ClosingBook = new Map();
    const judge: Judge = { viewer, tx, abilities: new Map(), closings };
    const outcomes: LineOutcome[] = [];
    let aside = 0;
    const redirects = new Map<string, string>();
    const unstoredOrders = new Map<string, LineOutcome>();
    const createdOrderIds: string[] = [];
    const restOrders = findRestOrders(batch.orders && { table: 'orders', ...batch.orders });

    for (const [name, change] of Object.entries(batch)) {
      if (!adapters.has(name as SyncTable)) aside += countRows(change);
    }
    const order: SyncTable[] = [...JUDGE_TABLE_ORDER, ...SYNC_TABLES.filter((t) => !isJudged(t))];
    for (const table of order) {
      const change = batch[table];
      const adapter = adapters.get(table);
      if (!change || !adapter) continue;
      let toApply: TableChange = { table, ...change };
      if (redirects.size > 0) toApply = redirectRelationshipRefs(toApply, redirects);
      if (
        (table === 'order_lines' || table === 'deliveries' || table === 'ledger_entries') &&
        unstoredOrders.size > 0
      ) {
        const split = withoutLinesOfUnstoredOrders(toApply, unstoredOrders);
        outcomes.push(...split.outcomes);
        toApply = split.change;
      }
      // The orders for the rest of a closing, and their lines, are made by the server (SYNC-014).
      let restRows: Row[] = [];
      if (restOrders.size > 0 && (table === 'orders' || table === 'order_lines')) {
        const split = splitRestRows(toApply, restOrders, table === 'orders' ? 'id' : 'order_id');
        toApply = split.kept;
        restRows = split.taken;
      }
      if (isJudged(table)) {
        const { passed, forbidden } = await judgeTable(judge, table, toApply);
        outcomes.push(...forbidden);
        toApply = passed;
        // An order pushed DELIVERED is closed by the server after every table (SYNC-014).
        const ctx = { viewer, tx };
        if (table === 'orders') {
          for (const row of toApply.created) {
            if (typeof row['id'] === 'string') createdOrderIds.push(row['id']);
          }
          toApply = takeOrders(closings, toApply);
        }
        if (restRows.length > 0 && (table === 'orders' || table === 'order_lines')) {
          outcomes.push(...adoptRestRows(closings, restOrders, table, restRows));
        }
        if (closings.size > 0) {
          if (table === 'order_lines') toApply = await takeLines(ctx, closings, toApply);
          if (table === 'deliveries') toApply = await takeDeliveries(ctx, closings, toApply);
          if (table === 'ledger_entries') toApply = takeLedger(closings, toApply);
        }
      }
      if (countRows(toApply) > 0) {
        // Only an order created in this batch can be missing for its lines: an edit of a stored
        // order (SYNC-013) that ends as an issue leaves the order and its lines in place.
        const createdIds = new Set(toApply.created.map((row) => row['id']));
        const pushed = await adapter.push({ viewer, tx }, toApply);
        outcomes.push(...pushed);
        for (const line of pushed) {
          if (line.mergedInto && table === 'customer_relationships') {
            redirects.set(line.id, line.mergedInto);
          }
          if (table === 'orders' && line.kind !== 'accepted' && createdIds.has(line.id)) {
            unstoredOrders.set(line.id, line);
            outcomes.push(...dropClosing(closings, line.id, line));
          }
        }
      }
    }

    for (const line of await runClosings({ viewer, tx }, closings)) {
      // The closing of an order created in this batch may refine the creation's own outcome.
      const index = outcomes.findIndex((o) => o.table === line.table && o.id === line.id);
      if (index === -1) outcomes.push(line);
      else if (line.kind !== 'accepted') outcomes[index] = line;
    }

    // Controls never refuse: they flag the orders stored by this batch and tell the owners (SYNC-016).
    await runBatchControls({ viewer, tx }, createdOrderIds);

    const rejected: PushResult['rejected'] = [];
    let accepted = 0;
    for (const outcome of outcomes) {
      if (outcome.kind === 'accepted' || outcome.kind === 'issue') accepted += 1;
      else if (outcome.kind === 'aside') aside += 1;
      else {
        rejected.push({
          table: outcome.table,
          id: outcome.id,
          code: outcome.code ?? 'REFUSED',
          message: outcome.message ?? 'Line refused',
        });
      }
    }
    return { accepted, rejected, aside, resync_required: false };
  });
}
