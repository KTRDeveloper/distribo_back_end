---
id: SYNC-025
title: A driver pull names variants without prices
module: sync
kind: change
rev: 1
amends: [SYNC-005]
size: S
risk: medium
depends_on: [SYNC-024]
read_first: [src/modules/sync/adapters/catalog.adapter.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, catalogue/productvariant]
constraints: [CM-30]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# SYNC-025 — A driver pull names variants without prices

## Story
As a driver, I want my phone to hold the names and units of what I deliver, so that I can read an order without knowing its prices.

## Context
- Exists: the driver branch of `products` (SYNC-005): the products named by lines of orders the driver may see, as `id, name, unit`; `product_variants` for the team (SYNC-024); lines name a variant (ORD-026).
- The scope walks from the line to its variant and to the variant's product. For a driver, `products` rows are `id, name`, and `product_variants` rows are `id, product_id, name, unit`. No price, minimum, status, photo or `paused_at`.
- A variant stays on the driver's phone when it is `INACTIVE` or its product is paused: the order still names it. A variant that no visible line names is not sent.
- Incremental pulls keep the rule of SYNC-005: a variant and its product are sent when they changed, or when a visible line naming them, or its order, changed. A deleted variant is announced by id if some line still names it.
- `CM-30`: Sync pull returns only what the user may see; a driver receives, per customer, only the available credit instead of balance and limit; the phone keeps all customers, the catalog, open orders and the last 90 days of the rest.

## Acceptance criteria
```gherkin
Scenario: AC-1 Names only
  Given a confirmed order with a delivery address whose line names the variant "sac 10 kg", and another variant of the product on no order
  When the DRIVER of the business pulls
  Then `products` holds `id` and `name` of the product, and `product_variants` holds only "sac 10 kg" with `id`, `product_id`, `name` and `unit`
Scenario: AC-2 Withdrawn or paused
  Given that variant is INACTIVE and its product paused
  Then both still arrive, with the same columns
Scenario: AC-3 Newly visible
  When a line naming an unchanged variant appears on an order after the last pull
  Then the variant and its product arrive on the incremental pull
Scenario: AC-4 Not on a visible order
  Given the only order naming a variant is DELIVERED
  Then the variant and its product are not sent
```

## Abuse cases
```gherkin
Scenario: AB-1 A driver reads the price list (information disclosure)
  When a DRIVER pulls
  Then no row carries `price`, `min_order_quantity`, `status`, `image_urls` or `paused_at`
```

## Implementation
- Modify: `src/modules/sync/adapters/catalog.adapter.ts`
- Pattern: `src/modules/sync/sync.changes.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: only variants named by lines of orders the driver may see, in the businesses where they are a driver.
- v5.0.0-15.3.1: four columns for a variant, two for a product.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| names only | integration | AC-1, CM-30 | columns and scope |
| withdrawn | integration | AC-2 | still sent |
| newly visible | integration | AC-3 | sent while unchanged |
| delivered | integration | AC-4 | not sent |
| no prices | security | AB-1, CWE-213 | forbidden keys absent |

Command: `npx vitest run tests/integration/sync/pull-catalog.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/pull-catalog.test.ts | the two driver tests expect id, name and unit on the product | the product has id and name, and its variant in product_variants has id, product_id, name and unit |

## Out of scope
- Which orders a driver may see: SYNC-006 and SYNC-040.
