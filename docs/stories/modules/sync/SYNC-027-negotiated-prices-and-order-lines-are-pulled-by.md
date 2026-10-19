---
id: SYNC-027
title: Negotiated prices and order lines are pulled by variant
module: sync
kind: change
rev: 1
amends: [SYNC-004]
size: S
risk: medium
depends_on: [SYNC-004, CAT-015, ORD-028]
read_first: [src/modules/sync/adapters/relationship.adapter.ts, tests/integration/sync/pull-relationships.test.ts]
design_refs: [relations-commerciales/customerprice, synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone]
constraints: [C-35]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# SYNC-027 — Negotiated prices and order lines are pulled by variant

## Story
As a seller, I want my phone to receive each negotiated price and each order line against its variant, so that the right size is sold at the right price offline.

## Context
- Exists: `customer_prices` rows carry `product_id` (SYNC-004); negotiated prices name a variant (CAT-015); order lines are built from `OrderLineView`, which says `product_variant_id` (ORD-028).
- `customerPricesAdapter` sends `product_variant_id` and no `product_id`. Scope and incremental rules do not change.
- `order_lines` rows already spread the ORD-028 view, so they carry `product_variant_id`; a test pins the name on the wire, which is the contract with the phone, for the supplier's team and for the customer.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 A price by variant
  Given a negotiated price of 4500 for the variant "sac 10 kg"
  When the OWNER, a SELLER and the customer pull
  Then the row has `product_variant_id`, `price` and `customer_relationship_id`, and no `product_id`
Scenario: AC-2 A line by variant
  Given an order with a line on that variant
  When the SELLER and the customer pull
  Then the `order_lines` row has `product_variant_id` and no `product_id`
Scenario: AC-3 A deleted price
  When a price is deleted after the last pull
  Then its id is in `deleted`
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/sync/pull-by-variant.test.ts`
- Modify: `src/modules/sync/adapters/relationship.adapter.ts`
- Pattern: `src/modules/sync/sync.changes.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: scope is unchanged: the team's relationships and the customer's own.
- v5.0.0-15.3.1: the old name is not sent next to the new one.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| price by variant | integration | AC-1 | product_variant_id, no product_id |
| line by variant | integration | AC-2 | product_variant_id, no product_id |
| deleted price | integration | AC-3, C-35 | id in deleted |

Command: `npx vitest run tests/integration/sync/pull-by-variant.test.ts tests/integration/sync/pull-relationships.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/pull-relationships.test.ts | the customer prices test expects `product_id: PRODUCT` | it expects `product_variant_id: PRODUCT`, the variant that has the product's id |

## Out of scope
- Pushes of prices: SYNC-034. Pushes of lines: SYNC-029.
