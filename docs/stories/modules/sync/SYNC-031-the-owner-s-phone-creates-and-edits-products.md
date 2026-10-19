---
id: SYNC-031
title: The owner's phone creates and edits products
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [SYNC-030, CAT-033]
read_first: [src/modules/sync/adapters/catalog.adapter.ts, src/modules/catalog/catalog.sync-writers.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, catalogue/product]
constraints: [C-46]
asvs: [v5.0.0-8.2.1, v5.0.0-2.2.1, v5.0.0-15.3.3]
---

# SYNC-031 — The owner's phone creates and edits products

## Story
As an owner, I want the products I create or edit without network to reach the server, so that my catalog is the same on every phone.

## Context
- Exists: the judge passes the OWNER's `products` lines with the scope's `organization_id` (SYNC-030); `applyProductFromSync` and its results (CAT-033); the `products` adapter, which refuses every push (SYNC-024).
- New `adapters/catalog.push.ts` with `pushProducts(ctx, change)`; the `products` adapter calls it instead of refusing. A created and an updated row go through `applyProductFromSync(tx, organization_id, { id, name, description, category }, now)`; the other columns of the row are not read.
- Outcomes: CREATED, UPDATED, UNCHANGED are `accepted`; INVALID and GONE are `aside` with the code of the result and the field names only; FOREIGN is `forbidden` `OUT_OF_SCOPE`. Products are deleted by SYNC-033: a line in `deleted` is `aside` until then.
- A product with no variant is not on sale and is not pulled by a customer (SYNC-026); its variants follow in SYNC-032.
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.

## Acceptance criteria
```gherkin
Scenario: AC-1 A new product
  When the OWNER pushes a created product "Riz parfumé" with a description and a category
  Then it is stored in the business with an empty unit, no pause and no photo, and the line is `accepted`
Scenario: AC-2 An edit
  When the OWNER pushes an updated name
  Then the name changes and a repeat of the same row changes nothing
Scenario: AC-3 Fields the server owns
  When a row also carries `paused_at`, `image_keys`, `unit` and `price`
  Then none of them is written
Scenario: AC-4 A row that cannot be written
  When the name has 101 characters
  Then that line is `aside` `INVALID`, nothing is stored and the other lines of the batch pass
```

## Abuse cases
```gherkin
Scenario: AB-1 A product of another business (horizontal)
  When the OWNER of A pushes an update whose id is a product of B
  Then the line is forbidden `OUT_OF_SCOPE` and B's product is unchanged
```

## Implementation
- Create: `src/modules/sync/adapters/catalog.push.ts`, `tests/integration/sync/push-products.test.ts`
- Modify: `src/modules/sync/adapters/catalog.adapter.ts`
- Pattern: `src/modules/sync/sync.push.ts`
- Signatures:
  - `pushProducts(ctx: PushContext, change: TableChange): Promise<LineOutcome[]>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.1: the organization is the judge's, never the row's; the writer finds an existing product through it.
- v5.0.0-2.2.1: name, description and category are checked by the writer before any write.
- v5.0.0-15.3.3: only four fields are read from the row.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| new product | integration | AC-1 | stored row, outcome |
| edit | integration | AC-2 | name, repeat unchanged |
| server fields | integration | AC-3, C-46 | paused_at, image_keys, unit, price untouched |
| invalid name | integration | AC-4 | aside, rest passes |
| other business | security | AB-1, CWE-639 | forbidden, B unchanged |

Command: `npx vitest run tests/integration/sync/push-products.test.ts tests/integration/sync/push-envelope.test.ts`

## Out of scope
- Variants, deletions and prices: SYNC-032 to SYNC-034. Pausing the excess: SYNC-035.
