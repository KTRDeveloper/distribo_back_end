---
id: SYNC-006
title: Pull orders, lines and deliveries
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-005, ORD-007, DLV-001]
read_first: [src/modules/sync/adapters/relationship.adapter.ts, src/modules/order/order.views.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone]
constraints: [CM-30, C-35]
asvs: [v5.0.0-8.2.2, v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# SYNC-006 — Pull orders, lines and deliveries

## Story
As a driver, I want my phone to hold the orders to deliver and my deliveries so that I can work without network.

## Context
- Exists: orders, lines, deliveries; pull engine; `projectOrderForSupplier`, `projectOrderForCustomer`.
- Adds: `adapters/order.adapter.ts` registering `orders`, `order_lines` and `deliveries`, and `sync.openapi.ts` documenting `GET /api/v1/sync/pull` (imported by `sync.routes.ts`).
- Retention: open orders (PENDING, CONFIRMED, IN_DELIVERY) always; DELIVERED and CANCELLED orders of the last 90 days; their lines and deliveries follow their order.
- Scope: OWNER, MANAGER and SELLER receive all orders of the organization as supplier (supplier view; `price_set_by_id` only for OWNER and MANAGER; `sync_issue` included); a DRIVER receives CONFIRMED and IN_DELIVERY orders with an address, orders they delivered in the last 90 days and their own deliveries, without `customer_note` of other... every order field except `sync_issue`; a customer person receives their orders in the customer view.
- `CM-30`: Sync pull returns only what the user may see; a driver receives, per customer, only the available credit instead of balance and limit; the phone keeps all customers, the catalog, open orders and the last 90 days of the rest.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Seller gets all open orders
  Given open orders and a delivered order 100 days old
  When a SELLER pulls
  Then the open orders arrive with lines and the 100-day-old delivered order does not
Scenario: AC-2 Driver gets the pool and own deliveries
  Then a DRIVER receives CONFIRMED orders with an address, IN_DELIVERY orders, and their deliveries, and no PENDING order
Scenario: AC-3 Customer person
  Then a customer person receives their orders in the customer view without sync_issue
Scenario: AC-4 Lines follow orders
  When an order is updated
  Then its lines are sent with it
Scenario: AC-5 Incremental
  When one delivery changed after the last pull
  Then only that delivery is `updated`
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's orders (horizontal)
  When a member of A pulls
  Then no order, line or delivery of B arrives
```

## Implementation
- Create: `src/modules/sync/adapters/order.adapter.ts`, `src/modules/sync/sync.openapi.ts`, `tests/integration/sync/pull-orders.test.ts`
- Modify: `src/modules/sync/sync.routes.ts`, `src/modules/sync/sync.service.ts`
- Pattern: `src/modules/sync/adapters/relationship.adapter.ts`
- Dependencies: `@prisma/client`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.2: scope starts from the viewer's memberships or person id.
- v5.0.0-8.2.3: per-role field lists.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| seller | integration | AC-1, CM-30 | open and recent only |
| driver | integration | AC-2 | pool and own |
| customer | integration | AC-3 | customer view |
| lines | integration | AC-4, C-35 | with order |
| incremental | integration | AC-5 | one row |
| other business | security | AB-1, WSTG-ATHZ-04 | none |

Command: `npx vitest run tests/integration/sync/pull-orders.test.ts`

## Out of scope
- Ledger, expenses and handovers (SYNC-007).
