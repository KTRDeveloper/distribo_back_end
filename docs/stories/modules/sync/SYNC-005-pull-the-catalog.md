---
id: SYNC-005
title: Pull the catalog
module: sync
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [SYNC-004, CAT-001, CAT-003]
read_first: [src/modules/sync/adapters/relationship.adapter.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, catalogue/product]
constraints: [C-35]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# SYNC-005 — Pull the catalog

## Story
As a seller, I want my phone to hold the catalog so that I can sell offline at the right prices.

## Context
- Exists: `products` (CAT-001), pull engine.
- Adds: `adapters/catalog.adapter.ts` registering `products`: for OWNER, MANAGER and SELLER, every product of the organization (any status, deleted rows in `deleted`); a DRIVER receives the ACTIVE and INACTIVE products named by lines of orders they can see (names only: `id, name, unit`); a customer person receives no product rows (they browse online, CAT-007).
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Seller catalog
  When a SELLER pulls
  Then every product of the organization arrives with price and min_order_quantity
Scenario: AC-2 Driver
  Then a DRIVER receives only id, name and unit of products on orders to deliver
Scenario: AC-3 Customer person
  Then a customer person receives no product rows
Scenario: AC-4 Incremental
  When a price changes after the last pull
  Then the product is `updated` with the new price
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's catalog (horizontal)
  When a member of A pulls
  Then no product of B arrives
```

## Implementation
- Create: `src/modules/sync/adapters/catalog.adapter.ts`, `tests/integration/sync/pull-catalog.test.ts`
- Modify: `src/modules/sync/sync.service.ts`
- Pattern: `src/modules/sync/adapters/identity.adapter.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: products come from the viewer's organizations only.
- v5.0.0-15.3.1: the driver gets three columns.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| seller | integration | AC-1, C-35 | all products |
| driver | integration | AC-2 | three columns |
| customer | integration | AC-3 | none |
| incremental | integration | AC-4 | updated |
| other business | security | AB-1, WSTG-ATHZ-04 | none |

Command: `npx vitest run tests/integration/sync/pull-catalog.test.ts`

## Out of scope
- Customer-specific prices for customers: online browsing.
