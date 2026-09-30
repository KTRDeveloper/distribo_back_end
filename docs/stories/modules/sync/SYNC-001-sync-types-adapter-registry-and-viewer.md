---
id: SYNC-001
title: Sync types, adapter registry and viewer
module: sync
kind: technical
rev: 1
amends: []
size: M
risk: medium
depends_on: [ORG-005, AUTH-006, ACC-001]
read_first: [docs/stories/modules/access/contracts.md, src/modules/organization/organization.repository.ts]
design_refs: [synchronisation-hors-ligne/principes-la-synchronisation-classique, synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone]
constraints: []
asvs: [v5.0.0-8.2.2, v5.0.0-8.3.1]
---

# SYNC-001 — Sync types, adapter registry and viewer

## Story
Technical story: define the shapes of a sync exchange, the adapter registry and the viewer, so that every table plugs into pull and push in one way.

## Context
- Exists: `abilityFor` (ACC-001), collaborations (ORG-003), `authMiddleware` giving person and device ids.
- Adds: `src/modules/sync/sync.types.ts` (types below), `src/modules/sync/sync.registry.ts` (`registerAdapter`, `getAdapters`, `getAdapter(table)`) and `src/modules/sync/sync.viewer.ts` (`buildViewer(personId, deviceId)`).
- `Viewer = { personId, deviceId, memberships: Array<{ organizationId, role, status }> (ACTIVE only), scopeVersion, isOnline: false }`. The registry has one adapter per table name; registering the same table twice throws.
- `SyncAdapter = { table: SyncTable; pull(viewer, since: Date | null, tx): Promise<{ created: Row[]; updated: Row[]; deleted: string[] }>; push(ctx: PushContext, change: TableChange): Promise<LineOutcome[]> }`. `SyncTable` is one of `organizations, collaborations, people, customer_relationships, customer_prices, products, orders, order_lines, deliveries, ledger_entries, expenses, handovers, credit_limit_changes, notifications` (Q-014).
- `LineOutcome = { table, id, kind: 'accepted' | 'issue' | 'forbidden' | 'aside'; code?: string; message?: string }`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Viewer
  Given a person who is OWNER of A, SELLER of B, INVITED in C and REVOKED in D
  When buildViewer runs
  Then memberships contain A as OWNER and B as SELLER only, and scopeVersion is the person's current value
Scenario: AC-2 Registry
  When an adapter is registered and looked up by table
  Then it is returned
  And registering the same table again throws
Scenario: AC-3 Unknown table
  Then getAdapter of a name outside the 14 tables throws `httpError(400, 'SYNC_UNKNOWN_TABLE', ...)`
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/modules/sync/sync.types.ts`, `src/modules/sync/sync.registry.ts`, `src/modules/sync/sync.viewer.ts`, `tests/integration/sync/registry-viewer.test.ts`
- Pattern: `src/modules/organization/organization.repository.ts`
- Signatures:
  - `buildViewer(personId: string, deviceId: string): Promise<Viewer>`
  - `registerAdapter(adapter: SyncAdapter): void`
  - `getAdapter(table: string): SyncAdapter`
- Types:
  - `Viewer = { personId: string; deviceId: string; memberships: Array<{ organizationId: string; role: Role }>; scopeVersion: number }`
- Errors: `SYNC_UNKNOWN_TABLE` 400
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: the viewer is built from the database, never from the request.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| viewer | integration | AC-1 | active memberships only |
| registry | unit | AC-2 | lookup and duplicate error |
| unknown table | unit | AC-3 | SYNC_UNKNOWN_TABLE |

Command: `npx vitest run tests/integration/sync/registry-viewer.test.ts`

## Out of scope
- Adapters (SYNC-003 onward).
