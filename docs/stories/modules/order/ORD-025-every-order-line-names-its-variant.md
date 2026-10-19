---
id: ORD-025
title: Every order line names its variant
module: order
kind: migration
rev: 1
amends: [ORD-004, ORD-024]
size: S
risk: high
depends_on: [ORD-024]
read_first: [prisma/schema.prisma, prisma/migrations/20261004300000_ord_004_order_lines/migration.sql]
design_refs: [commandes-et-livraisons/orderline, contraintes-a-poser-au-niveau-base-de]
constraints: ['OrderLine:required', C-35]
asvs: [v5.0.0-2.2.3]
---

# ORD-025 — Every order line names its variant

## Story
Technical story: fill the variant of the lines saved before ORD-024 and make it required, so that every line names the variant that was sold.

## Context
- Exists: `order_lines.product_variant_id`, empty allowed, filled on insert from `product_id` (ORD-024). Lines saved earlier have it empty.
- One migration, in this order. Between `-- audit start` and `-- audit end`: a block that stops the migration when a line without a variant has no variant of its `product_id`; its message lists line ids only. There is no source for another value, so none is invented (CAT-013 gave every product a variant of its id, so none is expected).
- Between `-- copy start` and `-- copy end`: `UPDATE order_lines SET product_variant_id = product_id WHERE product_variant_id IS NULL`. It moves `server_updated_at`, so phones fetch the lines again; a second run changes nothing.
- Then `product_variant_id SET NOT NULL`.
- `prisma/schema.prisma`: the field becomes `productVariantId String @default(dbgenerated()) @map("product_variant_id") @db.Uuid` and its relation required. Reads are never empty and a create may leave it out because the trigger fills it. Update the `//` comment above `OrderLine` in plain words.
- `OrderLine:required`: NOT NULL: `order_id`, `product_id`, `label_applied`, `quantity`, `reference_price`, `unit_price_applied`, `amount`
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Existing lines are filled
  Given a line whose variant is empty
  When the copy block runs
  Then its variant equals its `product_id` and its `server_updated_at` moves forward
  And a second run changes nothing
Scenario: AC-2 The column is required
  When a line is updated to an empty variant
  Then it fails with 23502
  And a line inserted without a variant gets one from its product
```

## Abuse cases
```gherkin
Scenario: AB-1 A line the migration cannot explain gets a guessed variant (tampering)
  Given a line with no variant and no variant of its `product_id`
  When the audit block runs
  Then it fails with a message that lists the line id and no label, name or amount
  And no line receives a variant
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_025_order_line_variant_required/migration.sql`, `tests/integration/order/order-line-variant-required.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the audit stops on data it cannot explain instead of inventing a variant.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| copy | integration | AC-1, C-35 | replay the marked block on a line with an empty variant, twice → filled once, date moved once |
| audit | security | AB-1, CWE-20 | replay the audit block in a rolled-back transaction → ids only in the message, nothing filled |
| required | integration | AC-2, OrderLine:required | update to null → 23502; insert without it → filled |

Command: `npx vitest run tests/integration/order/order-line-variant-required.test.ts`

## Out of scope
- Removing `product_id` (the contract story, after every writer uses variants).
