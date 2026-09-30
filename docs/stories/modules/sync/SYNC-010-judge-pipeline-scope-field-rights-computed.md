---
id: SYNC-010
title: 'Judge pipeline: scope, field rights, computed fields'
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-009, ACC-002]
read_first: [src/modules/sync/sync.push.ts, src/shared/access/ability.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, annexe-la-table-des-regles/qui-et-ou]
constraints: [CM-27, CM-28]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-8.2.3, v5.0.0-15.3.3]
---

# SYNC-010 — Judge pipeline: scope, field rights, computed fields

## Story
As an owner, I want the server to judge each line a phone sends so that nobody writes outside their scope or their fields.

## Context
- Exists: `pushChanges` (SYNC-009), `abilityFor` with the ACC rules, `Viewer` (SYNC-001).
- Adds: `src/modules/sync/sync.judge.ts` with `judgeBatch(viewer, batch, options)` and the helpers `checkScope`, `checkFields`, `stripComputed`. Tables are processed in this order: `customer_relationships`, `orders`, `order_lines`, `deliveries`, `ledger_entries`, `notifications`; each has an adapter `push` (SYNC-011 onward).
- Scope: a pushed row must belong to an organization the viewer is an ACTIVE member of (or, for a customer person, to their own relationships); anything else is `forbidden` with code `OUT_OF_SCOPE`.
- Field rights: the abilities are built with context `{ onServer: true, online: false, daysSinceSync: 0 }` and each changed field is checked with `can(action, subject, field)`; a field the role may not write makes the line `forbidden` with code `FIELD_NOT_ALLOWED`.
- Computed fields (`balance`, `amount_held`, `balance_effect`, `total_amount`, line `amount`, sale amount, `price_updated_at`, `credit_limit_set_at`, `ended_by_party`, `last_synced_at`, `scope_version`, `server_updated_at`) are removed from the row before the adapter sees it, and the server recomputes them. The author of a create is always the viewer.
- `CM-27`: Sync: computed fields (balance, amount_held, balance_effect, totals, line amounts, sale amount, customer-order reference price, price_updated_at, credit_limit_set_at, ended_by_party, last_synced_at, scope_version, server_updated_at) are ignored on receipt and recomputed.
- `CM-28`: Sync outcomes: a business problem is stored with sync_issue; a conflict is refused until the phone pulls and resends; a forbidden send is refused, recorded, and triggers a full resync plus a notification to its author; a line no rule can write is set aside while the rest passes.

## Acceptance criteria
```gherkin
Scenario: AC-1 Scope
  When a SELLER of A pushes an order of organization B
  Then the line is forbidden with OUT_OF_SCOPE and nothing of B changes
Scenario: AC-2 Fields
  When a SELLER pushes a relationship with a new credit_limit
  Then the line is forbidden with FIELD_NOT_ALLOWED and the limit is unchanged
Scenario: AC-3 Computed fields ignored
  When a pushed relationship carries balance 999999 and server_updated_at in the past
  Then those values are ignored and the server's values stand
Scenario: AC-4 Author from the session
  When a pushed order names another person as entered_by_id
  Then the stored author is the viewer
Scenario: AC-5 Order of tables
  Then relationships are judged before orders, orders before lines, lines before deliveries and ledger entries
Scenario: AC-6 Honest lines pass
  When a line is in scope and uses allowed fields
  Then it is handed to its adapter
```

## Abuse cases
```gherkin
Scenario: AB-1 Writing in another business by knowing an id (horizontal)
  When a phone pushes an update of a row id belonging to another organization
  Then the line is forbidden and the row is unchanged
Scenario: AB-2 Writing a field the role may not (elevation)
  When a DRIVER pushes a change to unit_price_applied
  Then the line is forbidden
```

## Implementation
- Create: `src/modules/sync/sync.judge.ts`, `tests/integration/sync/judge.test.ts`
- Modify: `src/modules/sync/sync.push.ts`
- Pattern: `src/modules/sync/sync.push.ts`
- Signatures:
  - `judgeBatch(viewer: Viewer, batch: PushBatch, options?: { replay?: boolean }): Promise<PushResult>`
  - `stripComputed(table: SyncTable, row: Row): Row`
- Dependencies: `@casl/ability`, `@prisma/client`

## Security
- v5.0.0-8.2.2: object-level scope on every pushed row.
- v5.0.0-8.2.3: field-level check through the rules table.
- v5.0.0-15.3.3: computed and author fields are never taken from the phone.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| scope | integration | AC-1 | OUT_OF_SCOPE |
| fields | integration | AC-2 | FIELD_NOT_ALLOWED |
| computed ignored | integration | AC-3, CM-27 | server values |
| author | integration | AC-4 | viewer |
| table order | unit | AC-5 | order list |
| honest lines | integration | AC-6, CM-28 | adapter called |
| foreign id | security | AB-1, WSTG-ATHZ-04, CWE-639 | forbidden |
| forbidden field | security | AB-2, WSTG-ATHZ-03, CWE-915 | forbidden |

Command: `npx vitest run tests/integration/sync/judge.test.ts`

## Out of scope
- The table adapters (SYNC-011 onward).
