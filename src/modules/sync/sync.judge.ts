import { subject, type MongoAbility } from '@casl/ability';
import type { CollaborationRole, Prisma } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { abilityFor } from '../../shared/access/ability.js';
import { atLeast } from '../../shared/access/roles.js';
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
import { notify, recipientLanguage } from '../notification/notification.service.js';
import { runBatchControls, runLongAbsence } from './sync.controls.js';
import { enforceCatalogLimits } from './sync.limits.js';
import { getAdapters } from './sync.registry.js';
import {
  findOrderOwner,
  findProductOwner,
  findRelationshipOwner,
  findStoredRow,
  withPushTransaction,
  type StoredRow,
  type RowOwner,
} from './sync.repository.js';
import type { PushBatch } from './sync.schemas.js';
import {
  SYNC_TABLES,
  type LineOutcome,
  type PushContext,
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
  /** Runs last in the batch's transaction, with the result (the replay uses it to notify). */
  afterApply?: (tx: Prisma.TransactionClient, result: PushResult) => Promise<void>;
};

/**
 * Tables judged line by line, parents before children (SYNC-010 AC-5): a price may name a variant,
 * and a variant a product, of the same batch.
 */
export const JUDGE_TABLE_ORDER = [
  'customer_relationships',
  'products',
  'product_variants',
  'customer_prices',
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
  'contested_at',
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
  /**
   * The row belongs to the supplier business alone: only an ACTIVE member of it is in scope, never
   * the customer person of the relationship it hangs from (catalog tables, SYNC-030).
   */
  businessOnly?: boolean;
  /** The row carries `organization_id`: set from the scope's owner, never from the phone (ASVS v5.0.0-8.2.1). */
  stampOrganization?: boolean;
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
    computed: ['customer_public_name', 'supplier_public_name'],
    create: [{ action: 'create', subject: 'CustomerRelationship', withRow: true }],
    author: ['created_by_id'],
  },
  // Catalog and prices: the OWNER writes them offline, a MANAGER online only (ACC-008, CAT-023).
  products: {
    subject: 'Product',
    computed: ['paused_at', 'image_keys', 'image_urls'],
    create: [{ action: 'create', subject: 'Product', withRow: true }],
    author: [],
    businessOnly: true,
    stampOrganization: true,
  },
  product_variants: {
    subject: 'ProductVariant',
    computed: ['merged_into_id', 'image_keys', 'image_urls'],
    create: [{ action: 'create', subject: 'ProductVariant', withRow: true }],
    author: [],
    parent: { field: 'product_id', find: findProductOwner },
    businessOnly: true,
    stampOrganization: true,
  },
  customer_prices: {
    subject: 'CustomerPrice',
    computed: ['set_at', 'set_by_id'],
    create: [{ action: 'create', subject: 'CustomerPrice', withRow: true }],
    author: ['set_by_id'],
    parent: { field: 'customer_relationship_id', find: findRelationshipOwner },
    businessOnly: true,
  },
  orders: {
    subject: 'Order',
    // The receipt is frozen by the server at delivery (DLV-019): a pushed value is dropped (SYNC-048).
    computed: [
      'sync_issue',
      'supplier_name_applied',
      'customer_name_applied',
      'collected_applied',
      'balance_after_applied',
    ],
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

/** `graced` names the organization whose rows were kept under old rights (SYNC-019, CM-29). */
type Verdict =
  | { ok: true; row: Row; graced?: string; organizationId?: string }
  | { ok: false; code: string; message: string };
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
  /** True when the device missed a rights change: its seller operations are kept (SYNC-019). */
  stale: boolean;
  /** The orders this batch kept under old rights: their lines are judged the same way. */
  gracedOrders: Set<string>;
  /** The operations kept under old rights that the owners are told about. */
  gracedOps: Array<{ table: SyncTable; id: string; organizationId: string }>;
  /** Organizations of the product and variant lines this batch passed, fitted to their plan at the end (SYNC-035). */
  catalogOrganizations: Set<string>;
};

