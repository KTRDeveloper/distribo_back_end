---
id: ORD-036
title: An order records delivery or pickup
module: order
kind: migration
rev: 1
amends: [ORD-001]
size: XS
risk: high
depends_on: [ORD-034]
read_first: [prisma/schema.prisma, tests/integration/organization/amount-held.test.ts]
design_refs: [a4-livraison-ou-retrait-reception-mode/champ-ajoute-a-order, a4-livraison-ou-retrait-reception-mode/contraintes-de-base-de-donnees-complete]
constraints: [C-60, 'Order.reception_mode:enum']
asvs: [v5.0.0-2.2.1]
---

# ORD-036 — An order records delivery or pickup

## Story
Technical story: add `reception_mode` to orders, so that an order says whether it is delivered or picked up.

## Context
- Additive migration: enum type `ReceptionMode` (DELIVERY, PICKUP) and a nullable column `reception_mode`. Existing orders stay empty (not stated): no backfill from the address.
- A CHECK: when `reception_mode` is PICKUP, `delivery_address_applied` is empty.
- `prisma/schema.prisma`: the enum and `receptionMode ReceptionMode? @map("reception_mode")` on `Order`; add the rule to the `//` comment above `Order` in plain words, with this migration's name.
- No code writes the field yet (ORD-037).
- `Order` fields: `reception_mode` enum [DELIVERY / PICKUP], nullable
- `C-60`: A `PICKUP` order has no delivery address.
- `Order.reception_mode:enum`: one of DELIVERY, PICKUP

## Acceptance criteria
```gherkin
Scenario: AC-1 The column exists and stays empty
  When the columns of `orders` are read
  Then `reception_mode` is nullable with values DELIVERY and PICKUP, and every existing order has it empty
Scenario Outline: AC-2 A pickup has no address
  When an order is saved with mode <mode> and address <address>
  Then the database <result>
  Examples:
    | mode     | address        | result          |
    | PICKUP   | empty          | accepts         |
    | PICKUP   | "Rue 12, Akwa" | rejects (23514) |
    | DELIVERY | "Rue 12, Akwa" | accepts         |
    | DELIVERY | empty          | accepts         |
    | empty    | "Rue 12, Akwa" | accepts         |
```

## Abuse cases
```gherkin
Scenario: AB-1 A pickup that keeps its address (bypass)
  Given an order with address "Rue 12, Akwa"
  When a raw update sets `reception_mode` to PICKUP without clearing the address
  Then the database rejects it with 23514 and the order is unchanged
Scenario: AB-2 An unknown mode
  When a raw insert sets `reception_mode` to 'SHIP'
  Then PostgreSQL rejects it with 22P02
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_036_reception_mode/migration.sql`, `tests/integration/order/reception-mode-column.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.1: the database keeps a pickup without an address, even when the code is bypassed.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| column | integration | AC-1 | read the column → nullable enum, existing rows empty |
| pickup rule | integration | AC-2, C-60 | each Examples row → accepted or 23514 |
| bypass | security | AB-1, CWE-20 | raw update to PICKUP keeping the address → 23514 |
| unknown mode | security | AB-2, Order.reception_mode:enum, CWE-20 | 'SHIP' → 22P02 |

Command: `npx vitest run tests/integration/order/reception-mode-column.test.ts`

## Out of scope
- Reading or writing the field through the API (ORD-037).
