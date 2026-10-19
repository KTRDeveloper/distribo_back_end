---
id: ORD-030
title: The order module says which variants order lines cite
module: order
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [ORD-025]
read_first: [src/modules/order/order.repository.ts]
design_refs: [commandes-et-livraisons/orderline, catalogue/productvariant]
constraints: [C-48]
asvs: [v5.0.0-8.2.2]
---

# ORD-030 — The order module says which variants order lines cite

## Story
Technical story: give the order module one function that tells which variants of a list are cited by an order line, so that the catalog never deletes a variant that the sales history needs.

## Context
- Exists: every line names its variant (ORD-025).
- New in `order.repository.ts`: `listOrderedVariantIds(tx, variantIds)` returns the `Set` of those ids that at least one order line cites, whatever the state of the line or of its order: a deleted line or a cancelled order still counts, because the history must keep its link to the variant (C-48). An empty list answers an empty set without a query.
- One parameterized query. First usage: the catalog delete routes (CAT-026) and the synchronization of a variant deleted on a phone.
- `C-48`: A variant cited by an order line or a negotiated price is never deleted, only taken off sale (`INACTIVE`); a deletion received for a cited variant becomes a withdrawal from sale, and a line received for a deleted variant restores it, off sale.

## Acceptance criteria
```gherkin
Scenario: AC-1 Cited variants
  Given three variants, the first cited by two lines and the second by one line
  When the function runs with the three ids
  Then it returns the first two ids and not the third
Scenario Outline: AC-2 Any state counts
  When a variant is cited only by <case>
  Then it is returned
  Examples:
    | case                    |
    | a deleted line          |
    | a CANCELLED order       |
    | a deleted order         |
Scenario: AC-3 Nothing asked
  When the list is empty
  Then the set is empty and no query is sent
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/order/ordered-variant-ids.test.ts`
- Modify: `src/modules/order/order.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `listOrderedVariantIds(tx: Prisma.TransactionClient, variantIds: string[]): Promise<Set<string>>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: the ids come from server code that has already checked the organization; the function reads no other column.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| cited | integration | AC-1, C-48 | two ids returned |
| any state | integration | AC-2, C-48 | each Examples row → returned |
| empty list | integration | AC-3 | empty set |

Command: `npx vitest run tests/integration/order/ordered-variant-ids.test.ts`

## Out of scope
- Deciding what to do with a cited variant: the catalog stories.
