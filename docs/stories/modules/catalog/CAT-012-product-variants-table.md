---
id: CAT-012
title: Product variants table
module: catalog
kind: migration
rev: 1
amends: [CAT-001]
size: M
risk: high
depends_on: [CAT-001]
read_first: [prisma/schema.prisma, tests/integration/organization/organization-table.test.ts]
design_refs: [catalogue/productvariant, contraintes-a-poser-au-niveau-base-de]
constraints: ['ProductVariant:required', 'ProductVariant.status:enum', 'ProductVariant:fk', C-13, C-45, C-49, C-35]
asvs: [v5.0.0-2.2.3]
---

# CAT-012 — Product variants table

## Story
Technical story: create the variants table, the sold level of the catalog, so that a product can carry several units and prices.

## Context
- Exists: `products` (CAT-001) with `set_product_price_updated_at()` and `set_server_updated_at()`.
- One migration, one transaction: table `product_variants` with `id`, the fields above, `server_updated_at` and `deleted_at`. `name`, `min_order_quantity` and `merged_into_id` may be empty; `status` uses `ProductStatus`, ACTIVE by default; `price` bigint, `min_order_quantity` numeric(12,3).
- Keys: (`product_id`, `organization_id`) refers to `products` (`id`, `organization_id`), which gets a unique index on that pair (C-45); `merged_into_id` is a foreign key too. CHECKs: `price` > 0 and `min_order_quantity` > 0 when set (C-13); at most 5 `image_keys`, with a GIN index (C-49).
- The two functions become triggers: the price date follows the price only; the server date is the database time.
- `prisma/schema.prisma`: add `model ProductVariant` with its relations (the list `variants` on the model `Product`) and `@@unique([id, organizationId])` on `Product`. Above the model, a plain-words `//` comment: a variant belongs to the business of its product; a live product keeps one live variant, which the code ensures, not the database.
- `ProductVariant` fields: `product_id` FK → Product; `organization_id` FK → Organization; `name` string, nullable; `unit` string; `price` bigint; `price_updated_at` datetime; `min_order_quantity` decimal (3 décimales), nullable; `image_keys` string[]; `status` enum [ACTIVE / INACTIVE]; `created_at` datetime; `merged_into_id` FK → ProductVariant, nullable
- `ProductVariant:required`: NOT NULL: `product_id`, `organization_id`, `unit`, `price`, `price_updated_at`, `image_keys`, `status`, `created_at`
- `ProductVariant.status:enum`: one of ACTIVE, INACTIVE
- `ProductVariant:fk`: references product_id → Product; organization_id → Organization; merged_into_id → ProductVariant
- `C-13`: `ProductVariant.price` > 0; `min_order_quantity` > 0 when set; `price_updated_at` is set by the server on every price change.
- `C-45`: A product that is not deleted has at least one variant that is not deleted; `ProductVariant.organization_id` equals `Product.organization_id`.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Defaults and server dates
  When a variant is inserted with product, business, unit, price 3000 and a `price_updated_at` of 2020
  Then `name` and `min_order_quantity` are empty, `status` is ACTIVE and `image_keys` is empty
  And `price_updated_at`, `created_at` and `server_updated_at` are the database time
Scenario Outline: AC-2 Value rules
  When a variant has <values>
  Then the database <result>
  Examples:
    | values | result |
    | price 0 | rejects (23514) |
    | min_order_quantity 0 | rejects (23514) |
    | 5 image keys | accepts |
    | 6 image keys | rejects (23514) |
Scenario: AC-3 The price date moves with the price only
  Given a variant
  When its price changes, and then only its unit changes
  Then `price_updated_at` moves with the price and stays on the unit change
Scenario: AC-4 Required values and keys
  When `product_id`, `unit` or `price` is empty, a key refers to nothing, or `status` is not ACTIVE or INACTIVE
  Then the insert fails with 23502, 23503 or 22P02
```

## Abuse cases
```gherkin
Scenario: AB-1 A variant slipped under another business's product (tampering)
  When code inserts, straight in the database, a variant of business A under a product of business B
  Then PostgreSQL rejects it with 23503, even though no application check ran
```

## Implementation
- Create: `prisma/migrations/<timestamp>_cat_012_product_variants/migration.sql`, `tests/integration/catalog/product-variant-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: related values are checked by the database, not only by code: the business of a variant is that of its product (composite key), prices and quantities are positive, photos are at most 5.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| defaults | integration | AC-1, C-35 | insert → defaults, database dates |
| value rules | integration | AC-2, C-13, C-49 | each Examples row → accepted or 23514 |
| price date | integration | AC-3, C-13 | price change moves it; unit change keeps it |
| required and keys | integration | AC-4, ProductVariant:required, ProductVariant.status:enum, ProductVariant:fk | empty or unknown values → 23502, 23503, 22P02 |
| crafted write | security | AB-1, C-45, CWE-20 | raw insert under a product of another business → 23503 |

Command: `npx vitest run tests/integration/catalog/product-variant-table.test.ts`

## Out of scope
- The copy of existing products (CAT-013), new product columns (CAT-014), negotiated prices (CAT-015), one name and unit per product (CAT-018).
