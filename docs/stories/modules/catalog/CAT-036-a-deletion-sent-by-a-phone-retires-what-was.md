---
id: CAT-036
title: A deletion sent by a phone retires what was sold instead
module: catalog
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [CAT-035, CAT-026, ORD-030]
read_first: [src/modules/catalog/catalog.sync-writers.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/productvariant, catalogue/product]
constraints: [C-48, C-45, C-36]
asvs: [v5.0.0-8.2.2, v5.0.0-2.3.3, v5.0.0-15.3.3]
---

# CAT-036 — A deletion sent by a phone retires what was sold instead

## Story
Technical story: give the catalog the functions that delete a variant or a product sent by the owner's phone, taking a variant that was sold off sale instead of deleting it, so that no sale ever loses its article.

## Context
- Exists: the sync writers (CAT-033 to CAT-035); `findUsedVariantIds` (CAT-026), over `listOrderedVariantIds` (ORD-030) and the live negotiated prices.
- `deleteVariantFromSync(tx, organizationId, variantId, now)` and `deleteProductFromSync(tx, organizationId, productId, now)` answer `{ result, retiredLabels }`.
- A used variant (C-48) is not deleted: it becomes INACTIVE, its `variantLabel` goes into `retiredLabels`, the result is `RETIRED`. An unused one gets `deleted_at = now`: `DELETED`.
- The last live variant of a live product, if unused, is kept: `LAST_VARIANT` (C-45); the phone deletes the product instead.
- A product: each live variant is handled as above. No used variant: the product is deleted with them (`DELETED`). Otherwise the product stays, the unused variants are deleted and the result is `RETIRED` with the labels. An already deleted target gives `ALREADY`; an unknown id or one of another organization gives `NOT_FOUND`. Neither writes anything.
- All in the caller's transaction; the product's `server_updated_at` moves with each variant change (CAT-021).
- `C-48`: A variant cited by an order line or a negotiated price is never deleted, only taken off sale (`INACTIVE`); a deletion received for a cited variant becomes a withdrawal from sale, and a line received for a deleted variant restores it, off sale.
- `C-45`: A product that is not deleted has at least one variant that is not deleted; `ProductVariant.organization_id` equals `Product.organization_id`.
- `C-36`: No uniqueness rule makes a sync fail; every possible duplicate has a written behavior, and a line no rule can write is set aside.

## Acceptance criteria
```gherkin
Scenario: AC-1 Never sold
  Given a product with two variants, none cited
  When one is deleted
  Then the result is DELETED and its `deleted_at` is `now`
Scenario Outline: AC-2 Sold, so retired
  Given a variant cited by <use>
  When its deletion is applied
  Then the result is RETIRED with its label, it is INACTIVE and not deleted
  Examples:
    | use                                        |
    | an order line in any state                 |
    | a live negotiated price                    |
Scenario: AC-3 Last variant
  Given a product with one variant, never sold
  When the variant is deleted alone
  Then the result is LAST_VARIANT and nothing changes
Scenario Outline: AC-4 A whole product
  Given a product with three variants, <sold> sold
  When the product's deletion is applied
  Then the result is <result>, <effect>
  Examples:
    | sold | result  | effect                                                                  |
    | one  | RETIRED | the sold one is INACTIVE, the other two are deleted, the product stays |
    | none | DELETED | the product and its variants carry `deleted_at`                         |
Scenario Outline: AC-5 Other answers
  When the target is <target>
  Then the result is <result> and nothing is written
  Examples:
    | target                               | result     |
    | already deleted                      | ALREADY    |
    | unknown, or of another organization  | NOT_FOUND  |
```

## Abuse cases
```gherkin
Scenario: AB-1 Erasing sales history from an old phone (tampering)
  When the deletion of a sold product arrives
  Then every order line still finds its variant and its product
Scenario: AB-2 Deleting another business's article (broken access control)
  When business A sends the id of a variant of business B
  Then the result is NOT_FOUND and B's variant is unchanged
```

## Implementation
- Create: `tests/integration/catalog/sync-delete.test.ts`
- Modify: `src/modules/catalog/catalog.sync-writers.ts`, `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `deleteVariantFromSync(tx: Prisma.TransactionClient, organizationId: string, variantId: string, now: Date): Promise<DeleteSyncResult>`
  - `deleteProductFromSync(tx: Prisma.TransactionClient, organizationId: string, productId: string, now: Date): Promise<DeleteSyncResult>`
- Types:
  - `DeleteSyncResult = { result: 'DELETED' | 'RETIRED' | 'ALREADY' | 'LAST_VARIANT' | 'NOT_FOUND'; retiredLabels: string[] }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: targets are found through the organization id; an id of another business is not found.
- v5.0.0-2.3.3: the use check and the writes run in the caller's transaction.
- v5.0.0-15.3.3: the only change to a retired variant is its status.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| never sold | integration | AC-1 | DELETED, date |
| sold | integration | AC-2, C-48 | each Examples row → RETIRED, INACTIVE |
| last variant | integration | AC-3, C-45 | LAST_VARIANT |
| whole product | integration | AC-4, C-48 | each Examples row → result, states |
| other answers | integration | AC-5, C-36 | each Examples row → result |
| history kept | security | AB-1, CWE-639 | lines intact |
| other business | security | AB-2, CWE-639 | NOT_FOUND, unchanged |

Command: `npx vitest run tests/integration/catalog/sync-delete.test.ts`

## Out of scope
- The information line for the author: the synchronization. Bringing a deleted variant back for a sale: CAT-037.
