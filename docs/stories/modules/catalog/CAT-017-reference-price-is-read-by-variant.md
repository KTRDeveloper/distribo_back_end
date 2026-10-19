---
id: CAT-017
title: Reference price is read by variant
module: catalog
kind: change
rev: 1
amends: [CAT-003]
size: S
risk: high
depends_on: [CAT-003, CAT-014, CAT-015]
read_first: [src/modules/catalog/catalog.repository.ts, prisma/schema.prisma]
design_refs: [catalogue/productvariant, relations-commerciales/customerprice]
constraints: [CM-11]
asvs: [v5.0.0-2.2.3, v5.0.0-8.2.2]
---

# CAT-017 — Reference price is read by variant

## Story
As a seller, I want an order line to take the price of the variant that is sold, so that two sizes of one article each have their own price and their own negotiated price.

## Context
- Exists: `getReferencePrice(tx, relationshipId, productId)` in `catalog.repository.ts` reads the old product columns. Orders and synchronization call it with a product id.
- Change: `getReferencePrice` reads the variant of the relationship's supplier (any state, as the product was) and the live negotiated price of that relationship for that variant (`product_variant_id`), else the variant price. The result keeps its shape: `{ price, negotiated, changedAt }`. A price negotiated for another variant of the same product never applies.
- A product written the old way has a variant with its own id (CAT-013, CAT-014), so callers that still pass product ids get the same answers.
- Callers move to variant ids in the order and synchronization stories; none changes here.
- `CM-11`: Reference price of a line = negotiated price when one exists (even higher than the variant price), else the variant price.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Reference price of a variant
  Given a variant priced 3000
  When the negotiated price of the relationship for that variant is <negotiated>
  Then `getReferencePrice` returns price <price> and negotiated <flag>
  Examples:
    | negotiated | price | flag  |
    | none       | 3000  | false |
    | 2800       | 2800  | true  |
    | 3500       | 3500  | true  |
    | deleted    | 3000  | false |
Scenario: AC-2 Each variant has its own negotiated price
  Given two variants of one product and a negotiated price of 2800 for the first only
  When the reference price is read for each
  Then the first gives 2800 with negotiated true and the second gives its own price with negotiated false
Scenario Outline: AC-3 Reference price refused
  When `getReferencePrice` is called with <case>
  Then it throws 404 NOT_FOUND
  Examples:
    | case                                       |
    | an unknown relationship                    |
    | an unknown variant                         |
    | a variant of another business              |
Scenario: AC-4 A product written the old way
  Given a product inserted with unit and price, so its variant has the same id
  When `getReferencePrice` is called with that id
  Then it answers as for any variant
```

## Abuse cases
```gherkin
Scenario: AB-1 Another customer's price leaks (information disclosure)
  Given two relationships of one supplier, each with its own negotiated price for a variant
  When the reference price is read for the first
  Then only the first price is used
```

## Implementation
- Create: `tests/integration/catalog/variant-reference-price.test.ts`
- Modify: `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `getReferencePrice(tx: Prisma.TransactionClient, relationshipId: string, variantId: string): Promise<{ price: bigint; negotiated: boolean; changedAt: Date }>`
- Errors: `404` NOT_FOUND 'Not found' (httpError), whatever the cause
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.3: the price is read from the database inside the caller's transaction, never from a value sent by the client.
- v5.0.0-8.2.2: only the given relationship's price is read, and only a variant of that relationship's supplier.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| reference price | integration | AC-1, CM-11 | each Examples row → price and flag |
| own price | integration | AC-2, CM-11 | two variants → two answers |
| refused price | integration | AC-3 | each Examples row → 404 |
| old-style product | integration | AC-4 | product id answers |
| other customer | security | AB-1, WSTG-ATHZ-02 | only the first price |

Command: `npx vitest run tests/integration/catalog/variant-reference-price.test.ts tests/integration/catalog/reference-price.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/reference-price.test.ts | seeds products with the old price columns and passes product ids | unchanged: the legacy variant of each product (CAT-013, CAT-014) gives the same answers |

## Out of scope
- Callers: order lines and synchronization move to variant ids in their own stories.
- Reading an ACTIVE variant (CAT-019) and writing variants (later catalog stories).
