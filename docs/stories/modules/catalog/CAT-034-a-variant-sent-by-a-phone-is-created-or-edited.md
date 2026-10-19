---
id: CAT-034
title: A variant sent by a phone is created or edited without failing the batch
module: catalog
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [CAT-033, CAT-016, CAT-018, CAT-021]
read_first: [src/modules/catalog/catalog.sync-writers.ts, src/shared/variant.ts]
design_refs: [catalogue/productvariant, synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone]
constraints: [C-47, C-13]
asvs: [v5.0.0-15.3.3, v5.0.0-8.2.2, v5.0.0-2.2.1]
---

# CAT-034 — A variant sent by a phone is created or edited without failing the batch

## Story
Technical story: give the catalog the function that creates or edits a variant sent by the owner's phone, so that no variant fails a batch.

## Context
- Exists: `catalog.sync-writers.ts` (CAT-033); the variant table and its price date (CAT-012); the unique index of C-47 (CAT-018); `simplifyText` (CAT-016); the product date trigger (CAT-021).
- `applyVariantFromSync(tx, organizationId, input, now)` takes `{ id, product_id, name, unit, price, min_order_quantity, status }` and answers a result; it never throws for a business reason. Repository additions: `findVariantAnyState`, `findLiveTwin`, `insertVariant`, `updateVariant`.
- Limits as in CAT-022 (`unit` 1 to 100, `price` an integer of at least 1, `min_order_quantity` above 0, `status` ACTIVE or INACTIVE). Otherwise `INVALID` with the field names, nothing written (C-13).
- Unknown id: the product must be in the organization and not deleted, else `NO_PRODUCT`; then the variant is created. Id in the organization: the five fields are rewritten and the product never changes; deleted: `GONE`; id of another organization: `FOREIGN`.
- A live twin (same product, simplified name and unit) gives `COLLISION`, nothing written; CAT-035 turns a creation into a merge.
- `merged_into_id`, `price_updated_at`, `image_keys` and the product of an existing variant are never taken from a phone. A variant put back on sale never fails here: the caller pauses the excess.
- `ProductVariant` fields: `product_id` FK → Product; `name` string, nullable; `unit` string; `price` bigint; `min_order_quantity` decimal (3 décimales), nullable; `status` enum [ACTIVE / INACTIVE]; `merged_into_id` FK → ProductVariant, nullable; `price_updated_at` datetime; `image_keys` string[]
- `C-47`: Two variants of one product that are not deleted never share both the same simplified name and the same simplified unit (capitals and extra spaces ignored, an empty name counts as empty text); `merged_into_id` set implies the variant is deleted.
- `C-13`: `ProductVariant.price` > 0; `min_order_quantity` > 0 when set; `price_updated_at` is set by the server on every price change.

## Acceptance criteria
```gherkin
Scenario: AC-1 A new variant
  When an unknown id arrives for a product of the organization with name "Rouge / L", unit "pièce" and price 5000
  Then the result is CREATED and the variant is ACTIVE with `price_updated_at` set
Scenario: AC-2 An edit
  When the same id arrives with price 5500 and status INACTIVE
  Then the result is UPDATED and `price_updated_at` moved; an edit of the name alone leaves it
Scenario: AC-3 A twin
  Given two live variants "pièce" and "carton"
  When the second arrives with unit "Pièce"
  Then the result is COLLISION, nothing written
Scenario Outline: AC-4 Nothing written
  When the input is <case>
  Then the result is <result> and the database is unchanged
  Examples:
    | case                                                | result                  |
    | a product of another organization, or a deleted one | NO_PRODUCT              |
    | the id of a variant of another organization         | FOREIGN                 |
    | the id of a deleted variant                         | GONE                    |
    | price 0, an empty unit, or minimum 0                | INVALID                 |
Scenario: AC-5 Server fields
  When the input carries `merged_into_id`, `price_updated_at`, `image_keys` and another `product_id`
  Then none is written
```

## Abuse cases
```gherkin
Scenario: AB-1 A variant slipped into another business's product (broken access control)
  When business A sends a variant whose `product_id` is a product of business B
  Then the result is NO_PRODUCT
```

## Implementation
- Create: `tests/integration/catalog/sync-apply-variant.test.ts`
- Modify: `src/modules/catalog/catalog.sync-writers.ts`, `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `applyVariantFromSync(tx: Prisma.TransactionClient, organizationId: string, input: VariantSyncInput, now: Date): Promise<VariantSyncResult>`
- Types:
  - `VariantSyncInput = { id: string; productId: string; name: string | null; unit: string; price: number; minOrderQuantity: string | null; status: 'ACTIVE' | 'INACTIVE' }`
  - `VariantSyncResult = { result: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'MERGED' | 'COLLISION' | 'NO_PRODUCT' | 'FOREIGN' | 'GONE' | 'INVALID'; invalidFields?: string[]; mergedInto?: string; label?: string }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-15.3.3: five fields are read from the phone's row; the merge link, the price date and the photos have no way in.
- v5.0.0-8.2.2: the product and any existing variant are found through the organization id.
- v5.0.0-2.2.1: bad values stop before any write.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| created | integration | AC-1 | row, dates |
| edited | integration | AC-2, C-13 | price date moves with the price only |
| twin | integration | AC-3, C-47 | COLLISION, unchanged |
| nothing written | integration | AC-4 | each Examples row → result |
| server fields | integration | AC-5 | not written |
| other product | security | AB-1, CWE-639 | NO_PRODUCT, nothing stored |

Command: `npx vitest run tests/integration/catalog/sync-apply-variant.test.ts`

## Out of scope
- Folding a duplicate into the first: CAT-035. Deleting a variant: CAT-036.
