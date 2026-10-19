---
id: SYNC-032
title: The owner's phone creates and edits variants
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [SYNC-031, CAT-034, CAT-035]
read_first: [src/modules/sync/adapters/catalog.push.ts, src/modules/catalog/catalog.sync-writers.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, catalogue/productvariant]
constraints: [C-47]
asvs: [v5.0.0-8.2.1, v5.0.0-2.2.1, v5.0.0-15.3.3]
---

# SYNC-032 — The owner's phone creates and edits variants

## Story
As an owner, I want the sizes and prices I enter without network to reach the server, so that a size added twice by two people never blocks my phone.

## Context
- Exists: the judge passes the OWNER's `product_variants` lines with the organization of the product (SYNC-030); `pushProducts` (SYNC-031); `applyVariantFromSync` and its results (CAT-034, CAT-035); the `product_variants` adapter, which refuses every push (SYNC-024).
- `pushVariants(ctx, change)` in `catalog.push.ts`; a created or updated row goes through `applyVariantFromSync(tx, organization_id, { id, productId, name, unit, price, minOrderQuantity, status }, now)`; `min_order_quantity` is the decimal text of the wire. A value of the wrong type is `aside` `INVALID` before the writer.
- Outcomes: CREATED, UPDATED, UNCHANGED are `accepted`. MERGED is an `issue` `MERGED` carrying `mergedInto`, with the message "<label> ajouté deux fois : variantes réunies" (design 3.2). COLLISION is `aside` `VARIANT_EXISTS`; NO_PRODUCT, GONE and INVALID are `aside` with their code; FOREIGN is `forbidden` `OUT_OF_SCOPE`.
- `merged_into_id`, `price_updated_at` and the photos are not read from the row. The product's `server_updated_at` moves with the variant (CM-42, CAT-021), so the product travels with it.
- `C-47`: Two variants of one product that are not deleted never share both the same simplified name and unit; `merged_into_id` set implies the variant is deleted.
- `C-47`: Two variants of one product that are not deleted never share both the same simplified name and the same simplified unit (capitals and extra spaces ignored, an empty name counts as empty text); `merged_into_id` set implies the variant is deleted.

## Acceptance criteria
```gherkin
Scenario: AC-1 A new variant
  When the OWNER pushes a variant "sac 10 kg" at 15000 for a product of the business
  Then it is stored with that price, a price date set by the server, and the line is `accepted`
Scenario: AC-2 An edit
  When the OWNER pushes a new price for it
  Then the price and its date change; a name or unit change keeps the product
Scenario: AC-3 Created twice
  Given a manager added "sac 10 kg" online meanwhile
  When the OWNER pushes the same variant under a new id
  Then the line is an `issue` `MERGED` with `mergedInto` the first variant and the message above, and the first keeps its price
Scenario: AC-4 Lines that cannot be written
  When a variant has price 0, or an edit makes a twin, or names a deleted product
  Then each is `aside` (`INVALID`, `VARIANT_EXISTS`, `NO_PRODUCT`), nothing is stored and the rest of the batch passes
```

## Abuse cases
```gherkin
Scenario: AB-1 A variant slipped into another business's product (horizontal)
  When the OWNER of A pushes a variant whose `product_id` is a product of B
  Then the line is forbidden `OUT_OF_SCOPE` and B's catalog is unchanged
```

## Implementation
- Create: `tests/integration/sync/push-variants.test.ts`
- Modify: `src/modules/sync/adapters/catalog.adapter.ts`, `src/modules/sync/adapters/catalog.push.ts`
- Pattern: `src/modules/sync/sync.push.ts`
- Signatures:
  - `pushVariants(ctx: PushContext, change: TableChange): Promise<LineOutcome[]>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.1: the organization is the judge's; the writer finds the product and any existing variant through it.
- v5.0.0-2.2.1: price, minimum, unit and status are checked before any write.
- v5.0.0-15.3.3: five fields and the product id are read; the merge link, the price date and the photos have no way in.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| new variant | integration | AC-1 | row, price date |
| edit | integration | AC-2 | price and date |
| twice | integration | AC-3, C-47 | issue, mergedInto, first kept |
| not writable | integration | AC-4 | three asides, rest passes |
| other business | security | AB-1, CWE-639 | forbidden, B unchanged |

Command: `npx vitest run tests/integration/sync/push-variants.test.ts tests/integration/sync/push-products.test.ts`

## Out of scope
- Deletions: SYNC-033. Pausing the excess products: SYNC-035.
- A line that sends several variants of one new product at once is judged in table order: the product first.
