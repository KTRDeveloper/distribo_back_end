# Contracts: sync

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### SyncEngine (`src/modules/sync/sync.judge.ts`, created by SYNC-010)
- `judgeBatch(viewer: Viewer, batch: PushBatch, options: { replay?: boolean }): Promise<PushResult>`: the only way a batch is applied, from a push or a replay
- `SyncAdapter registry: registerAdapter(adapter: SyncAdapter) with pull(viewer, since) and push(ctx, change) per table`
- Used by: `admin`

## Consumes
- order: transitionOrder, lineAmountOf, orderTotal (docs/stories/modules/order/contracts.md)
- delivery: deliverOrder, deleteUnstartedDeliveries (docs/stories/modules/delivery/contracts.md)
- finance: appendLedgerEntry (docs/stories/modules/finance/contracts.md)
- relationship: visibleRelationsWhere, projectForDriver, mergeDuplicateRelation, resolveMergedRelation (docs/stories/modules/relationship/contracts.md)
- catalog: getReferencePrice (docs/stories/modules/catalog/contracts.md)
- access: abilityFor (docs/stories/modules/access/contracts.md)
- admin: recordAdminAction (docs/stories/modules/admin/contracts.md)
