---
id: SYNC-044
title: The contested mark is a server field in synchronization
module: sync
kind: change
rev: 1
amends: [SYNC-010]
size: XS
risk: medium
depends_on: [REL-027]
read_first: [src/modules/sync/sync.judge.ts, src/modules/sync/adapters/relationship.adapter.ts]
design_refs: [annexe-la-table-des-regles/qui-et-ou]
constraints: [CM-27, C-57]
asvs: [v5.0.0-15.3.3]
---

# SYNC-044 — The contested mark is a server field in synchronization

## Story
As a supplier, I want my phone to receive the contested mark but never send it so that only the customer's online gesture sets it.

## Context
- Exists: `COMPUTED_EVERYWHERE` in `sync.judge.ts` strips server fields from pushed rows (SYNC-010); `relationship.adapter.ts` builds the pulled relationship rows.
- Change: add `contested_at` to `COMPUTED_EVERYWHERE`, and to both pulled relationship rows of the adapter (supplier side and customer side), as an ISO timestamp or null.
- `CM-27`: Sync: computed fields (balance, amount_held, balance_effect, totals, line amounts, sale amount, customer-order reference price, price_updated_at, credit_limit_set_at, ended_by_party, contested_at, last_synced_at, scope_version, server_updated_at) are ignored on receipt and recomputed.
- `C-57`: `contested_at` is set and cleared by the customer alone, through an online route; a supplier correction clears it and must target another number; it is always empty for a counter.
- `CM-27`: Sync: computed fields (balance, amount_held, balance_effect, totals, line amounts, sale amount, customer-order reference price, price_updated_at, credit_limit_set_at, ended_by_party, contested_at, last_synced_at, scope_version, server_updated_at) are ignored on receipt and recomputed (design lines 862, annex A.1)
- `C-57`: `contested_at` is set and cleared by the customer alone, through an online route; a supplier correction clears it and must target another number; it is always empty for a counter.

## Acceptance criteria
```gherkin
Scenario: AC-1 Pushed value ignored
  When a phone pushes a relationship row holding `contested_at`
  Then the stored `contested_at` is unchanged
Scenario: AC-2 Pulled value
  Given a contested relationship
  When the supplier and the customer pull
  Then both rows carry `contested_at` set
```

## Abuse cases
```gherkin
Scenario: AB-1 Clearing a contestation offline (tampering)
  When the supplier pushes the row with `contested_at` null
  Then the mark stays set
```

## Implementation
- Modify: `src/modules/sync/sync.judge.ts`, `src/modules/sync/adapters/relationship.adapter.ts`, `tests/integration/sync/judge.test.ts`
- Pattern: `tests/integration/sync/registry-viewer.test.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-15.3.3: the field joins the server-only list, so no push can write it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| push ignored | integration | AC-1, CM-27 | push with contested_at → stored value unchanged |
| pull | integration | AC-2, C-57 | both parties pull → field present |
| offline clear | security | AB-1, CWE-915 | push null → mark kept |

Command: `npx vitest run tests/integration/sync/judge.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/judge.test.ts | the server-field list (SYNC-010) gains `contested_at` | a pushed `contested_at` is stripped like `ended_by_party` |

## Out of scope
- The online gestures that write the mark: REL-028, REL-029, REL-031.