/**
 * The role under which a seller operation of a stale device is judged (CM-29): what a SELLER or a
 * DRIVER may do. A SELLER holds the DRIVER's rights too; nothing above (manager powers) is lent.
 */
const GRACE_ROLE: CollaborationRole = 'SELLER';

/** The only fields a late sale or delivery may change on an order, a line or a delivery. */
const SALE_ORDER_FIELDS = ['id', 'status', 'delivered_at', 'delivered_by_id'];
const SALE_LINE_FIELDS = ['id', 'order_id', 'delivered_quantity'];
const DELIVERY_FIELDS = [
  'id',
  'order_id',
  'departed_at',
  'arrived_at',
  'failed_at',
  'failure_reason',
];

const onlyFields = (row: Row, allowed: string[]): boolean =>
  Object.keys(row).every((key) => allowed.includes(key));

/**
 * True when the line is one of the three seller operations kept after a rights change (CM-29): a
 * sale (an order made or closed DELIVERED, and its lines), a delivery, or a payment. Anything else,
 * including an edit of those rows that carries other fields along, is judged with current rights
 * only (ASVS v5.0.0-8.2.1).
 */
function isSellerOperation(
  judge: Judge,
  table: JudgedTable,
  row: Row,
  listed: 'created' | 'updated',
  stored: StoredRow | null
): boolean {
  switch (table) {
    case 'orders':
      return (
        row['status'] === 'DELIVERED' &&
        (listed === 'created' || onlyFields(row, SALE_ORDER_FIELDS))
      );
    case 'order_lines': {
      if (listed === 'updated' && !onlyFields(row, SALE_LINE_FIELDS)) return false;
      const orderId = row['order_id'] ?? stored?.row['order_id'];
      return typeof orderId === 'string' && judge.gracedOrders.has(orderId);
    }
    case 'deliveries':
      return listed === 'created' || onlyFields(row, DELIVERY_FIELDS);
    case 'ledger_entries':
      return listed === 'created' && (row['kind'] === 'PAYMENT' || row['kind'] === 'SALE');
    default:
      return false;
  }
}

/**
 * The role a seller operation of a stale device is judged under: the person's own role when it
 * already is a SELLER or above, else the grace role: for a DRIVER, and for a collaborator revoked
 * from this very organization. Null for any other person, so a row outside what they ever belonged
 * to stays out of scope (ASVS v5.0.0-8.2.2).
 */
function graceRoleFor(viewer: Viewer, owner: RowOwner, role: string | null): string | null {
  if (role === 'CUSTOMER' || owner.organizationId === null) return null;
  if (role !== null) return atLeast(role, GRACE_ROLE) ? role : GRACE_ROLE;
  const former = viewer.formerMemberships ?? [];
  return former.some((m) => m.organizationId === owner.organizationId) ? GRACE_ROLE : null;
}

/**
 * The viewer the adapters see for the lines kept under old rights (SYNC-019). `own` keeps what the
 * person held, a former role capped at SELLER: a driver's closing still runs as a driver's, and a
 * former manager gets no manager power. `sale` lends at least a SELLER wherever the person was,
 * for the orders they made and closed themselves. Only lines the judge kept reach these viewers.
 */
