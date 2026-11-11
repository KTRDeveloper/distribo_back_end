---
id: DLV-019
title: A delivery writes its receipt once, in the transaction that delivers the order
module: delivery
kind: change
rev: 1
amends: [DLV-007, DLV-009]
size: M
risk: high
depends_on: [ORD-040, DLV-007, DLV-009]
read_first: [src/modules/order/order.state.ts, tests/integration/delivery/open-deliveries.test.ts]
design_refs: [a8-le-recu-ne-change-plus-point-9, a8-le-recu-ne-change-plus-point-9/champs-figes-champs-ajoutes-a-order]
constraints: []
asvs: [v5.0.0-2.3.1, v5.0.0-15.3.3]
---

# DLV-019 — A delivery writes its receipt once, in the transaction that delivers the order

## Story
As a supplier, I want each delivery to write its receipt once, from the server's own data, so that every copy of a receipt is the same.

## Context
- `TransitionFields` (order.state.ts) gets `receipt?: ReceiptFields`; `transitionOrder` writes it in the same update that sets DELIVERED, including the sync step from CANCELLED.
- `deliverOrder` (online and `viaSync`) and `sellAtCounter` compute it before `transitionOrder`, in their transaction: `collectedApplied` = the payments of this gesture; `balanceAfterApplied` = the locked balance + total − collected.
- Names, read in the transaction through a new `findReceiptNames`: `supplierNameApplied` = the supplier organization's `name`; `customerNameApplied` = the customer organization's `name`, else the customer person's `full_name`, else null (counter, guest, anonymized). Never `customer_label`.
- A repeat of the same gesture (`findClosedResult`) writes nothing; no route or push body accepts these fields.
- `Order` fields: `supplier_name_applied` string, nullable; `customer_name_applied` string, nullable; `collected_applied` bigint, nullable; `balance_after_applied` bigint, nullable

## Acceptance criteria
```gherkin
Scenario: AC-1 Online delivery
  Given business C, customer of supplier S, with a balance of 40000
  When a driver delivers 30000 and collects 25000
  Then the order has supplier_name_applied S's name, customer_name_applied C's name, collected_applied 25000, balance_after_applied 45000, equal to the balance read afterwards
Scenario Outline: AC-2 The customer's public name
  Given a customer <customer> with customer_label "Mama du marché"
  When the order is delivered
  Then customer_name_applied is <name>
  Examples:
    | customer                         | name       |
    | person with full_name "Awa Kone" | "Awa Kone" |
    | person without full_name         | null       |
Scenario: AC-3 Counter sale
  When a seller validates a counter sale of 12000
  Then customer_name_applied is null, collected_applied 12000 and balance_after_applied the counter's balance
Scenario: AC-4 Delivered through sync
  When a pushed delivery closes a CONFIRMED order, and another closes a CANCELLED one
  Then both orders get the four fields like AC-1
Scenario: AC-5 Written once
  When the same delivery is sent again with the same ids, after S renamed its business
  Then the four fields keep their first values
```

## Abuse cases
```gherkin
Scenario: AB-1 A receipt sent by the phone
  When the deliver body adds collected_applied or supplier_name_applied
  Then the response is 400 VALIDATION_ERROR and nothing is written
```

## Implementation
- Create: `tests/integration/delivery/receipt-fields.test.ts`
- Modify: `src/modules/order/order.state.ts`, `src/modules/order/order.repository.ts`, `src/modules/delivery/delivery.service.ts`, `src/modules/delivery/delivery.repository.ts`
- Pattern: `tests/integration/delivery/open-deliveries.test.ts`
- Signatures:
  - `findReceiptNames(tx: Prisma.TransactionClient, relationshipId: string): Promise<{ supplierName: string; customerName: string | null }>`
- Types:
  - `ReceiptFields = { supplierNameApplied: string; customerNameApplied: string | null; collectedApplied: bigint; balanceAfterApplied: bigint }`
- Errors: `VALIDATION_ERROR` 400
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.1: the receipt is written in the delivering transaction, from server data only.
- v5.0.0-15.3.3: no body accepts the four fields.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| online | integration | AC-1 | four values; balance equals the one read afterwards |
| names | integration | AC-2 | each Examples row; never customer_label |
| counter | integration | AC-3 | null name, collected = total |
| sync | integration | AC-4 | both orders get the fields |
| once | integration | AC-5 | fields unchanged after rename and repeat |
| phone receipt | security | AB-1, WSTG-INPV-20 | 400, nothing written |

Command: `npx vitest run tests/integration/delivery/receipt-fields.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/delivery/deliver.test.ts | the receipt fields are added; no existing field changes | unchanged: passes without edits |
| tests/integration/delivery/counter-sale.test.ts | the receipt fields are added; no existing field changes | unchanged: passes without edits |

## Out of scope
- Orders delivered before this story (ORD-042) and the database rules (ORD-042, ORD-043); sync rows (SYNC-048).
