import { httpError } from '../../lib/http-error.js';
import { SYNC_TABLES, type SyncAdapter, type SyncTable } from './sync.types.js';

const adapters = new Map<SyncTable, SyncAdapter>();

function isSyncTable(name: string): name is SyncTable {
  return (SYNC_TABLES as readonly string[]).includes(name);
}

/**
 * Registers the single adapter of a table.
 *
 * @throws Error when the table is outside the 14 sync tables or already has an adapter, so a
 * wiring mistake stops the app at startup instead of silently replacing a table's rules.
 */
export function registerAdapter(adapter: SyncAdapter): void {
  if (!isSyncTable(adapter.table)) {
    throw new Error('Cannot register an adapter for a table outside the sync tables');
  }
  if (adapters.has(adapter.table)) {
    throw new Error(`A sync adapter is already registered for table ${adapter.table}`);
  }
  adapters.set(adapter.table, adapter);
}

/** Every registered adapter, in registration order. */
export function getAdapters(): SyncAdapter[] {
  return [...adapters.values()];
}

/**
 * Looks up the adapter of a table named by a client.
 *
 * @throws HttpError 400 `SYNC_UNKNOWN_TABLE` when the name is not one of the 14 sync tables,
 * or when no adapter is registered for it (fail closed).
 */
export function getAdapter(table: string): SyncAdapter {
  const adapter = isSyncTable(table) ? adapters.get(table) : undefined;
  if (!adapter) {
    throw httpError(400, 'SYNC_UNKNOWN_TABLE', 'Unknown sync table');
  }
  return adapter;
}
