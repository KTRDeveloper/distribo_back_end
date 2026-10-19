---
id: SYNC-028
title: Controls on arrival and the list to resolve read the variant
module: sync
kind: technical
rev: 1
amends: [SYNC-016, SYNC-020]
size: S
risk: medium
depends_on: [SYNC-016, SYNC-020, CAT-017, ORD-025]
read_first: [src/modules/sync/sync.controls.ts, src/modules/sync/sync.repository.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne]
constraints: [CM-27]
asvs: [v5.0.0-2.3.1, v5.0.0-8.2.2]
---

# SYNC-028 — Controls on arrival and the list to resolve read the variant

## Story
Technical story: make the price control and the owner's list of orders to review look at each line's variant, so that a price change on one size never flags a line of another.

## Context
- Exists: `priceControl` in `sync.controls.ts` reads `tx.product` for the status of the products on an order's lines and calls `getReferencePrice(tx, relationshipId, line.productId)`; `findFlaggedOrders` in `sync.repository.ts` does the same for a `PRICE_CHANGED` order (SYNC-016, SYNC-020). Lines now hold `product_variant_id` (ORD-025).
- Both read `line.productVariantId` instead of `line.productId`, and `getReferencePrice(tx, relationshipId, variantId)` (CAT-017).
- A line is retired when its variant is not ACTIVE or is deleted, or when its product is paused or deleted: `priceControl` reads `tx.productVariant` with its product and adds no `PRICE_CHANGED` part for it, as before.
- The part still names the line by `labelApplied`, so two sizes of a product are told apart.
- `CM-27`: the phone's reference price is ignored and recomputed from the server's price for the variant.
- `CM-27`: Sync: computed fields (balance, amount_held, balance_effect, totals, line amounts, sale amount, customer-order reference price, price_updated_at, credit_limit_set_at, ended_by_party, last_synced_at, scope_version, server_updated_at) are ignored on receipt and recomputed (design lines 862, annex A.1)

## Acceptance criteria
```gherkin
Scenario: AC-1 A price that moved
  Given an order entered offline with a line on the variant "sac 10 kg" at 15000, and that price moved to 15500 after the order was entered
  When the batch arrives
  Then the order's `sync_issue` starts with `PRICE_CHANGED:` and names that line with the old and the new price
Scenario: AC-2 Another size
  Given the price of the product's other variant moved, not the sold one
  Then the order is not flagged
Scenario: AC-3 A false reference price
  Given the phone's reference price is 14000 while the variant has stood at 15000 since before the order
  Then the line's reference price is 15000 and the gap against the applied price shows
Scenario: AC-4 A withdrawn variant
  Given the sold variant is INACTIVE and its price also moved
  Then the order has no `PRICE_CHANGED` part
Scenario: AC-5 The list to resolve
  When the owner opens the flagged orders of a `PRICE_CHANGED` order
  Then each line shows the current price of its own variant
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/sync/controls-by-variant.test.ts`
- Modify: `src/modules/sync/sync.controls.ts`, `src/modules/sync/sync.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.1: the server's price decides, not the phone's, per variant.
- v5.0.0-8.2.2: the flagged orders are those of the caller's organization, as before.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| moved | integration | AC-1 | PRICE_CHANGED names the line |
| other size | integration | AC-2 | not flagged |
| false reference | integration | AC-3, CM-27 | corrected to 15000 |
| withdrawn | integration | AC-4 | no part |
| list | integration | AC-5 | current price of the variant |

Command: `npx vitest run tests/integration/sync/controls-by-variant.test.ts tests/integration/sync/controls-prices.test.ts tests/integration/sync/exceptions.test.ts`

## Out of scope
- The wording of the other controls and the credit control: unchanged.
