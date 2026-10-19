---
id: SYNC-035
title: Products added beyond the plan are paused after a push
module: sync
kind: feature
rev: 1
amends: [SYNC-010]
size: S
risk: medium
depends_on: [SYNC-033, BIL-013, BIL-020]
read_first: [src/modules/sync/sync.judge.ts, src/modules/billing/limits.service.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, catalogue/product]
constraints: [C-46]
asvs: [v5.0.0-2.3.3, v5.0.0-15.3.3]
---

# SYNC-035 — Products added beyond the plan are paused after a push

## Story
As an owner, I want the products I added offline beyond my plan to be paused instead of lost, so that nothing I typed disappears and I can choose what to keep.

## Context
- Exists: `judgeBatch` applies the tables, then the controls on arrival (SYNC-010, SYNC-016); the catalog pushes (SYNC-031 to SYNC-033); `recomputeRights` (BIL-013) and `enforceLimits` (BIL-020), which pauses or resumes products to fit the plan and notifies the owner.
- The judge keeps the set of organizations of every `products` and `product_variants` line it passed (created, updated or deleted). New `sync.limits.ts`: `enforceCatalogLimits(tx, organizationIds, now)` runs, per organization in id order, `recomputeRights` then `enforceLimits`. `judgeBatch` calls it after the last table and before the controls, in the batch's transaction.
- Nothing is refused: the lines stay `accepted`. Which products are paused, and the notice to the owner, belong to billing. A batch without catalog line does not call billing. A replay (SYNC-022) takes the same path.
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`; what arrives in excess through synchronization is paused, never refused.
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.

## Acceptance criteria
```gherkin
Scenario: AC-1 Beyond the plan
  Given a FREE business with 30 products on sale
  When the OWNER pushes 3 new products, each with an ACTIVE variant
  Then the 3 products and their variants are `accepted`, 30 products are on sale, 3 are paused, and the owner receives one `subscription.products_paused` notice
Scenario: AC-2 Within the plan
  When the pushed products fit the plan
  Then none is paused and no notice is sent
Scenario: AC-3 A deletion frees room
  Given one product is paused for lack of room
  When the OWNER's batch deletes a product on sale
  Then the paused product is on sale again
Scenario: AC-4 No catalog line
  When a batch carries only orders
  Then billing is not called
```

## Abuse cases
```gherkin
Scenario: AB-1 A flood of products pushed offline (denial of service, T11)
  When the OWNER of a FREE business pushes 40 new products with variants in one batch
  Then no line is refused, at most 30 products are on sale afterwards, and the rest are paused
```

## Implementation
- Create: `src/modules/sync/sync.limits.ts`, `tests/integration/sync/push-plan-limits.test.ts`
- Modify: `src/modules/sync/sync.judge.ts`
- Pattern: `src/modules/sync/sync.push.ts`
- Signatures:
  - `enforceCatalogLimits(tx: Prisma.TransactionClient, organizationIds: string[], now: Date): Promise<void>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: the pause runs in the transaction of the push, so the catalog and its limit change together.
- v5.0.0-15.3.3: `paused_at` is written by billing only; the phone's value was removed by the judge.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| beyond the plan | integration | AC-1, C-46 | counts, one notice |
| within the plan | integration | AC-2 | nothing paused |
| room freed | integration | AC-3 | resumed |
| no catalog line | integration | AC-4 | billing spied, not called |
| flood | security | AB-1, CWE-770 | no refusal, 30 on sale |

Command: `npx vitest run tests/integration/sync/push-plan-limits.test.ts tests/integration/sync/push-products.test.ts`

## Out of scope
- Choosing which products stay on sale: billing (BIL-020).
- `enforceLimits` also aligns the team seats; a push that changes no rights leaves them as they were.
