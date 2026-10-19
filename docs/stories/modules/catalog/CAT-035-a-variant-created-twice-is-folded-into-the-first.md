---
id: CAT-035
title: A variant created twice is folded into the first
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [CAT-034]
read_first: [src/modules/catalog/catalog.sync-writers.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/productvariant]
constraints: [C-47, C-36]
asvs: [v5.0.0-15.3.3, v5.0.0-8.2.2]
---

# CAT-035 — A variant created twice is folded into the first

## Story
Technical story: make a variant that arrives as a duplicate of a live one fold into it, so that a second phone never blocks a batch and keeps its sales.

## Context
- Exists: `applyVariantFromSync`, which answers `COLLISION` for any live twin (CAT-034); `variantLabel` (CAT-016).
- Change: an unknown id whose product has a live twin (C-47) is stored at once as a deleted row (`deleted_at = now`) with `merged_into_id` set to the twin, so it never meets the unique index. The result is `MERGED` with `mergedInto` and the twin's `label`. The twin keeps its price, photos, minimum and status.
- The same id sent again finds the stored merged row and answers `MERGED` again with nothing new written. An edit that would make a twin stays `COLLISION`.
- The same text in another product, or against a deleted variant, is no twin: the variant is CREATED.
- `ProductVariant` fields: `merged_into_id` FK → ProductVariant, nullable
- `C-47`: Two variants of one product that are not deleted never share both the same simplified name and the same simplified unit (capitals and extra spaces ignored, an empty name counts as empty text); `merged_into_id` set implies the variant is deleted.
- `C-36`: No uniqueness rule makes a sync fail; every possible duplicate has a written behavior, and a line no rule can write is set aside.

## Acceptance criteria
```gherkin
Scenario: AC-1 Created twice
  Given a live variant "Sac 10 kg" of a product
  When an unknown id arrives for the same product with name empty and unit "sac 10 kg "
  Then the result is MERGED with the first id and its label, and the new row is deleted with `merged_into_id` set
Scenario: AC-2 The first keeps its settings
  Given the first has price 3000 and status INACTIVE
  When the duplicate arrives with price 2500 and status ACTIVE
  Then the first still has price 3000 and INACTIVE
Scenario: AC-3 The same row again
  When the duplicate's id is sent a second time
  Then the answer is MERGED again and one stored row exists for it
Scenario Outline: AC-4 Not a twin
  When an unknown id arrives with the text of <other>
  Then the result is CREATED
  Examples:
    | other                                   |
    | a live variant of another product       |
    | a deleted variant of the same product   |
Scenario: AC-5 An edit stays refused
  When an edit would give a live variant the text of another
  Then the result is COLLISION
```

## Abuse cases
```gherkin
Scenario: AB-1 Two phones add the same variant (denial of service)
  When two batches carry the same variant text for one product
  Then both applications succeed, one CREATED and one MERGED
Scenario: AB-2 A merge link chosen by the phone (tampering)
  When the input carries `merged_into_id` of a variant of another business
  Then it is ignored and the link points to the live twin only
```

## Implementation
- Create: `tests/integration/catalog/sync-merge-variant.test.ts`
- Modify: `src/modules/catalog/catalog.sync-writers.ts`, `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `insertMergedVariant(tx: Prisma.TransactionClient, input: VariantSyncInput, organizationId: string, twinId: string, now: Date): Promise<void>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-15.3.3: the link is written by the server from its own search, never from the row.
- v5.0.0-8.2.2: the twin is searched inside the organization's product.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| merged | integration | AC-1, C-47 | MERGED, deleted row, link |
| first kept | integration | AC-2 | price and status unchanged |
| repeat | integration | AC-3, C-36 | MERGED again, one row |
| not a twin | integration | AC-4 | each Examples row → CREATED |
| edit refused | integration | AC-5 | COLLISION |
| two phones | security | AB-1, CWE-400 | CREATED then MERGED |
| forged link | security | AB-2, CWE-915 | link ignored |

Command: `npx vitest run tests/integration/catalog/sync-merge-variant.test.ts tests/integration/catalog/sync-apply-variant.test.ts`

## Out of scope
- Pointing the order lines and negotiated prices that cite the merged variant to the first: CAT-037.
- The information line: the synchronization.
