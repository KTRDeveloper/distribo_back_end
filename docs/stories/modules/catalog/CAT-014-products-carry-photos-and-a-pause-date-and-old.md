---
id: CAT-014
title: Products carry photos and a pause date, and old-style writes reach the variants
module: catalog
kind: migration
rev: 1
amends: [CAT-001]
size: M
risk: high
depends_on: [CAT-013]
read_first: [prisma/schema.prisma, tests/integration/organization/organization-table.test.ts]
design_refs: [catalogue/product, contraintes-a-poser-au-niveau-base-de]
constraints: ['Product:required', C-46, C-49, C-35]
asvs: [v5.0.0-2.2.1]
---

# CAT-014 — Products carry photos and a pause date, and old-style writes reach the variants

## Story
Technical story: give products their photos and pause date, and keep old-style writes reaching the variants, so that nothing breaks while the code moves to variants.

## Context
- Exists: `products` with the old columns `unit`, `price`, `min_order_quantity`, `status` (CAT-001), and a variant per product (CAT-012, CAT-013). Old code and tests still write those columns.
- One migration, one transaction: on `products`, `image_keys` (text[], empty by default, at most 5 keys, GIN index) and `paused_at` (timestamptz, empty by default; only the server writes it, C-46).
- Between `-- touch start` and `-- touch end`: one statement moving every product's `server_updated_at` to the migration time, so phones fetch it again.
- `unit` gets the default empty text and `price` the default 1, so a row written the new way needs neither. An empty `unit` marks it new-style: its old columns are never read.
- Two triggers, dropped with the old columns. After an insert or an update with a non-empty `unit`, the variant of the same id is inserted (empty name, old columns copied) or updated (the five old columns, only when one changed). An empty `unit` is never copied: the code inserts its variants itself.
- `prisma/schema.prisma`: `imageKeys`, `pausedAt`, the two defaults and the GIN index on `Product`, and above it a plain-words `//` comment: old columns ignored, empty `unit` means new-style, the triggers copy old-style writes to the variant of the same id until the story that drops them.
- `Product` fields: `image_keys` string[]; `paused_at` datetime, nullable
- `Product:required`: NOT NULL: `organization_id`, `name`, `unit`, `price`, `price_updated_at`, `status`, `created_at`
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 New-style row
  When a product is inserted with a business and a name only
  Then `image_keys` is empty, `paused_at` is empty, `unit` is empty, `price` is 1 and `status` is ACTIVE
  And no variant is created
Scenario Outline: AC-2 Photo limit
  When a product has <keys>
  Then the database <result>
  Examples:
    | keys            | result          |
    | 5 image keys    | accepts         |
    | 6 image keys    | rejects (23514) |
    | image_keys null | rejects (23502) |
Scenario: AC-3 An old-style insert reaches a variant
  When a product is inserted with unit "sac", price 3000 and minimum 2.5
  Then one variant exists with the same id, an empty name, unit "sac", price 3000, minimum 2.5 and status ACTIVE
Scenario Outline: AC-4 An old-style update reaches the variant
  Given a product inserted the old way
  When its <column> is set to <value>
  Then its variant <effect>
  Examples:
    | column     | value    | effect                                |
    | price      | 3500     | has price 3500 and a later price date |
    | status     | INACTIVE | is INACTIVE                           |
Scenario: AC-5 A new-style product keeps its own variants
  Given a product with an empty `unit` and a variant with a new id
  When the product is renamed
  Then no variant with the id of the product appears
Scenario: AC-6 Phones fetch the products again
  When the touch statement of the migration runs on products a day old
  Then every `server_updated_at` is later than before
```

## Abuse cases
```gherkin
Scenario: AB-1 A thousand photos on one product (resource exhaustion)
  When code sets a list of 1000 keys on a product, straight in the database
  Then PostgreSQL rejects it with 23514
```

## Implementation
- Create: `prisma/migrations/<timestamp>_cat_014_product_photos_pause_mirror/migration.sql`, `tests/integration/catalog/product-new-columns.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.1: the number of photos of a product is limited in the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| new-style row | integration | AC-1, C-46, C-35 | insert with a name → defaults, no variant |
| photo limit | integration | AC-2, C-49, Product:required | each Examples row → accepted, 23514 or 23502 |
| old insert | integration | AC-3 | insert the old way → one variant, same id and values |
| old update | integration | AC-4 | each Examples row → variant changed |
| new-style product | integration | AC-5 | rename → variants unchanged |
| touch | integration | AC-6, C-35 | replay the marked lines → dates later |
| thousand photos | security | AB-1, CWE-400 | raw update with 1000 keys → 23514 |

Command: `npx vitest run tests/integration/catalog/product-new-columns.test.ts`

## Out of scope
- Writing photos (IMG) and pausing products (BIL); dropping the old columns and triggers (a later story).
