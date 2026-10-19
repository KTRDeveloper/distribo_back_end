---
id: SYNC-034
title: The owner's phone sets and removes negotiated prices
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [SYNC-030, SYNC-027, CAT-039]
read_first: [src/modules/sync/adapters/relationship.adapter.ts, src/modules/catalog/catalog.sync-writers.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, relations-commerciales/customerprice]
constraints: [C-11]
asvs: [v5.0.0-8.2.1, v5.0.0-2.2.1, v5.0.0-15.3.3]
---

# SYNC-034 — The owner's phone sets and removes negotiated prices

## Story
As an owner, I want the prices I negotiate without network to reach the server, so that my customers are charged the agreed price.

## Context
- Exists: the judge passes the OWNER's `customer_prices` lines with the supplier of the relationship as `organization_id`, and sets `set_by_id` on a create (SYNC-030); `applyPriceFromSync` and `deletePriceFromSync` (CAT-039); the `customer_prices` adapter, which refuses every push (SYNC-004).
- New `adapters/price.push.ts`, `pushPrices(ctx, change)`; the adapter calls it. A created or updated row goes through `applyPriceFromSync(tx, organization_id, { id, relationshipId, variantId, price, setById }, now)` with `setById` the viewer's id, never the row's. A deleted id goes through `deletePriceFromSync`.
- Outcomes: CREATED, UPDATED, UNCHANGED, DELETED, ALREADY are `accepted`. NO_RELATIONSHIP, NO_VARIANT, GONE, NOT_FOUND and INVALID are `aside` with their code. FOREIGN is `forbidden` `OUT_OF_SCOPE`.
- The same pair entered on two phones is not a failure: the last arrival replaces the first (CAT-039). A relationship merged earlier in the batch is already redirected by the judge (SYNC-011).
- `C-11`: `CustomerPrice` is unique per (relationship, variant) among rows not deleted; the variant belongs to the supplier of the relationship.
- `C-11`: `CustomerPrice` is unique per (relationship, variant) among rows not deleted; the variant belongs to the supplier of the relationship.

## Acceptance criteria
```gherkin
Scenario: AC-1 A new price
  When the OWNER pushes a price 6000 for a customer and a variant of the business
  Then it is stored for that pair, `set_by_id` is the OWNER, and the line is `accepted`
Scenario: AC-2 Entered on two phones
  Given another price for the same pair arrived under another id
  When this one arrives
  Then one live price remains, with the later value
Scenario: AC-3 A change and a removal
  When the OWNER pushes a new value for a price, then its deletion, twice
  Then the value changes, the price is deleted, and the repeat is `accepted` with no change
Scenario: AC-4 Lines that cannot be written
  When a price is 0, or names a relationship that is deleted, or a variant of another business
  Then each is `aside` with its code, nothing is stored and the rest of the batch passes
```

## Abuse cases
```gherkin
Scenario: AB-1 A price on another supplier's customer (horizontal)
  When the OWNER of A pushes a price for a relationship of B, or deletes a price of B
  Then the line is forbidden `OUT_OF_SCOPE` and B's prices are unchanged
```

## Implementation
- Create: `src/modules/sync/adapters/price.push.ts`, `tests/integration/sync/push-prices.test.ts`
- Modify: `src/modules/sync/adapters/relationship.adapter.ts`
- Pattern: `src/modules/sync/sync.push.ts`
- Signatures:
  - `pushPrices(ctx: PushContext, change: TableChange): Promise<LineOutcome[]>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.1: the organization is the judge's; the writer finds the relationship, the variant and any existing price through it.
- v5.0.0-2.2.1: the price is an integer of at least 1, checked before any write.
- v5.0.0-15.3.3: the author is the session's person; the pair of an existing price never changes.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| new price | integration | AC-1 | row, author |
| two phones | integration | AC-2, C-11 | one live price, later value |
| change and removal | integration | AC-3 | value, deletion, repeat |
| not writable | integration | AC-4 | three asides, rest passes |
| other supplier | security | AB-1, CWE-639 | forbidden, B unchanged |

Command: `npx vitest run tests/integration/sync/push-prices.test.ts tests/integration/sync/pull-relationships.test.ts`

## Out of scope
- A price set by sync raises no notice to the customer.
- A price for a deleted variant brings the variant back off sale (CAT-037).