function gracedViewer(viewer: Viewer, mode: 'own' | 'sale'): Viewer {
  const memberships = viewer.memberships.map((m) =>
    mode === 'sale' && !atLeast(m.role, GRACE_ROLE) ? { ...m, role: GRACE_ROLE } : m
  );
  for (const former of viewer.formerMemberships ?? []) {
    if (memberships.some((m) => m.organizationId === former.organizationId)) continue;
    const role = mode === 'own' && !atLeast(former.role, 'MANAGER') ? former.role : GRACE_ROLE;
    memberships.push({ organizationId: former.organizationId, role, status: 'ACTIVE' });
  }
  return { ...viewer, memberships };
}

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
  if (table === 'products') {
    const organization = row['organization_id'] ?? null;
    return isUuid(organization) ? { organizationId: organization, customerPersonId: null } : null;
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
async function judgeRow(
  judge: Judge,
  table: JudgedTable,
  row: Row,
  listed: 'created' | 'updated'
): Promise<Verdict> {
  if (table === 'ledger_entries' && isOnlineOnlyLedger(judge, row, listed)) return ONLINE_ONLY;
  const id = row['id'];
  if (!isUuid(id)) return OUT_OF_SCOPE;
  const rules = RULES_OF[table];
  const stored = await findStoredRow(judge.tx, table, id);
  // An update of a row that does not exist is answered like one outside the scope.
  if (!stored && listed === 'updated') return OUT_OF_SCOPE;

  const found = stored ? stored.owner : await ownerOfNewRow(judge, table, row);
  if (found === null) return OUT_OF_SCOPE;
  const owner =
    found !== 'unresolved' && rules.businessOnly
      ? { organizationId: found.organizationId, customerPersonId: null }
      : found;
  let role = owner === 'unresolved' ? null : roleFor(judge.viewer, owner);
  // A device that missed a rights change keeps its seller operations (CM-29, SYNC-019).
  let graced: string | undefined;
  // The database takes a new delivery only from an ACTIVE collaborator: a revoked person's new
  // departure stays refused, whatever the grace (their earlier deliveries are closed normally).
  const newDeparture = table === 'deliveries' && (listed === 'created' || !stored);
  if (
    judge.stale &&
    owner !== 'unresolved' &&
    !(newDeparture && role === null) &&
    isSellerOperation(judge, table, row, listed, stored)
  ) {
    const lent = graceRoleFor(judge.viewer, owner, role);
    if (lent !== null && owner.organizationId !== null) {
      role = lent;
      graced = owner.organizationId;
    }
  }
  if (owner !== 'unresolved' && role === null) return OUT_OF_SCOPE;

  const clean = stripComputed(table, row);
  const accept = (): Verdict => {
    if (graced === undefined) return { ok: true, row: clean };
    if (table === 'orders') judge.gracedOrders.add(id);
    const counted =
      table === 'orders' ||
      table === 'deliveries' ||
      (table === 'ledger_entries' && row['kind'] === 'PAYMENT');
    if (counted) judge.gracedOps.push({ table, id, organizationId: graced });
    return { ok: true, row: clean, graced };
  };
  if (role === null) return accept();
  const ability = abilityOf(judge, role);

  if (listed === 'created' || !stored) {
    if (!holdsAny(ability, rules.create, rules.subject, row)) return NOT_ALLOWED;
    for (const field of rules.author) clean[field] = judge.viewer.personId;
    for (const field of rules.authorIfPresent ?? []) {
      if (field in clean) clean[field] = judge.viewer.personId;
    }
    if (rules.stampOrganization && owner !== 'unresolved') {
      clean['organization_id'] = owner.organizationId;
    }
    return accept();
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
  // A changed `organization_id` was refused above; an equal one is set again from the scope.
  if (rules.stampOrganization) clean['organization_id'] = stored.owner.organizationId;
  return accept();
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
  return allowed
    ? { ok: true, row: {}, organizationId: stored.owner.organizationId ?? undefined }
    : NOT_ALLOWED;
}

/** Remembers the organization of a passed product or variant line, from the judge's own scope. */
function noteCatalogOrganization(judge: Judge, table: JudgedTable, organizationId: unknown): void {
  if ((table === 'products' || table === 'product_variants') && isUuid(organizationId)) {
    judge.catalogOrganizations.add(organizationId);
  }
}

/**
 * Judges every line of one table; returns the lines to hand over, those kept under old rights
 * (SYNC-019, to be handed over with their own viewer) and the forbidden outcomes.
 */
async function judgeTable(judge: Judge, table: JudgedTable, change: TableChange) {
  const passed: TableChange = { table, created: [], updated: [], deleted: [] };
  const graced: TableChange = { table, created: [], updated: [], deleted: [] };
  const forbidden: LineOutcome[] = [];
  const refuseLine = (id: string, verdict: Verdict & { ok: false }) => {
    forbidden.push({ table, id, kind: 'forbidden', code: verdict.code, message: verdict.message });
  };

  for (const listed of ['created', 'updated'] as const) {
    for (const row of change[listed]) {
      const verdict = await judgeRow(judge, table, row, listed);
      if (verdict.ok) {
        (verdict.graced === undefined ? passed : graced)[listed].push(verdict.row);
        noteCatalogOrganization(judge, table, verdict.row['organization_id']);
      }
      else refuseLine(typeof row['id'] === 'string' ? row['id'] : '', verdict);
    }
  }
  for (const id of change.deleted) {
    const verdict = await judgeDeletion(judge, table, id);
    if (verdict.ok) {
      passed.deleted.push(id);
      noteCatalogOrganization(judge, table, verdict.organizationId);
    } else refuseLine(id, verdict);
  }
  return { passed, graced, forbidden };
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

/** A line the server did not store: refused (forbidden) or set aside. */
type Unwritten = { table: string; id: string; code: string };

/** At most this many lines are named in the notification; the count covers them all. */
const NAMED_LINES = 5;

/** Code of a line no rule can write (C-36). */
const NO_RULE = 'NO_RULE';

const REFUSED_WORDS = {
  FR: (n: number, codes: string, lines: string) =>
    `${n} opération(s) non enregistrée(s). Motif : ${codes}. Lignes : ${lines}`,
  EN: (n: number, codes: string, lines: string) =>
    `${n} operation(s) not recorded. Reason: ${codes}. Lines: ${lines}`,
};

const GRACED_WORDS = {
  FR: (n: number) => `${n} opération(s) faites avec d'anciens droits`,
  EN: (n: number) => `${n} operation(s) made with former rights`,
};

/** A person's name before the refusal text the owners read: they must know whose phone it is. */
const OWNER_REFUSED_WORDS = {
  FR: (name: string, text: string) => `${name} : ${text} (après un changement de droits)`,
  EN: (name: string, text: string) => `${name}: ${text} (after a rights change)`,
};

/** The ACTIVE owners of an organization who have an account (one notification each, SYNC-017). */
async function ownersOf(tx: Prisma.TransactionClient, organizationId: string): Promise<string[]> {
  const owners = await tx.collaboration.findMany({
    where: {
      organizationId,
      role: 'OWNER',
      status: 'ACTIVE',
      deletedAt: null,
      person: { registeredAt: { not: null } },
    },
    select: { personId: true },
  });
  return owners.map((owner) => owner.personId);
}

/**
 * The lines of a batch no rule wrote: each is logged at `warn` (table, row id, code, person id;
 * never row content, ASVS v5.0.0-16.3.2) and the author gets one `sync.refused` notification for
 * the batch, in their language, naming `table:code` for the first 5 lines, never amounts or names
 * (CM-28, ASVS v5.0.0-16.3.3). A table name outside the sync tables is shown as `unknown`, so a
 * phone's text never reaches a notification.
 *
 * After a rights change the owners of the organizations the person belongs or belonged to get the
 * same text with the person's name, one notification each: a refused operation is never silent
 * (SYNC-019, CM-29, ASVS v5.0.0-16.3.1).
 */
async function reportUnwritten(
  viewer: Viewer,
  tx: Prisma.TransactionClient,
  lines: Unwritten[],
  tellOwners = false
): Promise<void> {
  if (lines.length === 0) return;
  for (const line of lines) {
    logger.warn(
      {
        event: 'sync_line_refused',
        personId: viewer.personId,
        deviceId: viewer.deviceId,
        table: line.table,
        recordId: line.id,
        code: line.code,
      },
      'pushed line not recorded'
    );
  }
  const known = (name: string): string =>
    (SYNC_TABLES as readonly string[]).includes(name) ? name : 'unknown';
  const codes = [...new Set(lines.map((line) => line.code))].join(', ');
  const named = lines
    .slice(0, NAMED_LINES)
    .map((line) => `${known(line.table)}:${line.code}`)
    .join(', ');
  const language = await recipientLanguage(viewer.personId, tx);
  await notify(
    {
      recipientId: viewer.personId,
      sourceEvent: 'sync.refused',
      content: REFUSED_WORDS[language](lines.length, codes, named),
    },
    tx
  );
  if (!tellOwners) return;
  const person = await tx.person.findUnique({
    where: { id: viewer.personId },
    select: { fullName: true },
  });
  const organizations = new Set([
    ...viewer.memberships.map((m) => m.organizationId),
    ...(viewer.formerMemberships ?? []).map((m) => m.organizationId),
  ]);
  for (const organizationId of [...organizations].sort()) {
    for (const ownerId of await ownersOf(tx, organizationId)) {
      if (ownerId === viewer.personId) continue;
      const ownerLanguage = await recipientLanguage(ownerId, tx);
      await notify(
        {
          recipientId: ownerId,
          organizationId,
          sourceEvent: 'sync.refused',
          content: OWNER_REFUSED_WORDS[ownerLanguage](
            person?.fullName ?? '',
            REFUSED_WORDS[ownerLanguage](lines.length, codes, named)
          ),
        },
        tx
      );
    }
  }
}

/**
 * Tells the owners of each organization how many operations of a stale device were kept under old
 * rights, in one `sync.rights_changed` notification each, and logs it at `warn` with ids only
 * (SYNC-019, CM-29, ASVS v5.0.0-16.3.1). Only operations the server stored count.
 */
async function reportGracedOperations(
  viewer: Viewer,
  tx: Prisma.TransactionClient,
  ops: Judge['gracedOps'],
  outcomes: LineOutcome[]
): Promise<void> {
  const stored = new Set(
    outcomes
      .filter((o) => o.kind === 'accepted' || o.kind === 'issue')
      .map((o) => `${o.table}:${o.id}`)
  );
  const perOrganization = new Map<string, number>();
  for (const op of ops) {
    if (!stored.has(`${op.table}:${op.id}`)) continue;
    perOrganization.set(op.organizationId, (perOrganization.get(op.organizationId) ?? 0) + 1);
  }
  for (const [organizationId, count] of [...perOrganization].sort()) {
    logger.warn(
      {
        event: 'sync_rights_changed_push',
        personId: viewer.personId,
        deviceId: viewer.deviceId,
        organizationId,
        count,
      },
      'operations kept under rights held before a change'
    );
    for (const ownerId of await ownersOf(tx, organizationId)) {
      const language = await recipientLanguage(ownerId, tx);
      await notify(
        {
          recipientId: ownerId,
          organizationId,
          sourceEvent: 'sync.rights_changed',
          content: GRACED_WORDS[language](count),
        },
        tx
      );
    }
  }
}

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
 * (SYNC-016, SYNC-017): they flag old prices, odd dates, operations made after 3 days without
 * sync and deliveries above the credit limit in `sync_issue` and notify the owners (also of a long
 * absence of the device), never refusing anything.
 *
 * A ledger line the phone may not write (any kind but a payment, an update, a delete) is answered
 * `ONLINE_ONLY` before the role check (SYNC-015).
 *
 * Every refused line and every line set aside is logged as `sync_line_refused` and told to the
 * author in one `sync.refused` notification; a refused line makes `resync_required` true
 * (SYNC-018, CM-28). A line set aside alone does not: the phone's copy matches what was kept.
 *
 * First push after a rights change (SYNC-019, CM-29): when the device's `scope_version_seen` is
 * older than the person's `scope_version`, the sales, deliveries and payments of the batch are kept
 * even if the current role (or a revoked membership) no longer allows them, and each organization's
 * owners get one `sync.rights_changed` with the count. Every other line is judged with the current
 * rights, and the owners hear of the refusals as the author does. Nothing else is lent.
 *
 * After the last table, the organizations whose products or variants the batch changed are fitted
 * to their plan: the excess is paused by billing, never refused (SYNC-035, C-46). A batch without
 * catalog line does not call billing.
 *
 * Tables outside the nine judged ones go to their adapter as sent: their adapters own the rules.
 * Rows that name no parent are not scope-checked here, only handed over; the adapter refuses them.
 *
 * @param viewer - Built from the database for this exchange (the batch's author, on a replay).
 * @param batch - Already validated by the push schema.
 * @param options - `beforeApply` runs first and `afterApply` last, inside the transaction; an
 * error either throws rolls the whole batch back.
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
    // A device that missed a rights change keeps its seller operations (SYNC-019, CM-29).
    const stale =
      viewer.scopeVersionSeen !== undefined && viewer.scopeVersionSeen < viewer.scopeVersion;
    const ownCtx = { viewer: stale ? gracedViewer(viewer, 'own') : viewer, tx };
    const saleCtx = { viewer: stale ? gracedViewer(viewer, 'sale') : viewer, tx };
    const judge: Judge = {
      viewer,
      tx,
      abilities: new Map(),
      closings,
      stale,
      gracedOrders: new Set(),
      gracedOps: [],
      catalogOrganizations: new Set(),
    };
    const outcomes: LineOutcome[] = [];
    const unwritten: Unwritten[] = [];
    let aside = 0;
    const redirects = new Map<string, string>();
    const unstoredOrders = new Map<string, LineOutcome>();
    const createdOrderIds: string[] = [];
    const restOrders = findRestOrders(batch.orders && { table: 'orders', ...batch.orders });

    for (const [name, change] of Object.entries(batch)) {
      if (adapters.has(name as SyncTable)) continue;
      // Nothing can write this table: every line is set aside, the rest of the batch passes (C-36).
      const ids = [...change.created, ...change.updated].map((row) => row['id']);
      for (const id of [...ids, ...change.deleted]) {
        unwritten.push({ table: name, id: typeof id === 'string' ? id : '', code: NO_RULE });
      }
    }
    aside += unwritten.length;
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
      // The lines the judge kept under old rights go to the adapters with their own viewer.
      let parts: Array<{ change: TableChange; ctx: PushContext; graced: boolean }> = [
        { change: toApply, ctx: { viewer, tx }, graced: false },
      ];
      if (isJudged(table)) {
        const { passed, graced, forbidden } = await judgeTable(judge, table, toApply);
        outcomes.push(...forbidden);
        parts = [
          { change: passed, ctx: { viewer, tx }, graced: false },
          {
            change: graced,
            ctx: table === 'orders' || table === 'order_lines' ? saleCtx : ownCtx,
            graced: true,
          },
        ];
        for (const part of parts) {
          // An order pushed DELIVERED is closed by the server after every table (SYNC-014).
          if (table === 'orders') {
            for (const row of part.change.created) {
              if (typeof row['id'] === 'string') createdOrderIds.push(row['id']);
            }
            part.change = takeOrders(closings, part.change, part.graced);
          }
          if (closings.size > 0) {
            if (table === 'order_lines') {
              part.change = await takeLines(part.ctx, closings, part.change);
            }
            if (table === 'deliveries') {
              part.change = await takeDeliveries(part.ctx, closings, part.change);
            }
            if (table === 'ledger_entries') part.change = takeLedger(closings, part.change);
          }
        }
        if (restRows.length > 0 && (table === 'orders' || table === 'order_lines')) {
          outcomes.push(...adoptRestRows(closings, restOrders, table, restRows));
        }
      }
      for (const part of parts) {
        if (countRows(part.change) === 0) continue;
        // Only an order created in this batch can be missing for its lines: an edit of a stored
        // order (SYNC-013) that ends as an issue leaves the order and its lines in place.
        const createdIds = new Set(part.change.created.map((row) => row['id']));
        const pushed = await adapter.push(part.ctx, part.change);
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

    for (const line of await runClosings({ viewer, tx }, closings, {
      own: ownCtx,
      sale: saleCtx,
    })) {
      // The closing of an order created in this batch may refine the creation's own outcome.
      const index = outcomes.findIndex((o) => o.table === line.table && o.id === line.id);
      if (index === -1) outcomes.push(line);
      else if (line.kind !== 'accepted') outcomes[index] = line;
    }

    // What the catalog lines added beyond the plan is paused, never refused (SYNC-035, C-46).
    if (judge.catalogOrganizations.size > 0) {
      await enforceCatalogLimits(tx, [...judge.catalogOrganizations], new Date());
    }

    // Controls never refuse: they flag the orders stored by this batch and tell the owners (SYNC-016).
    await runBatchControls(saleCtx, createdOrderIds);
    // A device back after a long absence is told to the owners, before `last_synced_at` moves (SYNC-017).
    if (!options.replay) await runLongAbsence({ viewer, tx });

    const rejected: PushResult['rejected'] = [];
    let accepted = 0;
    for (const outcome of outcomes) {
      if (outcome.kind === 'accepted' || outcome.kind === 'issue') accepted += 1;
      else if (outcome.kind === 'aside') {
        aside += 1;
        unwritten.push({ table: outcome.table, id: outcome.id, code: outcome.code ?? NO_RULE });
      } else {
        const code = outcome.code ?? 'REFUSED';
        rejected.push({
          table: outcome.table,
          id: outcome.id,
          code,
          message: outcome.message ?? 'Line refused',
        });
        unwritten.push({ table: outcome.table, id: outcome.id, code });
      }
    }
    // A refused line means the phone holds something the server did not keep: it pulls again (CM-28).
    await reportUnwritten(viewer, tx, unwritten, stale);
    if (stale) await reportGracedOperations(viewer, tx, judge.gracedOps, outcomes);
    const result = { accepted, rejected, aside, resync_required: rejected.length > 0 };
    await options.afterApply?.(tx, result);
    return result;
  });
}

const REPLAYED_WORDS = {
  FR: (date: string) =>
    `Des opérations envoyées le ${date} depuis votre téléphone ont été réintégrées par l'équipe de la plateforme.`,
  EN: (date: string) =>
    `Operations sent on ${date} from your phone were reintegrated by the platform team.`,
};

/**
 * Tells the batch's author and the OWNERs of every organization the author belongs or belonged to
 * that a super administrator replayed the batch, one `sync.replayed` notification each, in the
 * recipient's language (SYNC-022, CM-32). The text names the date the batch was received and
 * nothing else. Runs in the replay's transaction: no notification outlives a rolled-back replay.
 *
 * @param tx - The replay's transaction.
 * @param authorId - The person who sent the batch.
 * @param receivedAt - When the server archived the batch (UTC date shown).
 */
export async function notifyReplayed(
  tx: Prisma.TransactionClient,
  authorId: string,
  receivedAt: Date
): Promise<void> {
  const date = receivedAt.toISOString().slice(0, 10);
  const memberships = await tx.collaboration.findMany({
    where: { personId: authorId, deletedAt: null },
    select: { organizationId: true },
  });
  const language = await recipientLanguage(authorId, tx);
  await notify(
    {
      recipientId: authorId,
      sourceEvent: 'sync.replayed',
      content: REPLAYED_WORDS[language](date),
    },
    tx
  );
  const organizations = [...new Set(memberships.map((m) => m.organizationId))].sort();
  for (const organizationId of organizations) {
    for (const ownerId of await ownersOf(tx, organizationId)) {
      if (ownerId === authorId) continue;
      const ownerLanguage = await recipientLanguage(ownerId, tx);
      await notify(
        {
          recipientId: ownerId,
          organizationId,
          sourceEvent: 'sync.replayed',
          content: REPLAYED_WORDS[ownerLanguage](date),
        },
        tx
      );
    }
  }
}
