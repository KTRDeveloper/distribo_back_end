---
id: CAT-033
title: A product sent by a phone is applied without failing the batch
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [CAT-014, CAT-021, CAT-016]
read_first: [src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/product, synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone]
constraints: [C-36, C-46, C-35]
asvs: [v5.0.0-15.3.3, v5.0.0-8.2.2, v5.0.0-2.2.1]
---

# CAT-033 — A product sent by a phone is applied without failing the batch

## Story
Technical story: give the catalog the function that creates or edits a product sent by the owner's phone, so that the synchronization writes products without ever reaching the database rules.

## Context
- Exists: new-style product rows with an empty `unit` and the default price (CAT-014); `server_updated_at` set by the database (C-35).
- New `catalog.sync-writers.ts` and repository functions `findProductAnyState`, `insertProduct`, `updateProductText`. `applyProductFromSync(tx, organizationId, input, now)` takes `{ id, name, description, category }` and answers a result; it never throws for a business reason.
- Unknown id: the product is created new-style in the organization. Id of the organization: the three text fields are rewritten, nothing is written when unchanged. Id of another organization: `FOREIGN`. Deleted product: `GONE`. Neither writes anything.
- Limits as in CAT-004: `name` 1 to 100, `category` up to 100, `description` up to 2000. Beyond them: `INVALID` with the field names only, nothing written.
- `paused_at`, `image_keys`, `unit` and `price` are never taken from a phone (CM-27, C-46). The plan limit never refuses a product: the caller pauses the excess afterwards.
- First usage: the product push of the synchronization (ADR-004).
- `Product` fields: `name` string; `description` text, nullable; `category` string, nullable; `paused_at` datetime, nullable; `image_keys` string[]
- `C-36`: No uniqueness rule makes a sync fail; every possible duplicate has a written behavior, and a line no rule can write is set aside.
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 A new product
  When `applyProductFromSync` receives an unknown id with name "Riz parfumé"
  Then the result is CREATED, the product belongs to the organization, `unit` is empty, `paused_at` and `image_keys` are empty, and `server_updated_at` is the database time
Scenario: AC-2 An edit
  Given a product "Riz" with a description
  When the input has name "Riz parfumé" and none
  Then the result is UPDATED and the description is empty
Scenario: AC-3 The same input twice
  Then the second result is UNCHANGED and `server_updated_at` did not move
Scenario Outline: AC-4 Nothing written
  When the input is <case>
  Then the result is <result> and the database is unchanged
  Examples:
    | case                                              | result                      |
    | the id of a product of another organization       | FOREIGN                     |
    | the id of a deleted product                       | GONE                        |
    | an empty name, or a name of 101 characters        | INVALID with `name`         |
    | a description of 2001 characters                  | INVALID with `description`  |
Scenario: AC-5 Server fields
  When the input also carries `paused_at`, `image_keys`, `unit` and `price`
  Then they are not written and the product keeps its own values
```

## Abuse cases
```gherkin
Scenario: AB-1 Taking over another business's product (broken access control)
  When business A applies the id of a product of business B with a new name
  Then the result is FOREIGN and B's product is unchanged
Scenario: AB-2 Un-pausing a product from a phone (tampering)
  Given a paused product
  When the input carries `paused_at` empty
  Then the product stays paused
```

## Implementation
- Create: `src/modules/catalog/catalog.sync-writers.ts`, `tests/integration/catalog/sync-apply-product.test.ts`
- Modify: `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `applyProductFromSync(tx: Prisma.TransactionClient, organizationId: string, input: ProductSyncInput, now: Date): Promise<ProductSyncResult>`
- Types:
  - `ProductSyncInput = { id: string; name: string; description: string | null; category: string | null }`
  - `ProductSyncResult = { result: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'GONE' | 'FOREIGN' | 'INVALID'; invalidFields?: string[] }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-15.3.3: three fields are read from the phone's row; the pause and the photos have no way in.
- v5.0.0-8.2.2: an id found in another organization is never written.
- v5.0.0-2.2.1: lengths are checked before any write; only field names are reported.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| created | integration | AC-1, C-35 | new row, empty unit, database date |
| edited | integration | AC-2 | name and description |
| repeat | integration | AC-3 | UNCHANGED, same date |
| nothing written | integration | AC-4, C-36 | each Examples row → result, no change |
| server fields | integration | AC-5, C-46 | extra keys → not written |
| another business | security | AB-1, CWE-639 | FOREIGN, B unchanged |
| pause kept | security | AB-2, CWE-915 | still paused |

Command: `npx vitest run tests/integration/catalog/sync-apply-product.test.ts`

## Out of scope
- Judging the line and its role: the synchronization. Variants and deletions: CAT-034, CAT-036.
