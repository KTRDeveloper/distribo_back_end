---
id: DLV-007
title: '"Commande livrée": deliver a whole order and record the sale and the payment'
module: delivery
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [DLV-005, FIN-004, ACC-003, ACC-007, NTF-002]
read_first: [src/modules/finance/ledger.service.ts, src/modules/order/order.state.ts]
design_refs: [commandes-et-livraisons/order/clore-une-commande-commande-livree, relations-commerciales/customerrelationship/plafond-de-credit-une-seule-regle]
constraints: [CM-13, CM-15]
asvs: [v5.0.0-2.2.1, v5.0.0-2.3.3, v5.0.0-2.3.4, v5.0.0-8.2.1]
---

# DLV-007 — "Commande livrée": deliver a whole order and record the sale and the payment

## Story
As a driver, I want one gesture that closes an order and records what I collected so that the sale and the payment are exact.

## Context
- Exists: `transitionOrder`, `appendLedgerEntry`, `lineAmountOf`, `orderTotal`; rules `deliver` on Order and create LedgerEntry SALE or PAYMENT (ACC-003, ACC-004); `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/orders/{orderId}/deliver` with `{ id, collected_amount, mode?, sale_entry_id, payment_entry_id? }`; response 200 `{ order, sale, payment }`.
- One transaction with the relationship row locked: a DRIVER needs the order IN_DELIVERY with a delivery of theirs (which gets `arrived_at`); a SELLER or above may deliver a CONFIRMED order in the shop. Every line gets `delivered_quantity` = `quantity`; amounts and total are recomputed by the server; the order becomes DELIVERED with `delivered_at` now and `delivered_by_id` the caller.
- A SALE entry of `Order.total_amount` (the client never sends it) and, when `collected_amount` is above 0, a PAYMENT entry of `collected_amount` (arrears allowed) with `mode`; both carry `order_id` and the caller as recorder. The customer is notified `order.status_changed`.
- Credit rule: `balance + total − collected` must not exceed `credit_limit` (null means no limit); otherwise 409 `CREDIT_INSUFFICIENT` with `details.min_collect` = the smallest allowed collection, and nothing is written.
- `CM-13`: The amount of a sale is always Order.total_amount computed by the server on delivered quantities; the amount sent by the phone is ignored.
- `CM-15`: At delivery, the unpaid part must not bring the balance above credit_limit (null limit = no limit); example: limit 50 000, balance 40 000, order 30 000 requires collecting at least 20 000.

## Acceptance criteria
```gherkin
Scenario: AC-1 Delivered and paid in full
  Given an IN_DELIVERY order of 30000 and a customer with balance 0
  When the assigned driver delivers with collected_amount 30000 in cash
  Then the order is DELIVERED, a SALE of 30000 and a PAYMENT of 30000 exist with the order id, and the balance is 0
Scenario Outline: AC-2 Credit rule
  Given limit 50000 and balance 40000 and an order of 30000
  When collected_amount is <collected>
  Then the response is <status>
  Examples:
    | collected | status                                         |
    | 20000     | 200 (SALE 30000, PAYMENT 20000, balance 50000) |
    | 19999     | 409 CREDIT_INSUFFICIENT with min_collect 20000 |
    | 0         | 409 CREDIT_INSUFFICIENT with min_collect 20000 |
    | 30000     | 200                                            |
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is written
  Examples:
    | problem                                    | status                 |
    | a DRIVER on an order of another driver     | 404 NOT_FOUND          |
    | a DRIVER on a CONFIRMED order              | 409 INVALID_TRANSITION |
    | a DELIVERED or CANCELLED order             | 409 INVALID_TRANSITION |
    | collected_amount above 0 without a mode    | 400 VALIDATION_ERROR   |
```

## Abuse cases
```gherkin
Scenario: AB-1 A lower sale than the order (tampering)
  When a phone sends a sale amount of 3000 for an order of 30000
  Then the SALE is 30000 or the request is refused
Scenario: AB-2 Driver refunds through this route (elevation)
  When a DRIVER sends a kind or a negative amount
  Then the response is 400
Scenario: AB-3 Credit exceeded by a race (tampering)
  When two deliveries for one customer run at once with a total above the limit
  Then the second is refused because the relationship row is locked
```

## Implementation
- Create: `tests/integration/delivery/deliver.test.ts`
- Modify: `src/modules/delivery/delivery.routes.ts`, `src/modules/delivery/delivery.schemas.ts`, `src/modules/delivery/delivery.service.ts`, `src/modules/delivery/delivery.repository.ts`
- Pattern: `src/modules/delivery/delivery.routes.ts`
- Signatures:
  - `deliverOrder(actor: Actor, orderId: string, input: DeliverInput, options?: { viaSync?: boolean }): Promise<DeliverResult>`
- Types:
  - `DeliverInput = { id: string; collected_amount: number; mode?: 'CASH' | 'MOBILE_MONEY'; sale_entry_id: string; payment_entry_id?: string }`
- Errors: `CREDIT_INSUFFICIENT` 409, `INVALID_TRANSITION` 409, `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-2.2.1: the sale amount is taken from the order on the server.
- v5.0.0-2.3.3: order, lines, entries, caches and delivery are one transaction.
- v5.0.0-2.3.4: the relationship row is locked before the credit check.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| paid in full | integration | AC-1, CM-13 | statuses and entries |
| credit rule | integration | AC-2, CM-15 | each Examples row → status and min_collect |
| refusals | integration | AC-3 | each Examples row → status |
| lower sale | security | AB-1, WSTG-BUSL-02, CWE-345 | SALE 30000 |
| driver refund | security | AB-2, WSTG-ATHZ-03 | 400 |
| race | security | AB-3, WSTG-BUSL-04, CWE-362 | second refused |

Command: `npx vitest run tests/integration/delivery/deliver.test.ts`

## Out of scope
- Partial deliveries (DLV-008). Counter sales (DLV-009).
