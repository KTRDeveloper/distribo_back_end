import { withPullSnapshot } from './sync.repository.js';
import { getAdapters } from './sync.registry.js';
import type { TableChange, Viewer } from './sync.types.js';

export type TableChanges = Pick<TableChange, 'created' | 'updated' | 'deleted'>;

/**
 * Collects what changed for the viewer since the phone's last pull, from every registered adapter.
 *
 * The returned `timestamp` is read before the queries: a row written while they run is sent again
 * by the next pull instead of being missed. Each adapter starts from the viewer's memberships
 * (ASVS v5.0.0-8.2.2), so nothing outside the viewer's scope is returned.
 *
 * @param viewer - Built from the database for this exchange, never from the request.
 * @param lastPulledAt - Epoch milliseconds of the previous pull, or null for a first pull.
 */
export async function pullChanges(
  viewer: Viewer,
  lastPulledAt: number | null
): Promise<{ changes: Record<string, TableChanges>; timestamp: number }> {
  const timestamp = Date.now();
  const since = lastPulledAt === null ? null : new Date(lastPulledAt);

  const changes = await withPullSnapshot(async (tx) => {
    const byTable: Record<string, TableChanges> = {};
    for (const adapter of getAdapters()) {
      byTable[adapter.table] = await adapter.pull(viewer, since, tx);
    }
    return byTable;
  });

  return { changes, timestamp };
}
