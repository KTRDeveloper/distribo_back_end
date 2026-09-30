---
id: SYNC-014
title: Push the closing of an order with its sale and payments
module: sync
kind: change
rev: 1
amends: [DLV-007, DLV-008]
size: M
risk: high
depends_on: [SYNC-013, DLV-008]
read_first: [src/modules/delivery/delivery.service.ts, src/modules/sync/adapters/delivery.push.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, commandes-et-livraisons/order/clore-une-commande-commande-livree]
constraints: [CM-27, CM-22]
asvs: [v5.0.0-2.2.1, v5.0.0-2.3.3, v5.0.0-8.2.1]
---

# SYNC-014 — Push the closing of an order with its sale and payments

## Story
As a driver, I want a delivery I closed offline to be recorded with the server's own sale amount so that customers and totals stay exact.

## Context
- Exists: `deliverOrder` (DLV-007, DLV-008); pushed rows of `orders`, `order_lines`, `deliveries`, `ledger_entries`.
- Changes `deliverOrder`: `options` gains `payments: Array<{ id, amount, mode }>` (used instead of the single collected amount when present) and `viaSync: true` now means: the credit rule never refuses (the result carries `creditExceededBy`, a number of francs, 0 when within the limit), an order that is CANCELLED is delivered anyway (delivery wins, `sync_issue` "Livrée après annulation"), and a repeat of an already delivered order by the same person returns the stored result.
- Adds to the sync adapters: when a pushed order row has `status` DELIVERED, the server calls `deliverOrder(viewer, orderId, input, { viaSync: true, payments })` with the viewer's pushed PAYMENT rows for that `order_id` (their ids and modes kept, their amounts summed only by `appendLedgerEntry`), the pushed `delivered_quantity` values as partial lines, and `rest` LATER when a pushed order row has `parent_order_id` = this order (its id is used for the created order) else ABANDON when a line is short. A pushed SALE row is ignored: the sale is written by the server at the order's total; a pushed SALE amount is never used.
- The delivery of the viewer for that order gets `arrived_at`.
- `CM-27`: Sync: computed fields (balance, amount_held, balance_effect, totals, line amounts, sale amount, customer-order reference price, price_updated_at, credit_limit_set_at, ended_by_party, last_synced_at, scope_version, server_updated_at) are ignored on receipt and recomputed.
- `CM-22`: Partial delivery: 'later' creates a CONFIRMED order for the remainder at the original order's prices; 'abandon' closes the order on what was delivered.

## Acceptance criteria
```gherkin
Scenario: AC-1 Delivered offline
  When a DRIVER pushes an order DELIVERED with a SALE of 3000 and a PAYMENT of 30000 for an order totalling 30000
  Then the server writes a SALE of 30000 and a PAYMENT of 30000 and the balance is right
Scenario: AC-2 Partial with rest later
  When lines show 8 of 10 delivered and a child order row with parent_order_id is pushed
  Then the order is DELIVERED on 8, a child CONFIRMED order exists with the pushed id and the original prices
Scenario: AC-3 Abandon
  When a line is short and no child order is pushed
  Then the rest is abandoned and appears in the owner's exceptions
Scenario: AC-4 Delivery wins
  Given the order was cancelled before the delivery arrived
  Then it becomes DELIVERED with sync_issue "Livrée après annulation" and the sale and payment are written
Scenario: AC-5 Credit exceeded is not refused
  When the delivery exceeds the customer's limit because another phone was not up to date
  Then it is recorded and the result carries creditExceededBy above 0
Scenario: AC-6 Repeat
  When the same batch is pushed twice
  Then the sale and payments exist once
```

## Abuse cases
```gherkin
Scenario: AB-1 A forged lower sale (tampering)
  When a phone pushes a SALE of 3000 for an order of 30000
  Then the stored SALE is 30000
Scenario: AB-2 Someone else's delivery (horizontal)
  When a DRIVER pushes DELIVERED for an order that another driver departed with
  Then the delivery is judged by the crossed-departures rule and the sale is written once
```

## Implementation
- Create: `src/modules/sync/adapters/closing.push.ts`, `tests/integration/sync/push-closing.test.ts`
- Modify: `src/modules/delivery/delivery.service.ts`, `src/modules/sync/sync.judge.ts`
- Pattern: `src/modules/delivery/delivery.service.ts`
- Signatures:
  - `deliverOrder(actor: Actor, orderId: string, input: DeliverInput, options?: { viaSync?: boolean; payments?: Array<{ id: string; amount: bigint; mode: 'CASH' | 'MOBILE_MONEY' }> }): Promise<DeliverResult & { creditExceededBy: number }>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.1: the sale amount is always the order total computed on the server.
- v5.0.0-2.3.3: one transaction per closed order.
- v5.0.0-8.2.1: only the viewer's own PAYMENT rows count.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| delivered offline | integration | AC-1, CM-27 | server sale |
| partial later | integration | AC-2, CM-22 | child order |
| abandon | integration | AC-3 | short line |
| delivery wins | integration | AC-4 | DELIVERED with issue |
| credit exceeded | integration | AC-5 | recorded, flagged |
| repeat | integration | AC-6 | once |
| forged sale | security | AB-1, CWE-345 | 30000 |
| other driver | security | AB-2, CWE-362 | one sale |

Command: `npx vitest run tests/integration/sync/push-closing.test.ts tests/integration/delivery/deliver.test.ts`

## Out of scope
- Turning the flags into issues and notifications (SYNC-016, SYNC-017).
