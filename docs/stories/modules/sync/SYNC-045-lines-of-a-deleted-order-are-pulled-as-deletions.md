---
id: SYNC-045
title: Lines of a deleted order are pulled as deletions
module: sync
kind: change
rev: 1
amends: [SYNC-006]
size: S
risk: medium
depends_on: [SYNC-006, ORD-039]
read_first: [src/modules/sync/adapters/order.adapter.ts, src/modules/sync/sync.changes.ts]
design_refs: [a1-modifier-remplacer-une-commande-en/le-lien-et-la-suppression-champ-ajoute, a1-modifier-remplacer-une-commande-en/gestes-hors-ligne-arrives-apres-le]
constraints: []
asvs: [v5.0.0-8.2.2]
---

# SYNC-045 — Lines of a deleted order are pulled as deletions

## Story
As a seller, I want the lines of an order the customer replaced to leave my phone, so that I never work on an old version.

## Context
- `orderLinesAdapter.pull` (order.adapter.ts) filters on `orderScope(viewer, false)`: once an order is deleted (replaced, ORD-039), its lines never reach `deleted` and phones keep them.
- With `since`, it also takes the lines of the viewer's orders deleted after `since` (the deleted branch of `orderScope(viewer, true)`); such a line goes to `deleted`, the order's `deleted_at` and `server_updated_at` counting as the line's.
- A first pull (`since` null) still sends only live lines; live lines are pulled as today.

## Acceptance criteria
```gherkin
Scenario: AC-1 The lines follow their deleted order
  Given a phone that pulled order O1 with lines L1 and L2
  When O1 is replaced and the phone pulls again
  Then order_lines.deleted holds L1 and L2, and orders.deleted holds O1
Scenario: AC-2 First pull
  When a phone pulls for the first time after O1 was replaced
  Then neither O1 nor its lines are sent
Scenario: AC-3 Live lines unchanged
  When a line of a live order changes
  Then it is pulled as today, not as a deletion
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's deleted order
  When a member of business B pulls after an order of business A was replaced
  Then no line of that order appears, even in deleted
```

## Implementation
- Create: `tests/integration/sync/pull-deleted-order-lines.test.ts`
- Modify: `src/modules/sync/adapters/order.adapter.ts`
- Pattern: `src/modules/sync/sync.changes.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: deletions are listed only within the viewer's own order scope.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| deleted lines | integration | AC-1 | L1 and L2 in order_lines.deleted, O1 in orders.deleted |
| first pull | integration | AC-2 | nothing of O1 |
| live lines | integration | AC-3 | changed line in updated |
| other business | security | AB-1, WSTG-ATHZ-04 | no line of A's order |

Command: `npx vitest run tests/integration/sync/pull-deleted-order-lines.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/pull-orders.test.ts | only lines of deleted orders are added to deleted | unchanged: passes without edits |

## Out of scope
- Gestures pushed on a replaced version (SYNC-046).
