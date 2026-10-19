---
id: SYNC-029
title: An order line entered offline names a variant
module: sync
kind: change
rev: 1
amends: [SYNC-012]
size: M
risk: medium
depends_on: [SYNC-012, CAT-037, ORD-026]
read_first: [src/modules/sync/adapters/order.push.ts, src/modules/catalog/catalog.sync-writers.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, catalogue/productvariant]
constraints: [C-48, CM-27]
asvs: [v5.0.0-8.2.1, v5.0.0-2.2.1]
---

# SYNC-029 — An order line entered offline names a variant

## Story
As a seller, I want an order I entered offline to arrive with the size I sold, so that the sale is kept even if that size was merged or withdrawn meanwhile.

## Context
- Exists: `createLine` in `order.push.ts` reads `product_id`, reads the product, labels the line `<name> (<unit>)`, stores a withdrawn article's line with `PRODUCT_RETIRED` and flags the order; `resolveVariantForLine` (CAT-037); the line rule that honors `distribo.allow_retired_product` (ORD-026).
- A pushed line carries `product_variant_id`; the old key is no longer read (a line without it is invalid, set aside as any malformed line). `createLine` calls `resolveVariantForLine(tx, supplier, id, now)`: `null` is `OUT_OF_SCOPE` (forbidden). Else the line stores `productVariantId`, the variant's `productId` and the label given back; a merged variant puts the line on the surviving one, a deleted one is brought back off sale (C-48).
- The line is retired when the variant read after that is not ACTIVE or its product is paused; the issue code stays `PRODUCT_RETIRED` and the order's note becomes "Produit retiré de la vente depuis la saisie" (design 9.2).
- `CM-27`: the amount is computed here; the label comes from the server.
- `C-48`: A variant cited by an order line or a negotiated price is never deleted, only taken off sale (`INACTIVE`); a deletion received for a cited variant becomes a withdrawal from sale, and a line received for a deleted variant restores it, off sale.
- `CM-27`: Sync: computed fields (balance, amount_held, balance_effect, totals, line amounts, sale amount, customer-order reference price, price_updated_at, credit_limit_set_at, ended_by_party, last_synced_at, scope_version, server_updated_at) are ignored on receipt and recomputed (design lines 862, annex A.1)

## Acceptance criteria
```gherkin
Scenario: AC-1 A line by variant
  When a seller sends a line for the variant "sac 10 kg" of "Riz parfumé"
  Then it is stored with that variant, its product, the label "Riz parfumé — sac 10 kg" and the computed amount
Scenario: AC-2 A merged variant
  When the line names a variant merged into another
  Then it is stored on the surviving variant
Scenario: AC-3 A withdrawn variant
  Given the variant is INACTIVE
  Then the line is stored, its outcome is `issue` `PRODUCT_RETIRED`, and the order's `sync_issue` is "Produit retiré de la vente depuis la saisie"
Scenario: AC-4 A deleted variant
  When the line names a deleted variant
  Then the variant comes back INACTIVE, the line is stored with the same issue
Scenario: AC-5 The old key
  When a line sends `product_id` and no `product_variant_id`
  Then it is set aside as malformed and nothing is stored
```

## Abuse cases
```gherkin
Scenario: AB-1 A variant of another business (horizontal)
  When a seller of A sends a line naming a variant of B, deleted or not
  Then the outcome is forbidden `OUT_OF_SCOPE`, nothing is written and the variant of B is not restored
```

## Implementation
- Create: `tests/integration/sync/push-lines-by-variant.test.ts`
- Modify: `src/modules/sync/adapters/order.push.ts`
- Pattern: `src/modules/sync/sync.push.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.1: the resolver is given the supplier of the order, so a foreign variant is never read, restored or written.
- v5.0.0-2.2.1: the key must be a UUID; quantity and prices go through the existing readers.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| by variant | integration | AC-1, CM-27 | variant, product, label, amount |
| merged | integration | AC-2 | surviving variant |
| withdrawn | integration | AC-3 | issue and note |
| deleted | integration | AC-4, C-48 | restored INACTIVE |
| old key | integration | AC-5 | set aside |
| other business | security | AB-1, CWE-639 | forbidden, B untouched |

Command: `npx vitest run tests/integration/sync/push-lines-by-variant.test.ts tests/integration/sync/push-orders.test.ts tests/integration/sync/push-closing.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/push-orders.test.ts | the line rows send `product_id`, and the note text is 'Article retiré de la vente depuis la saisie' | they send `product_variant_id` with the same ids; the note is 'Produit retiré de la vente depuis la saisie' |
| tests/integration/sync/push-closing.test.ts | the line rows send `product_id` | they send `product_variant_id` with the same id |
| tests/integration/sync/controls-credit.test.ts | the line rows send `product_id` | they send `product_variant_id` with the same id |
| tests/integration/sync/controls-prices.test.ts | the line rows send `product_id` | they send `product_variant_id` with the same id |
| tests/integration/sync/forbidden-sends.test.ts | the line rows send `product_id` | they send `product_variant_id` with the same id |
| tests/integration/sync/rights-change.test.ts | the line rows send `product_id` | they send `product_variant_id` with the same id |
| tests/integration/sync/replay.test.ts | the line rows send `product_id` | they send `product_variant_id` with the same id |

## Out of scope
- Edits and deletions of lines: refused as before (SYNC-013).
