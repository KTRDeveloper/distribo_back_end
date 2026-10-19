---
id: CAT-039
title: A negotiated price sent or removed by a phone is applied without failing the batch
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [CAT-029, CAT-037]
read_first: [src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/product, synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne]
constraints: [C-11, C-36]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.3, v5.0.0-2.2.1]
---

# CAT-039 — A negotiated price sent or removed by a phone is applied without failing the batch

## Story
Technical story: give the catalog the functions that write or remove a negotiated price sent by the owner's phone, so that a price entered twice never fails a batch.

## Context
- Exists: `upsertCustomerPrice` and the unique price per relationship and variant (CAT-029); `resolveVariantForLine` (CAT-037); `catalog.sync-writers.ts`.
- `applyPriceFromSync(tx, organizationId, input, now)` takes `{ id, relationshipId, variantId, price, setById }` and answers a result; it never throws for a business reason. `deletePriceFromSync(tx, organizationId, priceId, now)` answers DELETED, ALREADY or NOT_FOUND.
- The relationship must be live and supplied by the organization (else `NO_RELATIONSHIP`). The variant comes from `resolveVariantForLine`, which follows a merge or brings a deleted one back (else `NO_VARIANT`). `price` is an integer of at least 1 (else `INVALID`).
- Unknown id: the price is written with `product_variant_id`, and `product_id` of the variant's product. A live price of the same pair under another id is deleted first: the last arrival wins. Id of a live price of the organization: only `price` is rewritten, the pair never changes. Deleted price: `GONE`. Price of another organization: `FOREIGN`.
- `C-11`: `CustomerPrice` is unique per (relationship, variant) among rows not deleted; the variant belongs to the supplier of the relationship.
- `C-36`: No uniqueness rule makes a sync fail; every possible duplicate has a written behavior, and a line no rule can write is set aside.

## Acceptance criteria
```gherkin
Scenario: AC-1 A new price
  When an unknown id arrives for a relationship of the organization and a live variant with price 6000
  Then the result is CREATED, the row names the variant and its product, and `set_by_id` is the given person
Scenario: AC-2 Entered twice
  Given a live price 6000 under id A for the pair
  When id B arrives for the same pair with price 6500
  Then the result is CREATED, A is deleted, and the pair holds one live price, 6500
Scenario: AC-3 An edit
  When the id of a live price arrives with price 7000, then again
  Then the results are UPDATED and UNCHANGED, and the pair did not change
Scenario: AC-4 A merged or deleted variant
  When a price arrives for a variant merged into another, then for a deleted one
  Then the first is written on the surviving variant, and the second brings its variant back off sale
Scenario Outline: AC-5 Nothing written
  When the input is <case>
  Then the result is <result> and the database is unchanged
  Examples:
    | case                                         | result           |
    | a price of 0, or 12.5                        | INVALID `price`  |
    | a relationship of another organization       | NO_RELATIONSHIP  |
    | an unknown variant, or another business's   | NO_VARIANT       |
    | the id of a deleted price                    | GONE             |
    | the id of another business's price           | FOREIGN          |
Scenario: AC-6 Removal
  When `deletePriceFromSync` runs on a live price, then again, then on an unknown id
  Then the answers are DELETED, ALREADY and NOT_FOUND, and the first sets `deleted_at`
```

## Abuse cases
```gherkin
Scenario: AB-1 A price on another business's customer (broken access control)
  When business A sends a price for a relationship of business B
  Then the result is NO_RELATIONSHIP and nothing is written
Scenario: AB-2 Moving a price to another customer (tampering)
  When the id of a live price arrives with another relationship and variant
  Then only the price changes; the pair is as before
```

## Implementation
- Create: `tests/integration/catalog/sync-apply-price.test.ts`
- Modify: `src/modules/catalog/catalog.sync-writers.ts`, `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `applyPriceFromSync(tx: Prisma.TransactionClient, organizationId: string, input: PriceSyncInput, now: Date): Promise<PriceSyncResult>`
  - `deletePriceFromSync(tx: Prisma.TransactionClient, organizationId: string, priceId: string, now: Date): Promise<'DELETED' | 'ALREADY' | 'NOT_FOUND'>`
- Types:
  - `PriceSyncInput = { id: string; relationshipId: string; variantId: string; price: number; setById: string }`
  - `PriceSyncResult = { result: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'GONE' | 'FOREIGN' | 'NO_RELATIONSHIP' | 'NO_VARIANT' | 'INVALID'; invalidFields?: string[] }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: the relationship, the variant and the price are all read through the organization id.
- v5.0.0-15.3.3: on an existing price only `price` is written.
- v5.0.0-2.2.1: the price is checked before any write.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| created | integration | AC-1 | row with variant and product |
| entered twice | integration | AC-2, C-11 | one live price, the last |
| edited | integration | AC-3 | UPDATED, UNCHANGED, same pair |
| variant followed | integration | AC-4 | surviving variant, brought back |
| nothing written | integration | AC-5, C-36 | each Examples row → result |
| removal | integration | AC-6 | DELETED, ALREADY, NOT_FOUND |
| another business | security | AB-1, CWE-639 | NO_RELATIONSHIP |
| pair kept | security | AB-2, CWE-915 | only the price moves |

Command: `npx vitest run tests/integration/catalog/sync-apply-price.test.ts`

## Out of scope
- Judging the line and its role: the synchronization.
