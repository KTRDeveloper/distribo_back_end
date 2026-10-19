---
id: CAT-044
title: The server reads the photo keys of a product or a variant under a lock
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [CAT-032]
read_first: [src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/product, catalogue/productvariant, images/stockage]
constraints: [C-49]
asvs: [v5.0.0-8.2.2, v5.0.0-2.3.3]
---

# CAT-044 — The server reads the photo keys of a product or a variant under a lock

## Story
Technical story: provide the functions that read the current photo keys of a product or a variant, with a row lock when the caller is going to change them, so that two photo changes made at once never overwrite each other.

## Context
- Exists: `setProductImageKeys` and `setVariantImageKeys` replace the whole list and return the previous one (CAT-032).
- New in `catalog.repository.ts`, in the caller's transaction: `lockProductImageKeys(tx, organizationId, productId)` and `lockVariantImageKeys(tx, organizationId, variantId)` read the row `FOR UPDATE` and return the keys in display order; the variant one also returns its `productId`. `readProductImageKeys` and `readVariantImageKeys` are the same reads without the lock, for a card a photo is copied from.
- A row that is unknown, deleted or of another organization: 404 `NOT_FOUND`, nothing returned. An INACTIVE variant can be read.
- Keys never leave the server through a catalog route (C-49). First usage: the photo routes of the images module (IMG-008 to IMG-011) and the copy of CAT-045.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.

## Acceptance criteria
```gherkin
Scenario: AC-1 A product
  Given a product whose keys are A then B
  When `lockProductImageKeys` or `readProductImageKeys` is called
  Then it returns A then B
Scenario: AC-2 A variant
  Given a variant of a product with the keys C
  When `lockVariantImageKeys` or `readVariantImageKeys` is called
  Then it returns the product id and C
Scenario: AC-3 The lock holds
  Given a transaction that locked a product and has not ended
  When a second transaction calls `lockProductImageKeys`
  Then it waits, and after the first commits a new list it returns that list
Scenario Outline: AC-4 Rows that cannot be read
  When a reader is called for <target>
  Then it fails with 404 `NOT_FOUND`
  Examples:
    | target                  |
    | an unknown id           |
    | a deleted product       |
    | a deleted variant       |
```

## Abuse cases
```gherkin
Scenario: AB-1 A card of another organization (horizontal access)
  When organization B asks for the keys of a product or a variant of organization A
  Then the answer is 404 `NOT_FOUND` and no key is returned
```

## Implementation
- Create: `tests/integration/catalog/image-key-readers.test.ts`
- Modify: `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `lockProductImageKeys(tx: Prisma.TransactionClient, organizationId: string, productId: string): Promise<string[]>`
  - `readProductImageKeys(tx: Prisma.TransactionClient, organizationId: string, productId: string): Promise<string[]>`
  - `lockVariantImageKeys(tx: Prisma.TransactionClient, organizationId: string, variantId: string): Promise<VariantImageKeys>`
  - `readVariantImageKeys(tx: Prisma.TransactionClient, organizationId: string, variantId: string): Promise<VariantImageKeys>`
- Types:
  - `VariantImageKeys = { productId: string; keys: string[] }`
- Errors: `NOT_FOUND` 404
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: every read filters on the organization given by the caller, never on an id alone.
- v5.0.0-2.3.3: the lock lives as long as the caller's transaction, so the read and the write that follows are one step.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| product | integration | AC-1, C-49 | keys A, B → A, B in order |
| variant | integration | AC-2 | product id and keys, locked and not locked |
| lock holds | integration | AC-3, CWE-362 | second transaction waits, then sees the first write |
| missing rows | integration | AC-4 | each Examples row → 404 NOT_FOUND |
| other organization | security | AB-1, CWE-639 | product and variant of A asked by B → 404, no key |

Command: `npx vitest run tests/integration/catalog/image-key-readers.test.ts`

## Out of scope
- The routes that change photos: IMG-008 to IMG-010. Releasing the keys of deleted cards: CAT-046.
