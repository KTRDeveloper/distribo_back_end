---
id: SYNC-012
title: Push orders entered offline
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-011, ORD-013]
read_first: [src/modules/order/order.calculations.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, commandes-et-livraisons/order]
constraints: [CM-27, CM-16]
asvs: [v5.0.0-2.2.1, v5.0.0-2.3.3, v5.0.0-8.2.1]
---

# SYNC-012 — Push orders entered offline

## Story
As a seller, I want orders I entered offline to be stored with correct amounts so that my customers are billed exactly.

## Context
- Exists: judge pipeline; `lineAmountOf`, `orderTotal`; `getActiveProduct`; ORD table rules.
- Adds: `adapters/order.push.ts` registering the push side of `orders` and `order_lines` (create only; status changes are SYNC-013).
- Create (SELLER and above): an order row with `id`, `customer_relationship_id` (redirected if merged), `delivery_address_applied`, `delivery_cost`, `desired_delivery_date`, `customer_note`, `created_at` and its lines (`id`, `product_id`, `quantity`, `reference_price`, `unit_price_applied`). The server sets `placed_by_party` SUPPLIER, `entered_by_id` the viewer, status CONFIRMED, computes `label_applied`, every `amount` and `total_amount`, ignores pushed totals and amounts.
- The phone's `reference_price` (the price it had in front of it) is kept; when `unit_price_applied` differs the line gets `price_set_by_id` the viewer and `price_set_at` = server now.
- A product that is INACTIVE or deleted now is not refused: the order is stored and its `sync_issue` says "Article retiré de la vente depuis la saisie" (code `PRODUCT_RETIRED`). A relationship that is not ACTIVE, or a counter, makes the line an issue that is not stored (`RELATIONSHIP_NOT_ACTIVE`, `USE_COUNTER_SALE`) and `forbidden` never applies to honest phones.
- `CM-27`: Sync: computed fields (balance, amount_held, balance_effect, totals, line amounts, sale amount, customer-order reference price, price_updated_at, credit_limit_set_at, ended_by_party, last_synced_at, scope_version, server_updated_at) are ignored on receipt and recomputed.
- `CM-16`: Customer-placed order: unit_price_applied equals the server-computed reference price at sending; the supplier may only lower it, at acceptance; prices freeze at acceptance (customer order) or at departure or delivery (supplier order).

## Acceptance criteria
```gherkin
Scenario: AC-1 Order stored with server amounts
  When a SELLER pushes an order of 10 units priced 3000 with total_amount 3 and line amount 1
  Then the stored line amount is 30000 and total_amount 30000
Scenario: AC-2 Price gap has an author
  When a line's unit_price_applied is 2800 and reference_price 3000
  Then price_set_by_id is the viewer and price_set_at is set by the server
Scenario: AC-3 Retired article
  When the product became INACTIVE after the entry
  Then the order is stored with sync_issue code PRODUCT_RETIRED
Scenario Outline: AC-4 Not stored
  When the order is on <case>
  Then the line is an issue <code> and nothing is stored
  Examples:
    | case                              | code                 |
    | an ENDED or PENDING relationship  | RELATIONSHIP_NOT_ACTIVE |
    | a counter                         | USE_COUNTER_SALE     |
Scenario: AC-5 Repeat and author
  When the same batch is pushed twice, or entered_by_id names someone else
  Then one order exists and its author is the viewer
```

## Abuse cases
```gherkin
Scenario: AB-1 Phone-chosen amounts (tampering)
  When a phone pushes a lower amount or total for an order
  Then the stored amounts are recomputed by the server
Scenario: AB-2 Someone else's customer (horizontal)
  When the relationship belongs to another organization
  Then the line is forbidden OUT_OF_SCOPE
```

## Implementation
- Create: `src/modules/sync/adapters/order.push.ts`, `tests/integration/sync/push-orders.test.ts`
- Modify: `src/modules/sync/sync.judge.ts`
- Pattern: `src/modules/sync/adapters/relationship.push.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.1: quantities parsed with `parseQuantity`; amounts recomputed.
- v5.0.0-2.3.3: order and lines are one transaction.
- v5.0.0-8.2.1: create needs SELLER or above.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| server amounts | integration | AC-1, CM-27 | 30000 |
| price gap | integration | AC-2, CM-16 | author and time |
| retired article | integration | AC-3 | sync_issue |
| not stored | integration | AC-4 | each Examples row → issue |
| repeat and author | integration | AC-5 | one order |
| client amounts | security | AB-1, CWE-345 | recomputed |
| other organization | security | AB-2, WSTG-ATHZ-04 | forbidden |

Command: `npx vitest run tests/integration/sync/push-orders.test.ts`

## Out of scope
- Controls on price of the moment (SYNC-016). Status changes (SYNC-013).
