---
id: CAT-003
title: Reference price and active product lookup
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [CAT-002, REL-006]
read_first: [prisma/schema.prisma, src/modules/relationship/relationship.repository.ts]
design_refs: [relations-commerciales/customerprice, catalogue/product]
constraints: [CM-11, C-15]
asvs: [v5.0.0-2.2.3, v5.0.0-2.3.1]
---

# CAT-003 — Reference price and active product lookup

## Story
Technical story: provide the function that says which price an order line freezes, so that orders and sync compute it the same way.

## Context
- Exists: `products`, `customer_prices`.
- Adds: `src/modules/catalog/catalog.repository.ts` with `getReferencePrice(tx, relationshipId, productId)` and `getActiveProduct(tx, organizationId, productId)`.
- The reference price is the live negotiated price for the pair when one exists, even when higher than the product price; else `products.price`. It returns `{ price, negotiated, changedAt }` where `changedAt` is the negotiated `set_at` or the product's `price_updated_at`.
- `getActiveProduct` throws 404 `NOT_FOUND` unless the product belongs to the organization and is ACTIVE and not deleted.
- `CM-11`: Reference price of a line = negotiated price when one exists (even higher than the product price), else the product price.
- `C-15`: Every order line is for an ACTIVE product of the relationship's supplier; on a customer-placed order the quantity is at least `min_order_quantity` when sent.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Reference price
  Given a product priced 3000
  When the negotiated price is <negotiated> for the relationship
  Then getReferencePrice returns price <price> and negotiated <flag>
  Examples:
    | negotiated        | price | flag  |
    | none              | 3000  | false |
    | 2800              | 2800  | true  |
    | 3500 (higher)     | 3500  | true  |
    | deleted (2800)    | 3000  | false |
Scenario: AC-2 Other customers do not matter
  When another relationship has a negotiated price of 1000
  Then the first relationship's reference price is unchanged
Scenario Outline: AC-3 Active product
  When getActiveProduct receives <case>
  Then <result>
  Examples:
    | case                                | result           |
    | an ACTIVE product of the organization | it is returned |
    | an INACTIVE product                 | 404 NOT_FOUND    |
    | a deleted product                   | 404 NOT_FOUND    |
    | a product of another organization   | 404 NOT_FOUND    |
```

## Abuse cases
```gherkin
Scenario: AB-1 Using another customer's price (information disclosure)
  When getReferencePrice is called with relationship A
  Then no price of relationship B is ever used
```

## Implementation
- Create: `src/modules/catalog/catalog.repository.ts`, `tests/integration/catalog/reference-price.test.ts`
- Pattern: `src/modules/tasks/tasks.repository.ts`
- Signatures:
  - `getReferencePrice(tx: Prisma.TransactionClient, relationshipId: string, productId: string): Promise<{ price: bigint; negotiated: boolean; changedAt: Date }>`
  - `getActiveProduct(tx: Prisma.TransactionClient, organizationId: string, productId: string): Promise<Product>`
- Errors: `NOT_FOUND` 404
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.3: prices are read on the server, from the database, inside the caller's transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| reference price | integration | AC-1, CM-11 | each Examples row → price and flag |
| other customers | integration | AC-2 | unchanged |
| active product | integration | AC-3, C-15 | each Examples row → result |
| isolation | security | AB-1, CWE-200 | other relationship's price never used |

Command: `npx vitest run tests/integration/catalog/reference-price.test.ts`

## Out of scope
- Freezing prices on order lines (ORD module).
