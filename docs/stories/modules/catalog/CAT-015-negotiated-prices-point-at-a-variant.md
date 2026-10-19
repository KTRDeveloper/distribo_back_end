---
id: CAT-015
title: Negotiated prices point at a variant
module: catalog
kind: migration
rev: 1
amends: [CAT-002, CAT-008]
size: M
risk: high
depends_on: [CAT-013]
read_first: [prisma/schema.prisma, src/modules/catalog/catalog.repository.ts]
design_refs: [relations-commerciales/customerprice, contraintes-a-poser-au-niveau-base-de]
constraints: ['CustomerPrice:fk', C-11, C-35]
asvs: [v5.0.0-2.2.3, v5.0.0-8.2.2]
---

# CAT-015 — Negotiated prices point at a variant

## Story
Technical story: let a negotiated price name a variant instead of a product, so that a customer can have a different price for each variant.

## Context
- Exists: `customer_prices` with `product_id`, one live row per (`customer_relationship_id`, `product_id`) through `customer_prices_live_relationship_product_key`, and a trigger that checks the product's business (CAT-002); a variant of the same id for each old product (CAT-013).
- One migration, one transaction: `product_variant_id` (uuid, foreign key to `product_variants`, empty allowed for now), copied from `product_id` by one statement between `-- copy start` and `-- copy end`. `product_id` stays, required, until a later story drops it. Every `server_updated_at` moves to the migration time.
- A trigger fills `product_variant_id` from `product_id` when an insert leaves it empty, so old code and tests keep working. A second refuses (23514) a variant not owned by the relationship's supplier, as CAT-002 does for products.
- The old unique index goes: two variants of a product may each carry a price for one customer. New unique index on live (`customer_relationship_id`, `product_variant_id`) (C-11).
- `catalog.repository.ts`: `upsertCustomerPrice` conflicts on (`customer_relationship_id`, `product_variant_id`) where `deleted_at` is empty; the rest is unchanged.
- `prisma/schema.prisma`: `productVariantId` and its relation on `CustomerPrice`; the `//` comment above it now says: unique per variant among live rows, the variant is the supplier's, the old column goes later.
- `CustomerPrice` fields: `product_variant_id` FK → ProductVariant
- `CustomerPrice:fk`: references customer_relationship_id → CustomerRelationship; product_id → Product; set_by_id → Person
- `C-11`: `CustomerPrice` is unique per (relationship, variant) among rows not deleted; the variant belongs to the supplier of the relationship.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Every existing price names its variant
  Given a price inserted with no `product_variant_id`
  When the copy statement of the migration runs
  Then `product_variant_id` equals `product_id`, and `server_updated_at` is later than before
Scenario: AC-2 An old-style insert is completed
  When a price is inserted with `product_id` only
  Then `product_variant_id` equals `product_id`
Scenario Outline: AC-3 One live price per customer and variant
  When a second price for the same relationship is inserted for <variant>, the first being <state>
  Then the insert <result>
  Examples:
    | variant                             | state   | result          |
    | the same variant                    | live    | rejects (23505) |
    | the same variant                    | deleted | accepts         |
    | another variant of the same product | live    | accepts         |
Scenario: AC-4 Replacing a price keeps one row
  Given a live price for a relationship and a variant
  When `upsertCustomerPrice` is called again for the same pair with another price
  Then the row keeps its id and takes the new price, and no second live row exists
Scenario: AC-5 Keys
  When `product_variant_id` names no variant
  Then the insert fails with 23503
```

## Abuse cases
```gherkin
Scenario: AB-1 A price for a variant of another business (tampering)
  When code inserts a price for a variant of business B on a relationship of business A, straight in the database
  Then PostgreSQL rejects it with 23514, even though no application check ran
```

## Implementation
- Create: `prisma/migrations/<timestamp>_cat_015_customer_price_variant/migration.sql`, `tests/integration/catalog/customer-price-variant.test.ts`
- Modify: `prisma/schema.prisma`, `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Signatures:
  - `upsertCustomerPrice(tx: Prisma.TransactionClient, data: { id: string; relationshipId: string; productId: string; price: bigint; setById: string }): Promise<{ productId: string; price: bigint; setById: string; setAt: Date }>`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the supplier's ownership of the variant is checked in the database.
- v5.0.0-8.2.2: one live price per customer and variant.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| copy | integration | AC-1, C-35 | replay the marked lines → variant id = product id |
| old insert | integration | AC-2 | insert with `product_id` only → filled |
| uniqueness | integration | AC-3, C-11 | each Examples row → accepted or 23505 |
| replace | integration | AC-4 | upsert twice → one live row, new price |
| keys | integration | AC-5, CustomerPrice:fk | unknown variant → 23503 |
| crafted write | security | AB-1, CWE-639 | raw insert for another business's variant → 23514 |

Command: `npx vitest run tests/integration/catalog/customer-price-variant.test.ts tests/integration/catalog/customer-price-table.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/customer-price-table.test.ts | the old unique index is replaced by one on the variant | a second live price for the same relationship and product still fails with 23505 |

## Out of scope
- Routes that set, list, remove and copy prices by variant, and dropping `product_id` with the filling trigger: later stories.
