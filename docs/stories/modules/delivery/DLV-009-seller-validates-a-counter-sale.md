---
id: DLV-009
title: Seller validates a counter sale
module: delivery
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [DLV-007, ORD-013, REL-011, ORD-009]
read_first: [src/modules/delivery/delivery.service.ts, src/modules/order/order.service.ts]
design_refs: [commandes-et-livraisons/order/autres-regles, relations-commerciales/customerrelationship/comptoirs]
constraints: [C-26, CM-13]
asvs: [v5.0.0-2.2.1, v5.0.0-2.3.3, v5.0.0-8.2.1]
---

# DLV-009 — Seller validates a counter sale

## Story
As a seller, I want one gesture to sell at the counter so that the sale is created, delivered and paid at once.

## Context
- Exists: `enterOrder` line rules (ORD-013), `deliverOrder` core (DLV-007); rule create Order and `deliver` for SELLER (ACC-003); counters (REL-006, REL-011); `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/counters/{relationshipId}/sales` with `{ id, sale_entry_id, payment_entry_id, lines: [{ id, product_id, quantity, unit_price_applied? }], collected_amount, mode }`; response 201 `{ order, sale, payment }`.
- One transaction creates the order (CONFIRMED, placed by SUPPLIER, prices as ORD-013) and delivers it at once (DELIVERED, delivered by the caller, `delivery_address_applied` empty, no delivery row), writing the SALE and the PAYMENT of the same amount. `collected_amount` must equal the order total exactly (409 `COUNTER_PAYMENT_INCOMPLETE` otherwise): a counter has no credit and no arrears.
- The relationship must be a counter of the organization (else 404); the organization ACTIVE.
- `C-26`: A sale on a counter is paid in full: no credit for anonymous customers.
- `CM-13`: The amount of a sale is always Order.total_amount computed by the server on delivered quantities; the amount sent by the phone is ignored.

## Acceptance criteria
```gherkin
Scenario: AC-1 Counter sale
  When a SELLER sells 2 articles for a total of 9000 and collects 9000 in cash
  Then the order is DELIVERED, a SALE and a PAYMENT of 9000 exist and the counter's balance is 0
Scenario Outline: AC-2 Payment must match
  When collected_amount is <collected> for a total of 9000
  Then the response is <status>
  Examples:
    | collected | status                             |
    | 9000      | 201                                |
    | 8999      | 409 COUNTER_PAYMENT_INCOMPLETE     |
    | 9001      | 409 COUNTER_PAYMENT_INCOMPLETE     |
    | 0         | 409 COUNTER_PAYMENT_INCOMPLETE     |
Scenario: AC-3 Not a counter
  When the relationship has a customer
  Then the response is 404 `NOT_FOUND`
Scenario: AC-4 Atomic and repeat
  When any step fails, or the same id is posted twice
  Then nothing is stored, or the second answer equals the first
```

## Abuse cases
```gherkin
Scenario: AB-1 Anonymous credit (business logic)
  When a partial payment is sent on a counter
  Then the response is 409 and no order or entry exists
Scenario: AB-2 Another business's counter (horizontal)
  When a member of A posts to a counter of B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/delivery/counter-sale.test.ts`
- Modify: `src/modules/delivery/delivery.routes.ts`, `src/modules/delivery/delivery.schemas.ts`, `src/modules/delivery/delivery.service.ts`, `src/modules/delivery/delivery.repository.ts`
- Pattern: `src/modules/delivery/delivery.routes.ts`
- Signatures:
  - `sellAtCounter(actor: Actor, relationshipId: string, input: CounterSaleInput): Promise<{ order: SupplierOrderView; sale: LedgerEntryView; payment: LedgerEntryView }>`
- Errors: `COUNTER_PAYMENT_INCOMPLETE` 409, `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-2.2.1: totals and the sale amount are computed on the server.
- v5.0.0-2.3.3: order, delivery state, entries and caches are one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| counter sale | integration | AC-1, CM-13 | order and entries |
| payment match | integration | AC-2, C-26 | each Examples row → status |
| not a counter | integration | AC-3 | 404 |
| atomic and repeat | integration | AC-4, CWE-362 | as described |
| anonymous credit | security | AB-1, WSTG-BUSL-01 | 409, nothing stored |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/delivery/counter-sale.test.ts`

## Out of scope
- Selling to a named customer in the shop: enter the order then deliver it (ORD-013, DLV-007).
