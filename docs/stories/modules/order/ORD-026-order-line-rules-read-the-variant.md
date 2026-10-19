---
id: ORD-026
title: Order line rules read the variant
module: order
kind: migration
rev: 1
amends: [ORD-005]
size: S
risk: high
depends_on: [ORD-025, CAT-014]
read_first: [prisma/migrations/20261004340000_sync_012_retired_product_lines/migration.sql, prisma/schema.prisma]
design_refs: [commandes-et-livraisons/order, contraintes-a-poser-au-niveau-base-de]
constraints: [C-15]
asvs: [v5.0.0-2.2.3, v5.0.0-8.2.2]
---

# ORD-026 — Order line rules read the variant

## Story
Technical story: make the order line rules read the variant and its product, so that a line is accepted only for an active variant of the supplier.

## Context
- Exists: `order_lines_enforce_rules()` as SYNC-012 left it. It reads `products` by `product_id` and honours the setting `distribo.allow_retired_product`.
- Replace it with `CREATE OR REPLACE`. On insert it takes `coalesce(product_variant_id, product_id)`, reads that variant and its product, and refuses with 23514 when: the variant's `product_id` differs from the line's; the variant's business is not the supplier of the order's relationship; the setting is not 'on' and the variant is not ACTIVE or is deleted, or its product is deleted or paused (`paused_at` set); the order is placed by the CUSTOMER and the quantity is below the variant's `min_order_quantity`.
- Unchanged: an unknown variant is left to the key (23503); on a customer-placed order the applied price equals the reference price on insert and is never raised; the setting skips only the status, deletion and pause checks, never the business or product match.
- Old-style products keep working: their variant mirrors the status and the minimum (CAT-014) and the product's own `deleted_at` is read on the product.
- `prisma/schema.prisma`: update the `//` comment above `OrderLine` in plain words: lines are checked against their variant and its product, and the sync setting still lets a retired variant through.
- `C-15`: Every order line is for an ACTIVE variant of the relationship's supplier, of a product that is not paused; on a customer-placed order the quantity is at least the variant's `min_order_quantity` when sent.
- `C-15`: Every order line is for an ACTIVE variant of the relationship's supplier, of a product that is not paused; on a customer-placed order the quantity is at least the variant's `min_order_quantity` when sent.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Refused lines
  When a line is inserted for <case>
  Then it fails with 23514
  Examples:
    | case                                           |
    | a variant of another business                  |
    | an INACTIVE variant                            |
    | a deleted variant                              |
    | a variant of a deleted product                 |
    | a variant of a paused product                  |
    | a variant that belongs to another product than the line's product_id |
Scenario: AC-2 The minimum is the variant's
  Given a variant with minimum 5
  When a customer-placed order gets a line of 4.999
  Then it fails with 23514
  And a line of 5 is accepted, and so is a line of 1 on an order the supplier placed
Scenario: AC-3 Retired variants through synchronization
  Given the setting is 'on' for the transaction
  When lines are inserted for an INACTIVE variant, a deleted variant and a variant of a paused product
  Then they are accepted
  And a variant of another business is still refused
Scenario: AC-4 Old-style products behave as before
  Given a product written the old way and then set INACTIVE with a direct update
  When a line is inserted for it
  Then it fails with 23514
```

## Abuse cases
```gherkin
Scenario: AB-1 A line borrows another business's variant, with the sync setting on (access control)
  Given the setting is 'on'
  When a line names a variant of a business that is not the order's supplier
  Then it fails with 23514
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_026_line_rules_by_variant/migration.sql`, `tests/integration/order/line-rules-variant.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the rules are checked by the database on every insert, whoever writes.
- v5.0.0-8.2.2: the variant's business must be the order's supplier, even when the retired-variant setting is on.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| refused lines | integration | AC-1, C-15 | each Examples row → 23514 |
| minimum | integration | AC-2, C-15 | 4.999 → 23514; 5 → ok; supplier order with 1 → ok |
| sync setting | integration | AC-3 | setting on → retired accepted, other business refused |
| old style | integration | AC-4 | legacy product set INACTIVE → 23514 |
| other business | security | AB-1, CWE-639 | setting on, variant of another business → 23514 |

Command: `npx vitest run tests/integration/order/line-rules-variant.test.ts tests/integration/order/line-rules.test.ts tests/integration/sync/push-orders.test.ts`

## Out of scope
- Reading the variant in the services (ORD-027).
- Changing the sync setting or the code that sets it (the synchronization stories).
