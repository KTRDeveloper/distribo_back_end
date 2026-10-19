---
id: CAT-020
title: The server can count, list and pause the products on sale
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [CAT-014, CAT-019]
read_first: [src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/product]
constraints: [C-46]
asvs: [v5.0.0-8.2.2, v5.0.0-2.3.3]
---

# CAT-020 — The server can count, list and pause the products on sale

## Story
Technical story: give the catalog the functions that list the products on sale and pause or resume them for one business, so that billing can enforce the product limit without reading the catalog tables.

## Context
- Exists: `products.paused_at`, written by the server only (CAT-014, C-46), and the variants of a product (CAT-013). No route or job pauses a product yet.
- New in `catalog.repository.ts`, each with the caller's transaction and an organization id:
  - `listProductsOnSale`: products not deleted, with `paused_at` empty and at least one ACTIVE, not deleted variant. Newest first (`created_at` descending, then `id`). Each item is `{ productId, createdAt, variantIds }` with every not deleted variant of the product.
  - `listPausedProducts`: products not deleted, with `paused_at` set and at least one ACTIVE, not deleted variant; same shape and order.
  - `setProductsPaused(tx, organizationId, productIds, paused, now)`: for those ids that belong to the organization, are not deleted and are not already in that state, sets `paused_at = now` (pause) or clears it (resume) and sets `server_updated_at = now` so the phones receive it. It returns the ids it changed.
- First usage: billing (BIL-020). It ships here because billing must not read catalog tables (ADR-004).
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.

## Acceptance criteria
```gherkin
Scenario: AC-1 What is on sale
  Given a business with a product with an ACTIVE variant, one whose variants are all INACTIVE, a deleted one and a paused one
  When `listProductsOnSale` runs
  Then it returns only the first, with the ids of all its not deleted variants
Scenario: AC-2 Newest first
  Given three products created one after another
  When `listProductsOnSale` runs
  Then they come back newest first
Scenario: AC-3 Pausing
  When `setProductsPaused` pauses two products at 2026-10-12T09:00:00Z
  Then their `paused_at` and `server_updated_at` are that instant, both ids are returned, they leave the on-sale list and `listPausedProducts` returns them
Scenario: AC-4 Resuming
  When `setProductsPaused` resumes a paused product
  Then `paused_at` is empty, `server_updated_at` moves forward and the product is back on sale
Scenario Outline: AC-5 Ids that are left alone
  When `setProductsPaused` pauses <given>
  Then <result>
  Examples:
    | given                         | result                                       |
    | a deleted product             | it is unchanged and not returned             |
    | an already paused product     | its first `paused_at` is kept, not returned  |
    | an empty list                 | it returns an empty list                     |
```

## Abuse cases
```gherkin
Scenario: AB-1 A caller names the products of another business (broken access control)
  When `setProductsPaused` is called for business A with the id of a product of business B
  Then that product is unchanged, and its id is not returned
```

## Implementation
- Create: `tests/integration/catalog/product-pause.test.ts`
- Modify: `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `listProductsOnSale(tx: Prisma.TransactionClient, organizationId: string): Promise<SaleProduct[]>`
  - `listPausedProducts(tx: Prisma.TransactionClient, organizationId: string): Promise<SaleProduct[]>`
  - `setProductsPaused(tx: Prisma.TransactionClient, organizationId: string, productIds: string[], paused: boolean, now: Date): Promise<string[]>`
- Types:
  - `SaleProduct = { productId: string; createdAt: Date; variantIds: string[] }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: every query is bound to the organization id given by server code, and the update matches the product ids only inside it.
- v5.0.0-2.3.3: the change runs in the caller's transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| on sale | integration | AC-1, C-46 | four products → the one on sale, its variant ids |
| order | integration | AC-2 | three products → newest first |
| pause | integration | AC-3 | dates, returned ids, lists |
| resume | integration | AC-4 | empty date, back on sale |
| left alone | integration | AC-5 | each Examples row → result |
| other business | security | AB-1, CWE-639 | B's product unchanged, not returned |

Command: `npx vitest run tests/integration/catalog/product-pause.test.ts`

## Out of scope
- Deciding how many products may stay and which ones: billing (BIL-020).
- Refusing an excess product in the online catalog routes: the stories that write products.
