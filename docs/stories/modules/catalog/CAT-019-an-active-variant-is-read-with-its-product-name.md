---
id: CAT-019
title: An active variant is read with its product name
module: catalog
kind: technical
rev: 1
amends: []
size: XS
risk: high
depends_on: [CAT-003, CAT-014]
read_first: [src/modules/catalog/catalog.repository.ts, prisma/schema.prisma]
design_refs: [catalogue/productvariant]
constraints: [C-15]
asvs: [v5.0.0-2.2.3, v5.0.0-8.2.2]
---

# CAT-019 — An active variant is read with its product name

## Story
Technical story: the catalog gives the orders one function that returns a variant on sale with the facts an order line freezes, so that no order module reads the products table itself.

## Context
- Exists: `getActiveProduct(tx, organizationId, productId)` in `catalog.repository.ts` returns a product row that is ACTIVE, not deleted and the organization's (C-15), read through the old columns.
- New: `getActiveVariant(tx, organizationId, variantId)` returns an `ActiveVariant` when the variant is ACTIVE and not deleted, belongs to the organization, and its product is neither deleted nor paused; otherwise 404 `NOT_FOUND` without saying which condition failed.
- `getActiveProduct` stays until the old columns go. First usage: order lines (ORD), which move from the product to the variant; the function ships here because the order module must not read catalog tables (ADR-004).
- A product written the old way has a variant with its own id (CAT-013, CAT-014), so the function answers for those ids too.
- `C-15`: Every order line is for an ACTIVE variant of the relationship's supplier, of a product that is not paused; on a customer-placed order the quantity is at least the variant's `min_order_quantity` when sent.

## Acceptance criteria
```gherkin
Scenario: AC-1 Active variant
  Given an ACTIVE variant "Rouge / L" of the product "T-shirt", priced 3000, minimum 2.5
  When `getActiveVariant` is called for its business
  Then it returns the variant id, the product id, "T-shirt", "Rouge / L", the unit, 3000, the price date and 2.5
Scenario Outline: AC-2 Refused
  When `getActiveVariant` is called for <case>
  Then it throws 404 NOT_FOUND with the same message
  Examples:
    | case                           |
    | an INACTIVE variant            |
    | a deleted variant              |
    | a variant of a deleted product |
    | a variant of a paused product  |
    | a variant of another business  |
    | an unknown variant             |
Scenario: AC-3 A product written the old way
  Given a product inserted with unit and price, so its variant has the same id
  When `getActiveVariant` is called with that id
  Then it answers as for any variant
```

## Abuse cases
```gherkin
Scenario: AB-1 A variant of another business is confirmed to exist (information disclosure)
  When a seller asks for a variant of another business, and then for a variant that does not exist
  Then both answers are the same 404 body
```

## Implementation
- Create: `tests/integration/catalog/active-variant.test.ts`
- Modify: `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `getActiveVariant(tx: Prisma.TransactionClient, organizationId: string, variantId: string): Promise<ActiveVariant>`
- Types:
  - `ActiveVariant = { id: string; productId: string; productName: string; variantName: string | null; unit: string; price: bigint; priceUpdatedAt: Date; minOrderQuantity: Prisma.Decimal | null }`
- Errors: `404` NOT_FOUND 'Not found' (httpError), whatever the cause
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.3: the variant is read from the database inside the caller's transaction, never from a value sent by the client.
- v5.0.0-8.2.2: only a variant of the given business is returned, and a refusal never says why.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| active variant | integration | AC-1, C-15 | fields returned |
| refused | integration | AC-2, C-15 | each Examples row → 404, same message |
| old-style product | integration | AC-3 | product id answers |
| same 404 | security | AB-1, CWE-204 | other business and unknown give the same body |

Command: `npx vitest run tests/integration/catalog/active-variant.test.ts`

## Out of scope
- Callers: order lines move to variant ids in the order stories.
- Removing `getActiveProduct`: the story that drops the old columns.
