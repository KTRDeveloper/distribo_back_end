---
id: ORD-035
title: An order records the version that replaced it
module: order
kind: migration
rev: 1
amends: [ORD-001]
size: S
risk: high
depends_on: [ORD-034]
read_first: [prisma/schema.prisma, tests/integration/organization/amount-held.test.ts]
design_refs: [a1-modifier-remplacer-une-commande-en/le-lien-et-la-suppression-champ-ajoute, a1-modifier-remplacer-une-commande-en/contraintes-de-base-de-donnees-complete]
constraints: [C-58]
asvs: [v5.0.0-2.2.1]
---

# ORD-035 — An order records the version that replaced it

## Story
Technical story: add `replaced_by_order_id` to orders, so that a version the customer changed points at the version that replaced it.

## Context
- Additive migration: a nullable `uuid` column, a foreign key to `orders(id)` with the same delete rule as `parent_order_id`, and a unique index on the set values only.
- Two CHECKs: the link differs from the order's own `id`; a set link requires `placed_by_party` CUSTOMER.
- A trigger before insert or update of the link: when set, the linked order must have the same `customer_relationship_id`, else it raises SQLSTATE 23514.
- `prisma/schema.prisma`: `Order` gets `replacedByOrderId` and a self-relation whose back relation is a list (the index is partial, so no `@unique`). Add the four rules to the `//` comment above `Order` in plain words, with this migration's name.
- No code writes the link yet (ORD-039).
- `Order` fields: `replaced_by_order_id` FK → Order, nullable
- `C-58`: `replaced_by_order_id` is unique among set values, never the order's own id, set only on an order placed by the CUSTOMER, and names an order of the same relationship.

## Acceptance criteria
```gherkin
Scenario: AC-1 The column exists and stays empty
  When the columns of `orders` are read
  Then `replaced_by_order_id` is a nullable uuid and every existing order has it empty
Scenario Outline: AC-2 The database guards the link
  Given an order placed by the CUSTOMER on relationship R
  When its `replaced_by_order_id` is set to <target>
  Then the database <result>
  Examples:
    | target                                       | result          |
    | another order of R                           | accepts         |
    | its own id                                   | rejects (23514) |
    | an order another order of R already links to | rejects (23505) |
    | an unknown id                                | rejects (23503) |
Scenario: AC-3 Only customer orders carry a link
  When the link is set on an order placed by the SUPPLIER, to another order of its relationship
  Then the database rejects it with 23514
```

## Abuse cases
```gherkin
Scenario: AB-1 A link to another customer's order (horizontal)
  When a raw update links an order of relationship R to an order of relationship S
  Then the database rejects it with 23514 and the link stays empty
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_035_replaced_by_order_id/migration.sql`, `tests/integration/order/order-replaced-by-column.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.1: the database refuses a link that leaves the relationship, even when the code is bypassed.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| column | integration | AC-1 | read the column → nullable uuid, existing rows empty |
| link rules | integration | AC-2, C-58 | each Examples row → accepted, 23514, 23505 or 23503 |
| supplier order | integration | AC-3, C-58 | link on a SUPPLIER-placed order → 23514 |
| other relationship | security | AB-1, CWE-639 | link to an order of relationship S → 23514 |

Command: `npx vitest run tests/integration/order/order-replaced-by-column.test.ts`

## Out of scope
- Writing the link (ORD-039).
