---
id: ORD-015
title: Seller writes a note on an order at any time
module: order
kind: feature
rev: 1
amends: []
size: XS
risk: low
depends_on: [ORD-009]
read_first: [src/modules/order/order.service.ts, src/modules/order/order.routes.ts]
design_refs: [commandes-et-livraisons/order]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]
---

# ORD-015 — Seller writes a note on an order at any time

## Story
As a seller, I want to write a remark on an order, even after delivery, so that the customer sees what is happening.

## Context
- Exists: orders (ORD-009, ORD-013); `supplier_note` is the only field a DELIVERED or CANCELLED order still accepts (ORD-002); rule `update` on Order field `supplier_note` for SELLER (ACC-003).
- Adds: `PATCH /api/v1/organizations/{organizationId}/orders/{orderId}/note` with `{ supplier_note }` (up to 2000 characters, null clears); response 200 `projectOrderForSupplier`. The note is visible to the customer.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Write in any status
  When a SELLER sets the note on an order that is <status>
  Then the response is 200 and the note is stored
  Examples:
    | status      |
    | PENDING     |
    | CONFIRMED   |
    | DELIVERED   |
    | CANCELLED   |
Scenario: AC-2 Clear and limit
  Then null clears the note and 2001 characters answer 400
Scenario: AC-3 Only the note
  When the body has another key
  Then the response is 400 and nothing changes
Scenario: AC-4 Driver refused
  Then a DRIVER answers 403
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's order (horizontal)
  When a member of A writes a note on an order of B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/order/order-note.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.schemas.ts`, `src/modules/order/order.service.ts`, `src/modules/order/order.repository.ts`
- Pattern: `src/modules/order/order.routes.ts`
- Signatures:
  - `setSupplierNote(actor: Actor, orderId: string, note: string | null): Promise<SupplierOrderView>`
- Errors: `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: seller and above.
- v5.0.0-15.3.3: only `supplier_note` is writable.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| any status | integration | AC-1 | each Examples row → 200 |
| clear and limit | integration | AC-2 | null and 2001 |
| only the note | integration | AC-3 | 400 |
| driver | integration | AC-4 | 403 |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/order/order-note.test.ts`

## Out of scope
- Any other change to a finished order.
