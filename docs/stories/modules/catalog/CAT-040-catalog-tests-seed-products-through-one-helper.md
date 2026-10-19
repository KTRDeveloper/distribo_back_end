---
id: CAT-040
title: Catalog tests seed products through one helper
module: catalog
kind: technical
rev: 1
amends: []
size: M
risk: low
depends_on: [CAT-031, CAT-037, CAT-039]
read_first: [tests/integration/catalog/reference-price.test.ts]
design_refs: [catalogue/product, catalogue/productvariant]
constraints: [C-45]
asvs: [v5.0.0-2.2.1]
---

# CAT-040 — Catalog tests seed products through one helper

## Story
Technical story: give the tests one function that creates a product with its variant, so that the old columns of `products` can go without rewriting every test twice.

## Context
- Exists: tests insert products with `unit`, `price`, `status` and `min_order_quantity` (`prisma.product.create` or `INSERT INTO products`), and the triggers of CAT-014 copy those columns to a variant of the same id. Those columns go in CAT-041.
- New `tests/helpers/catalog-fixtures.ts`: `seedProduct(client, input)` creates the product new-style (name, `paused_at`, `deleted_at`; the old columns keep their defaults) and one variant with the same id as the product, as CAT-013 did, so that lines and prices that hold the product id still find a variant.
- Options of the input go to the right row: `unit`, `price`, `minOrderQuantity`, `status` and `variantName` to the variant; `pausedAt` to the product; `deletedAt` to both. Defaults: name "Product", unit "kg", price 1000, ACTIVE, no variant name.
- The nine catalog tests below use it for every product they create. An update of `status`, `price`, `unit` or `min_order_quantity` on `products` becomes an update of the variant of the same id.
- `C-45`: A product that is not deleted has at least one variant that is not deleted; `ProductVariant.organization_id` equals `Product.organization_id`.
- `C-45`: A product that is not deleted has at least one variant that is not deleted; `ProductVariant.organization_id` equals `Product.organization_id`.

## Acceptance criteria
```gherkin
Scenario: AC-1 One product, one variant
  When `seedProduct` is called with an id and an organization
  Then one product has that id and one variant has the same id, `product_id` and organization, ACTIVE, unit "kg", price 1000
Scenario: AC-2 Options reach the right row
  When it is called with unit "sac", price 15000, minimum "2.000", INACTIVE, variant name "25 kg", a pause date and a deletion date
  Then the variant holds the first five and the product holds the pause date, and both hold the deletion date
Scenario: AC-3 Inside a transaction
  When it is called with the client of `prisma.$transaction`
  Then both rows exist after the commit and none after a rollback
Scenario: AC-4 The converted tests
  When the nine catalog test files run
  Then they pass and assert what they asserted before
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/helpers/catalog-fixtures.ts`, `tests/integration/catalog/seed-product.test.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `seedProduct(client: Prisma.TransactionClient, input: SeedProductInput): Promise<{ productId: string; variantId: string }>`
- Types:
  - `SeedProductInput = { id: string; organizationId: string; name?: string; unit?: string; price?: bigint; minOrderQuantity?: string | null; status?: 'ACTIVE' | 'INACTIVE'; variantName?: string | null; pausedAt?: Date | null; deletedAt?: Date | null }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.1: the helper writes fake data only, and every value passes through the client's parameters.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| product and variant | integration | AC-1, C-45 | both rows, same id |
| options | integration | AC-2 | each option on its row |
| transaction | integration | AC-3 | commit and rollback |
| converted files | integration | AC-4 | the nine files pass |

Command: `npx vitest run tests/integration/catalog/seed-product.test.ts tests/integration/catalog`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/copy-prices.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/catalog/copy-product.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/catalog/customer-catalog.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/catalog/customer-price-table.test.ts | inserts a product with unit and price | inserts it with `seedProduct` |
| tests/integration/catalog/edit-product.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/catalog/list-products.test.ts | inserts a product with unit and price | inserts it with `seedProduct` |
| tests/integration/catalog/list-remove-prices.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/catalog/reference-price.test.ts | inserts a product with unit, price, status and deleted_at | inserts it with `seedProduct`, passing status and deletedAt |
| tests/integration/catalog/set-customer-price.test.ts | inserts products with unit and price | inserts them with `seedProduct` |

## Out of scope
- Tests of other modules: ORD-031, DLV-016, SYNC-043. `product-table.test.ts`, which tests the old columns themselves: CAT-041.
