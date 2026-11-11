---
id: SYNC-046
title: An offline gesture on a replaced order is settled
module: sync
kind: change
rev: 1
amends: [SYNC-012, SYNC-014]
size: M
risk: high
depends_on: [ORD-039, SYNC-045]
read_first: [src/modules/sync/adapters/closing.push.ts, src/modules/sync/sync.push.ts]
design_refs: [a1-modifier-remplacer-une-commande-en/gestes-hors-ligne-arrives-apres-le]
constraints: [C-58]
asvs: [v5.0.0-2.3.1, v5.0.0-8.2.2]
---

# SYNC-046 — An offline gesture on a replaced order is settled

## Story
As a seller, I want an offline gesture on an order the customer changed meanwhile to be settled clearly, so that a delivery is never lost and nothing else touches the old version.

## Context
- A replaced version has `deleted_at` and `replaced_by_order_id` set (ORD-039). Its current version: follow `replaced_by_order_id` to the first order without `deleted_at`, at most 20 links (`currentVersionOf`, order.push.ts).
- A delivery wins (closing.push.ts): when the closed order is a replaced version in the viewer's scope, set its `deleted_at` back to null (link kept), then deliver it as today (`deliverOrder` with `viaSync`, entries written normally). The current version is not changed.
- Then `setIssue` on both versions: "Livrée alors que le client l'avait modifiée : vérifiez la nouvelle version".
- Any other gesture on a replaced version (orders and order_lines in order.push.ts, deliveries in delivery.push.ts): nothing is written on it; the row is answered as an `issue` with code `ORDER_REPLACED` and message "Changement hors ligne sans effet : le client avait déjà modifié cette commande", and `setIssue` puts that message on the current version.
- The phone receives the deletion at its next pull (SYNC-045).
- `C-58`: `replaced_by_order_id` is unique among set values, never the order's own id, set only on an order placed by the CUSTOMER, and names an order of the same relationship.

## Acceptance criteria
```gherkin
Scenario: AC-1 A delivery of the old version wins
  Given order O1 replaced by O2 while a driver's phone was offline
  When the phone pushes the delivery of O1 with its sale and payment
  Then O1 is DELIVERED, not deleted, still linked to O2, with its sale and payment entries
  And O2 keeps its status and lines, and both carry the delivery issue
Scenario Outline: AC-2 Any other gesture has no effect
  Given order O1 replaced by O2
  When a phone pushes <gesture> on O1
  Then O1 is unchanged, the row is answered ORDER_REPLACED, and O2 carries the no-effect issue
  Examples:
    | gesture            |
    | an acceptance      |
    | a lower line price |
    | a departure        |
    | a refusal          |
    | a supplier note    |
Scenario: AC-3 A chain of replacements
  Given O1 replaced by O2, itself replaced by O3
  When a phone pushes a supplier note on O1
  Then O3 carries the no-effect issue
```

## Abuse cases
```gherkin
Scenario: AB-1 Restoring another business's order
  When a phone of business B pushes the delivery of a replaced version of business A
  Then the row is refused OUT_OF_SCOPE and nothing changes
```

## Implementation
- Create: `tests/integration/sync/replaced-version.test.ts`
- Modify: `src/modules/sync/adapters/closing.push.ts`, `src/modules/sync/adapters/order.push.ts`, `src/modules/sync/adapters/delivery.push.ts`
- Pattern: `src/modules/sync/sync.push.ts`
- Signatures:
  - `isReplacedVersion(tx: Prisma.TransactionClient, orderId: string): Promise<boolean>`
  - `currentVersionOf(tx: Prisma.TransactionClient, orderId: string): Promise<string | null>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.1: only a delivery may change a replaced version; every other gesture is refused on the server.
- v5.0.0-8.2.2: the replaced version must be in the viewer's scope before anything is restored.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| delivery wins | integration | AC-1, C-58 | O1 delivered, restored, linked, entries written; both flagged |
| other gestures | integration | AC-2 | each Examples row → O1 unchanged, ORDER_REPLACED, O2 flagged |
| chain | integration | AC-3 | O3 flagged |
| other business | security | AB-1, WSTG-ATHZ-04 | OUT_OF_SCOPE, nothing changed |

Command: `npx vitest run tests/integration/sync/replaced-version.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/push-orders.test.ts | only gestures on a replaced version change | unchanged: passes without edits |
| tests/integration/sync/push-closing.test.ts | only closings of a replaced version change | unchanged: passes without edits |

## Out of scope
- Pulling the deletion (SYNC-045).
