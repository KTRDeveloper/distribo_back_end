---
id: SYNC-033
title: The owner's phone deletes variants and products
module: sync
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [SYNC-032, CAT-036]
read_first: [src/modules/sync/adapters/catalog.push.ts, src/modules/catalog/catalog.sync-writers.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, catalogue/productvariant]
constraints: [C-48]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3]
---

# SYNC-033 — The owner's phone deletes variants and products

## Story
As an owner, I want a deletion made without network never to erase a size that was sold meanwhile, so that no sale loses its product.

## Context
- Exists: the judge passes the OWNER's deletions after the `delete` right and the scope (SYNC-030); `deleteVariantFromSync` and `deleteProductFromSync` with `{ result, retiredLabels }` (CAT-036); `pushProducts`, `pushVariants`.
- Both pushes handle `deleted` after created and updated rows, calling the writer with the judge's organization. Outcomes: DELETED and ALREADY are `accepted`; RETIRED is an `issue` `RETIRED_INSTEAD` with, for each label, "<label>, vendu entre-temps : retiré de la vente au lieu d'être supprimé" (design 3.2); LAST_VARIANT and NOT_FOUND are `aside` with their code.
- Products run before variants: a product deleted with its variants leaves the variants' own deletions as ALREADY.
- `C-48`: A variant cited by an order line or a negotiated price is never deleted, only taken off sale (`INACTIVE`); a deletion received for a cited variant becomes a withdrawal from sale.
- `C-48`: A variant cited by an order line or a negotiated price is never deleted, only taken off sale (`INACTIVE`); a deletion received for a cited variant becomes a withdrawal from sale, and a line received for a deleted variant restores it, off sale.

## Acceptance criteria
```gherkin
Scenario: AC-1 An unused variant
  When the OWNER deletes a variant no line or price cites
  Then it is deleted and the line is `accepted`
Scenario: AC-2 A variant sold meanwhile
  Given another phone's sale cites the variant
  When the OWNER's deletion arrives
  Then the variant is INACTIVE, not deleted, and the line is an `issue` `RETIRED_INSTEAD` with the message above
Scenario: AC-3 A whole product
  When the OWNER deletes a product whose variants include a cited one
  Then the cited variant is INACTIVE, the others are deleted, the product stays and the issue names the cited label
Scenario: AC-4 Sent again
  When the same deletion arrives twice
  Then both lines are `accepted` and nothing changes the second time
```

## Abuse cases
```gherkin
Scenario: AB-1 Deleting another business's variant (horizontal)
  When the OWNER of A deletes a variant id of B
  Then the line is forbidden `OUT_OF_SCOPE` and B's variant is unchanged
```

## Implementation
- Create: `tests/integration/sync/push-catalog-deletions.test.ts`
- Modify: `src/modules/sync/adapters/catalog.push.ts`
- Pattern: `src/modules/sync/sync.push.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.1: the judge checks scope and the `delete` right; the writer receives the judge's organization.
- v5.0.0-2.3.3: the deletions of one push share its transaction, so a failure leaves the catalog as it was.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| unused | integration | AC-1 | deleted_at set |
| sold meanwhile | integration | AC-2, C-48 | INACTIVE, issue text |
| whole product | integration | AC-3, C-48 | mixed result |
| twice | integration | AC-4 | accepted twice |
| other business | security | AB-1, CWE-639 | forbidden, B unchanged |

Command: `npx vitest run tests/integration/sync/push-catalog-deletions.test.ts tests/integration/sync/push-variants.test.ts`

## Out of scope
- `LAST_VARIANT` is set aside: the phone deletes the product instead.
