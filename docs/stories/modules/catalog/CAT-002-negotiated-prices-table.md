---
id: CAT-002
title: Negotiated prices table
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [CAT-001, REL-002, PER-008]
read_first: [prisma/schema.prisma, tests/integration/relationship/relationship-table.test.ts]
design_refs: [relations-commerciales/customerprice, contraintes-a-poser-au-niveau-base-de]
constraints: ['CustomerPrice:required', 'CustomerPrice:fk', C-11, C-04, C-01, C-35]
asvs: [v5.0.0-2.2.3, v5.0.0-8.2.2]
---

# CAT-002 — Negotiated prices table

## Story
Technical story: create the negotiated prices table so that one customer can have its own price for one article.

## Context
- Exists: `products` (CAT-001), `customer_relationships` (REL-001), `require_registered_person()`.
- Adds: table `customer_prices` (`set_at` default now, `server_updated_at`, `deleted_at`), partial unique index on (`customer_relationship_id`, `product_id`) where `deleted_at` is null, triggers `require_registered_person('set_by_id')` and `set_server_updated_at()`.
- A trigger refuses a row whose product does not belong to the supplier organization of the relationship (a relationship whose supplier is a person has no products). The application rule that a price is positive is in the routes (CAT-008).
- `CustomerPrice` fields: `customer_relationship_id` FK → CustomerRelationship; `product_id` FK → Product; `price` bigint; `set_by_id` FK → Person; `set_at` datetime
- `CustomerPrice:required`: NOT NULL: `customer_relationship_id`, `product_id`, `price`, `set_by_id`, `set_at`
- `CustomerPrice:fk`: references customer_relationship_id → CustomerRelationship; product_id → Product; set_by_id → Person
- `C-11`: `CustomerPrice` is unique per (relationship, product) among rows not deleted; the product belongs to the supplier of the relationship.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Row
  When a price is inserted for a relationship and a product of the same supplier
  Then the row is stored with `set_at` and `server_updated_at` set
Scenario Outline: AC-2 Uniqueness
  When a second price for the same relationship and product is inserted while the first is <first>
  Then the insert <result>
  Examples:
    | first    | result          |
    | live     | rejects (23505) |
    | deleted  | accepts         |
Scenario: AC-3 Product of another supplier
  When the product belongs to a different organization than the relationship's supplier
  Then the insert fails with 23514
Scenario: AC-4 Author and keys
  When `set_by_id` is a guest, or a foreign key is unknown, or `price` is null
  Then the insert fails with 23514, 23503 or 23502
```

## Abuse cases
```gherkin
Scenario: AB-1 Price for a foreign product by a crafted write (tampering)
  When code inserts a price for another business's product
  Then PostgreSQL refuses it, even though no validation ran
```

## Implementation
- Create: `prisma/migrations/<timestamp>_cat_002_customer_prices/migration.sql`, `tests/integration/catalog/customer-price-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/relationship/relationship-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: supplier ownership of the product is checked in the database.
- v5.0.0-8.2.2: one live price per pair.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| row | integration | AC-1, C-01, C-35 | stored; server time |
| uniqueness | integration | AC-2, C-11 | each Examples row → accepted or 23505 |
| foreign product | integration | AC-3, C-11 | 23514 |
| author and keys | integration | AC-4, CustomerPrice:required, CustomerPrice:fk, C-04 | rejected |
| crafted write | security | AB-1, CWE-20 | raw insert for a foreign product → 23514 |

Command: `npx vitest run tests/integration/catalog/customer-price-table.test.ts`

## Out of scope
- Routes that write prices (CAT-008).
