---
id: CAT-032
title: The server writes the photo keys of a product or a variant
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [CAT-014, CAT-021, FND-013]
read_first: [src/modules/catalog/catalog.repository.ts, docs/stories/modules/foundation/contracts.md]
design_refs: [catalogue/product, catalogue/productvariant, images/stockage]
constraints: [C-49, C-35]
asvs: [v5.0.0-15.3.3, v5.0.0-2.2.3, v5.0.0-8.2.2]
---

# CAT-032 — The server writes the photo keys of a product or a variant

## Story
Technical story: provide the two functions that replace the photo keys of a product or of a variant and hand back the previous keys, so that the images module can delete the old files after the commit.

## Context
- Exists: the `image_keys` columns, 5 keys at most (CAT-012, CAT-014); `imageKeySchema` and the folder `products` (FND-013); the trigger that moves the product's `server_updated_at` when a variant changes (CAT-021).
- New in `catalog.repository.ts`, in the caller's transaction: `setProductImageKeys(tx, organizationId, productId, keys)` and `setVariantImageKeys(tx, organizationId, variantId, keys)`. They lock the row, write the new list (empty clears it), move `server_updated_at` and return the previous list.
- A product or variant that is unknown, deleted or of another organization: 404 `NOT_FOUND`, nothing written. An INACTIVE variant can be written.
- Every key must match `imageKeySchema` and start with `products/`, at most 5 distinct keys; otherwise a RangeError is thrown and nothing is written.
- No catalog schema accepts a key (C-49). First usage: the photo routes of the images module, which may import `catalog` only through its contract (ADR-004).
- `Product` fields: `image_keys` string[]
- `ProductVariant` fields: `image_keys` string[]
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Set, replace and clear a product
  Given a product whose keys are <before>
  When `setProductImageKeys` is called with <given>
  Then it returns <before> and the stored keys are <given>
  Examples:
    | before       | given        |
    | none         | key A        |
    | key A        | keys B and C |
    | keys B and C | none         |
Scenario: AC-2 A variant, and its product travels with it
  Given a variant whose product has `server_updated_at` T
  When `setVariantImageKeys` writes key A at a later time
  Then it returns an empty list, the variant holds key A and the product's `server_updated_at` is later than T
Scenario Outline: AC-3 Rows that cannot be written
  When a writer is called for <target>
  Then it fails with 404 `NOT_FOUND` and writes nothing
  Examples:
    | target                                  |
    | an id that is not a product or variant  |
    | a deleted product or variant            |
Scenario: AC-4 Two replacements at once
  Given a product holds key A
  When two calls replace it with key B and key C at the same time
  Then one returns key A and the other returns the key the first wrote
```

## Abuse cases
```gherkin
Scenario: AB-1 A crafted key (tampering)
  When a writer receives `avatars/<uuid>.webp`, `products/../x.webp`, an uppercase UUID, six keys or the same key twice
  Then it throws a RangeError and the stored keys are unchanged
Scenario: AB-2 A product of another business (broken access control)
  When a writer is called for business A with the id of a product or variant of business B
  Then the answer is 404 `NOT_FOUND` and B's keys are unchanged
```

## Implementation
- Create: `tests/integration/catalog/image-key-writers.test.ts`
- Modify: `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `setProductImageKeys(tx: Prisma.TransactionClient, organizationId: string, productId: string, keys: string[]): Promise<string[]>`
  - `setVariantImageKeys(tx: Prisma.TransactionClient, organizationId: string, variantId: string, keys: string[]): Promise<string[]>`
- Errors: `NOT_FOUND` 404
- Dependencies: `@prisma/client`

## Security
- v5.0.0-15.3.3: the photo keys have exactly one writer per table, and it validates every key.
- v5.0.0-2.2.3: the row is locked before the previous keys are read.
- v5.0.0-8.2.2: the row is selected by its id and the organization id together.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| product keys | integration | AC-1, C-49 | each Examples row → returned and stored lists |
| variant keys | integration | AC-2, C-35 | key stored, product date moved |
| not writable | integration | AC-3 | each Examples row → 404, nothing written |
| concurrent | integration | AC-4 | `Promise.all` of two replacements → A and the first writer's key |
| crafted key | security | AB-1, CWE-22 | the five values → RangeError, keys unchanged |
| other business | security | AB-2, CWE-639 | B's id → 404, B's keys unchanged |

Command: `npx vitest run tests/integration/catalog/image-key-writers.test.ts`

## Out of scope
- Receiving and storing the file, and deleting the old files: the images module.
