---
id: ORD-040
title: Orders get the frozen receipt fields
module: order
kind: migration
rev: 1
amends: [ORD-001]
size: XS
risk: high
depends_on: [ORD-034]
read_first: [prisma/schema.prisma, tests/integration/organization/amount-held.test.ts]
design_refs: [a8-le-recu-ne-change-plus-point-9/champs-figes-champs-ajoutes-a-order]
constraints: []
asvs: [v5.0.0-2.2.1]
---

# ORD-040 — Orders get the frozen receipt fields

## Story
Technical story: add the four receipt fields to orders, empty for now, so that the server can write a receipt that never changes.

## Context
- Expand step: four nullable columns with no default and no check yet: `supplier_name_applied` text, `customer_name_applied` text, `collected_applied` bigint, `balance_after_applied` bigint.
- `prisma/schema.prisma`: `supplierNameApplied String?`, `customerNameApplied String?`, `collectedApplied BigInt?`, `balanceAfterApplied BigInt?`, each with its `@map`.
- Writer: DLV-019. Backfill and freeze: ORD-042; the rule tying them to DELIVERED: ORD-043.
- `Order` fields: `supplier_name_applied` string, nullable; `customer_name_applied` string, nullable; `collected_applied` bigint, nullable; `balance_after_applied` bigint, nullable

## Acceptance criteria
```gherkin
Scenario: AC-1 Four empty columns
  When the columns of `orders` are read
  Then the four fields exist and are nullable, two text and two bigint, and every existing order has them empty
Scenario: AC-2 Amounts keep their size
  When `collected_applied` is set to 9007199254740993
  Then it reads back unchanged
```

## Abuse cases
```gherkin
Scenario: AB-1 A text amount
  When a raw insert sets `collected_applied` to '12 500'
  Then PostgreSQL rejects it with 22P02
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_040_receipt_fields/migration.sql`, `tests/integration/order/receipt-columns.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.1: amounts are integers of XAF in `bigint` columns.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| columns | integration | AC-1 | read the columns → four nullable columns, existing rows empty |
| bigint | integration | AC-2 | 9007199254740993 round-trips |
| text amount | security | AB-1, CWE-20 | '12 500' → 22P02 |

Command: `npx vitest run tests/integration/order/receipt-columns.test.ts`

## Out of scope
- Writing, showing or freezing the fields (DLV-019, ORD-041, ORD-042, ORD-043).
