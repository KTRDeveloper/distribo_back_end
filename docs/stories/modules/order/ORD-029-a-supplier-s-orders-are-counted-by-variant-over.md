---
id: ORD-029
title: A supplier's orders are counted by variant over a period
module: order
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [ORD-025]
read_first: [src/modules/order/order.repository.ts]
design_refs: [commandes-et-livraisons/orderline]
constraints: []
asvs: [v5.0.0-8.2.2]
---

# ORD-029 — A supplier's orders are counted by variant over a period

## Story
Technical story: give the order module one function that counts the lines ordered from a supplier per variant since a date, so that billing can keep the most ordered products when a plan runs out.

## Context
- Exists: every line names its variant (ORD-025); an order reaches its supplier through its relationship (`customerRelationship.supplierOrganizationId`).
- New in `order.repository.ts`: `countOrderedLinesByVariant(tx, supplierOrganizationId, since)` returns a `Map` from variant id to a count. It counts the not deleted lines of the not deleted orders of that supplier created at or after `since`, leaving out the orders with status CANCELLED. A variant with no line is absent.
- One parameterized query grouped in SQL. First usage: billing (BIL-020), which ships after this story.

## Acceptance criteria
```gherkin
Scenario: AC-1 Counting
  Given a supplier with 3 lines of one variant in two orders and 1 line of another variant, all created in the last 90 days
  When the function runs with `since` 90 days ago
  Then the first variant counts 3, the second 1, and a third variant with no line is absent
Scenario Outline: AC-2 What is left out
  When the function runs and the supplier has <case>
  Then <result>
  Examples:
    | case                                  | result                              |
    | a line of an order created before `since` | it is not counted                |
    | a line of a CANCELLED order           | it is not counted                   |
    | a deleted line                        | it is not counted                   |
    | a line of a deleted order             | it is not counted                   |
    | a line of another supplier's order    | it is not counted                   |
Scenario: AC-3 Nothing ordered
  When the supplier has no order
  Then the map is empty
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/order/demand-by-variant.test.ts`
- Modify: `src/modules/order/order.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `countOrderedLinesByVariant(tx: Prisma.TransactionClient, supplierOrganizationId: string, since: Date): Promise<Map<string, number>>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: the supplier id comes from server code, and orders of another supplier never enter the count.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| counting | integration | AC-1 | counts per variant |
| left out | integration | AC-2 | each Examples row → not counted |
| empty | integration | AC-3 | empty map |

Command: `npx vitest run tests/integration/order/demand-by-variant.test.ts`

## Out of scope
- Choosing which products stay on a plan: billing (BIL-020).
