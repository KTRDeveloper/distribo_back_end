import type { CollaborationRole, Prisma } from '@prisma/client';

/** The 16 tables a phone can pull and push (Q-014). */
export const SYNC_TABLES = [
  'organizations',
  'collaborations',
  'people',
  'customer_relationships',
  'customer_prices',
  'products',
  'product_variants',
  'orders',
  'order_lines',
  'deliveries',
  'ledger_entries',
  'expenses',
  'handovers',
  'credit_limit_changes',
  'notifications',
  'organization_contacts',
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

/** A table row as exchanged with a phone: an explicit, already-shaped field map. */
export type Row = Record<string, unknown>;

/**
 * Who is syncing, rebuilt from the database for every exchange (ASVS v5.0.0-8.2.2).
 * `memberships` holds ACTIVE collaborations only; a sync exchange is never online.
 */
export type Viewer = {
  personId: string;
  deviceId: string;
  memberships: Array<{ organizationId: string; role: CollaborationRole; status: 'ACTIVE' }>;
  scopeVersion: number;
  isOnline: false;
  /**
   * What the device last learned of the person's rights (`Device.scope_version_seen`). Lower than
   * `scopeVersion`, the phone did not know about a rights change and its first push is judged
   * with the grace of SYNC-019 (CM-29). Absent when unknown: no grace.
   */
  scopeVersionSeen?: number;
  /**
   * Organizations where the person's membership was REVOKED, with the role they held. Read only
   * for a device with stale rights: a revoked collaborator's late sales, deliveries and payments
   * are kept (CM-29), never anything else.
   */
  formerMemberships?: Array<{ organizationId: string; role: CollaborationRole }>;
};

/** What a phone sends for one table in a push. */
export type TableChange = {
  table: SyncTable;
  created: Row[];
  updated: Row[];
  deleted: string[];
};

/** Everything an adapter needs to apply a push: the viewer and the surrounding transaction. */
export type PushContext = {
  viewer: Viewer;
  tx: Prisma.TransactionClient;
};

/** The server's verdict on one pushed line. */
export type LineOutcome = {
  table: SyncTable;
  id: string;
  kind: 'accepted' | 'issue' | 'forbidden' | 'aside';
  code?: string;
  message?: string;
  /**
   * Set when the line was a duplicate folded into this relationship id: the judge points the
   * later lines of the batch that name the duplicate's id to it (SYNC-011).
   */
  mergedInto?: string;
};

/** One table's way into pull and push; exactly one adapter per table. */
export type SyncAdapter = {
  table: SyncTable;
  pull(
    viewer: Viewer,
    since: Date | null,
    tx: Prisma.TransactionClient
  ): Promise<{ created: Row[]; updated: Row[]; deleted: string[] }>;
  push(ctx: PushContext, change: TableChange): Promise<LineOutcome[]>;
};
