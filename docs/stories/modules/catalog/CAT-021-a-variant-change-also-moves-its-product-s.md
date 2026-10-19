---
id: CAT-021
title: A variant change also moves its product's server date
module: catalog
kind: migration
rev: 1
amends: [CAT-012]
size: S
risk: high
depends_on: [CAT-012, CAT-014]
read_first: [prisma/schema.prisma, tests/integration/catalog/product-variant-table.test.ts]
design_refs: [catalogue/product, catalogue/productvariant]
constraints: [CM-42, C-35]
asvs: [v5.0.0-2.3.3]
---

# CAT-021 — A variant change also moves its product's server date

## Story
Technical story: make every insert or update of a variant also move the server date of its product, so that phones always receive a product together with its variants.

## Context
- Exists: `products` and `product_variants`, each with a `server_updated_at` set by the database (CAT-001, CAT-012); the mirror triggers of CAT-014, which copy an old-style product write to the variant of the same id only when one of the five old columns changed.
- One migration, one transaction: a function and a trigger on `product_variants`, after every insert and every update (`deleted_at` included), that sets `products.server_updated_at` to the database time for the variant's `product_id`.
- Why: a phone pulls a table by `server_updated_at`. Without this, a changed variant would reach a customer's phone without its product, and a product put back on sale would not reach it at all (design 3.1).
- No loop: the CAT-014 mirror fires only when an old column changed, and this trigger changes none.
- `prisma/schema.prisma`: the `//` comment above `ProductVariant` gains, in plain words: saving a variant also marks its product as changed so that the phones receive both; a trigger does it, not the code.
- `CM-42`: Every insert or update of a `ProductVariant` also sets `server_updated_at` of its product to the database time, so that a product and its variants always travel together to the phones.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 An insert
  Given a product whose `server_updated_at` is old
  When a variant is inserted for it
  Then the product's `server_updated_at` is the database time
Scenario Outline: AC-2 An update
  When a variant gets <change>
  Then its product's `server_updated_at` moves to the database time
  Examples:
    | change                  |
    | a new price             |
    | status INACTIVE         |
    | a new name              |
    | `deleted_at` set        |
    | a new `image_keys` list |
Scenario: AC-3 Only its own product
  Given two products, each with a variant
  When one variant changes
  Then the other product's `server_updated_at` is unchanged
Scenario: AC-4 No loop
  When the price of an old-style product (non-empty `unit`) is updated
  Then the statement ends, and the product and its variant carry the new price
```

## Abuse cases
```gherkin
Scenario: AB-1 A write that skips the application (tampering)
  When a variant is updated by a raw SQL statement
  Then its product's `server_updated_at` still moves
```

## Implementation
- Create: `prisma/migrations/<timestamp>_cat_021_variant_touches_product/migration.sql`, `tests/integration/catalog/variant-touches-product.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.3.3: the product date moves in the same transaction as the variant write, so both succeed or neither does.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| insert | integration | AC-1, CM-42, C-35 | variant inserted → product date is database time |
| update | integration | AC-2, CM-42 | each Examples row → product date moves |
| own product | integration | AC-3 | other product unchanged |
| no loop | integration | AC-4 | old-style price update ends, both rows carry the price |
| raw write | security | AB-1, CWE-693 | raw SQL update → product date moves |

Command: `npx vitest run tests/integration/catalog/variant-touches-product.test.ts tests/integration/catalog/product-new-columns.test.ts`

## Out of scope
- Pulling products and variants: the synchronization stories.
