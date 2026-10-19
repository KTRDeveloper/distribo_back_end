---
id: SYNC-026
title: A customer pull holds the supplier's articles on sale
module: sync
kind: change
rev: 1
amends: [SYNC-005]
size: M
risk: high
depends_on: [SYNC-024]
read_first: [src/modules/sync/adapters/catalog.adapter.ts, src/modules/sync/adapters/relationship.adapter.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, catalogue/product]
constraints: [CM-42, C-46]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# SYNC-026 — A customer pull holds the supplier's articles on sale

## Story
As a customer, I want my phone to hold my suppliers' articles on sale, so that I can build an order offline.

## Context
- Exists: customers receive no product row (SYNC-005 AC-3, now reversed: design 9.6 gives a customer the catalog of the suppliers they buy from); a customer's own relationships (SYNC-004); online browsing (CAT-028).
- A customer person receives the catalog of each supplier of whom they hold a live relationship (ACTIVE, not deleted, not merged) with an ACTIVE business. `products`: `id, organization_id, name, description, category, image_urls`. `product_variants`: ACTIVE ones only, `id, product_id, organization_id, name, unit, price, min_order_quantity, image_urls`; the negotiated price comes with `customer_prices` (SYNC-027).
- A product is sent only while it is not deleted, not paused, and has an ACTIVE variant (C-46).
- A product and its variants travel together (CM-42): on an incremental pull, a product whose variant came back on sale arrives with its variants. A product, or a variant, that changed and is no longer on sale is announced in `deleted`, so the phone drops it.
- `CM-42`: Every insert or update of a `ProductVariant` also sets `server_updated_at` of its product to the database time, so that a product and its variants always travel together to the phones.
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.

## Acceptance criteria
```gherkin
Scenario: AC-1 The catalog on sale
  Given a supplier with a product of two ACTIVE variants and one INACTIVE
  When a customer with a live relationship pulls
  Then `products` holds the product and `product_variants` holds the two ACTIVE variants, with price and minimum
Scenario Outline: AC-2 Left out
  When the supplier has <case>
  Then nothing of it is sent
  Examples:
    | case                                              |
    | a paused product                                  |
    | a product whose variants are all INACTIVE         |
    | a deleted product                                 |
    | a SUSPENDED business                              |
    | a CLOSED relationship with the customer           |
Scenario: AC-3 Back on sale
  When the only variant of a product returns to ACTIVE after the last pull
  Then the product and the variant arrive on the incremental pull
Scenario: AC-4 No longer on sale
  When the last ACTIVE variant is withdrawn, or the product paused, after the last pull
  Then the ids of the product and of its variants are in `deleted`
```

## Abuse cases
```gherkin
Scenario: AB-1 A supplier the customer does not buy from (horizontal)
  When a customer pulls
  Then no product of a business with which they have no live relationship arrives, nor any `image_keys`, `paused_at`, `status` or INACTIVE variant
```

## Implementation
- Create: `tests/integration/sync/pull-customer-catalog.test.ts`
- Modify: `src/modules/sync/adapters/catalog.adapter.ts`
- Pattern: `src/modules/sync/sync.changes.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: the scope is the viewer's own relationships and the supplier's status, never an id sent by the phone.
- v5.0.0-15.3.1: explicit columns; nothing a supplier keeps private (pause date, withdrawn variants, photo keys).

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| on sale | integration | AC-1 | product and two variants |
| left out | integration | AC-2, C-46 | each Examples row → none |
| back on sale | integration | AC-3, CM-42 | product and variant sent |
| no longer on sale | integration | AC-4 | ids in deleted |
| other supplier | security | AB-1, WSTG-ATHZ-04 | none |

Command: `npx vitest run tests/integration/sync/pull-customer-catalog.test.ts tests/integration/sync/pull-catalog.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/pull-catalog.test.ts | the customer test expects no product row, but that customer has a live relationship with a business that has products | the customer receives the products on sale and their ACTIVE variants |

## Out of scope
- A customer that is an organization: its members do not pull a supplier's catalog yet (open question).
