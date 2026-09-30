---
id: CAT-001
title: Products table
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: low
depends_on: [ORG-001, FND-002, FND-005]
read_first: [prisma/schema.prisma, tests/integration/organization/organization-table.test.ts]
design_refs: [catalogue/product, contraintes-a-poser-au-niveau-base-de]
constraints: ['Product:required', 'Product.status:enum', 'Product:fk', C-13, C-01, C-35]
asvs: [v5.0.0-2.2.3]
---

# CAT-001 — Products table

## Story
Technical story: create the products table with its price rules so that each organization can own articles.

## Context
- Exists: `organizations`, `set_server_updated_at()`.
- Adds: table `products` (`price` bigint, `min_order_quantity` numeric(12,3) null, `status` default ACTIVE, `price_updated_at` and `created_at` default now, `server_updated_at`, `deleted_at`), CHECK `price > 0`, CHECK `min_order_quantity > 0` when set, and a trigger that sets `price_updated_at` to `now()` on insert and whenever `price` changes.
- `Product` fields: `organization_id` FK → Organization; `name` string; `unit` string; `price` bigint; `price_updated_at` datetime; `min_order_quantity` decimal (3 décimales), nullable; `description` text, nullable; `category` string, nullable; `status` enum [ACTIVE / INACTIVE]; `created_at` datetime
- `Product:required`: NOT NULL: `organization_id`, `name`, `unit`, `price`, `price_updated_at`, `status`, `created_at`
- `Product.status:enum`: one of ACTIVE, INACTIVE
- `Product:fk`: references organization_id → Organization
- `C-13`: `Product.price` > 0; `min_order_quantity` > 0 when set; `price_updated_at` is set by the server on every price change.
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Defaults
  When a product is inserted with name, unit, price 3000
  Then `status` is ACTIVE, `price_updated_at`, `created_at` and `server_updated_at` are set
Scenario Outline: AC-2 Price rules
  When a row has <values>
  Then the insert <result>
  Examples:
    | values                        | result          |
    | price 1                       | accepts         |
    | price 0                       | rejects (23514) |
    | price -5                      | rejects (23514) |
    | min_order_quantity 0.001      | accepts         |
    | min_order_quantity 0          | rejects (23514) |
    | min_order_quantity 1.0005     | rejects or rounds to 3 decimals |
    | status "DELETED"              | rejects         |
Scenario: AC-3 Price change date
  When the price is updated, and then only the name is updated
  Then `price_updated_at` moves only for the price change
Scenario: AC-4 Required and key
  When name, unit or price is null, or the organization is unknown
  Then the insert fails with 23502 or 23503
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `prisma/migrations/<timestamp>_cat_001_products/migration.sql`, `tests/integration/catalog/product-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: price limits and the price date are enforced by the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| defaults | integration | AC-1, C-01, C-35 | insert → defaults; column types incl. numeric(12,3) |
| price rules | integration | AC-2, C-13, Product.status:enum | each Examples row → accepted or rejected |
| price date | integration | AC-3, C-13 | moves only on price change |
| required and key | integration | AC-4, Product:required, Product:fk | rejected |

Command: `npx vitest run tests/integration/catalog/product-table.test.ts`

## Out of scope
- Routes (CAT-004 onward).
