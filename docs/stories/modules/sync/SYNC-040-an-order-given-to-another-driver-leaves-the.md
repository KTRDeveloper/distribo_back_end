---
id: SYNC-040
title: An order given to another driver leaves the pool on the phone
module: sync
kind: change
rev: 1
amends: [SYNC-006]
size: S
risk: medium
depends_on: [SYNC-006, DLV-013]
read_first: [src/modules/sync/adapters/order.adapter.ts, tests/integration/sync/pull-orders.test.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone]
constraints: [CM-38]
asvs: [v5.0.0-8.2.2, v5.0.0-8.3.1]
---

# SYNC-040 — An order given to another driver leaves the pool on the phone

## Story
As a driver, I want the orders given to another driver to leave my phone's pool, so that I do not depart with goods already assigned.

## Context
- Exists: the driver's order scope (SYNC-006) in `order.adapter.ts`: the CONFIRMED orders with an address, the IN_DELIVERY ones, those the driver delivered and those with one of their deliveries. The online pool already hides an order assigned to another driver (DLV-013).
- Change in the same scope: the branch "CONFIRMED with an address" leaves out an order that has a live delivery (not deleted, not arrived, not failed) assigned to someone other than the viewer. The order, its lines and its deliveries follow that scope. OWNER, MANAGER, SELLER, the assigned driver and the IN_DELIVERY branch are unchanged.
- An order that returns to the pool (failed attempt, removed or moved assignment) must reach the phone although its row did not change: on an incremental pull, an order also counts as changed when one of its deliveries changed since (`orders` and `order_lines`).
- An order already on a phone is not removed when it is assigned to someone else: no `deleted` id is sent for it.
- `CM-38`: The pool "À prendre" lists the confirmed orders with a delivery address; a driver does not see there an order assigned to another driver, and sees it again when that assignment ends (failed attempt or removal); managers, owners and sellers see every order of the pool.
- `CM-38`: The pool of orders to take lists the confirmed orders with a delivery address; a driver does not see there an order assigned to another driver, and sees it again when that assignment ends (failed attempt or removal); managers, owners and sellers see every order of the pool.

## Acceptance criteria
```gherkin
Scenario: AC-1 Assigned to another driver
  Given a CONFIRMED order with an address, assigned to driver B and not departed
  When driver A pulls for the first time
  Then the order and its lines are absent
  And driver B, the owner, a manager and a seller receive them
Scenario Outline: AC-2 An assignment that ends
  Given driver A pulled while the order was assigned to B
  When B's delivery is <ending> and A pulls again
  Then the order and its lines arrive
  Examples:
    | ending                    |
    | marked failed             |
    | removed (deleted_at set)  |
Scenario: AC-3 A reassignment
  When a manager moves the assignment from B to A and A pulls
  Then the order arrives for A
Scenario: AC-4 Already on the phone
  Given driver A pulled the order before it was assigned to B
  When A pulls again
  Then no `deleted` id is sent for that order
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/sync/pull-orders-assigned.test.ts`
- Modify: `src/modules/sync/adapters/order.adapter.ts`
- Pattern: `src/modules/sync/sync.changes.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: person and organizations come from the viewer built from the session.
- v5.0.0-8.3.1: the server leaves the order out; the phone's own filter only repeats it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| assigned elsewhere | integration | AC-1, CM-38 | absent for A, present for B and the team |
| assignment ends | integration | AC-2 | each Examples row, order and lines arrive |
| reassignment | integration | AC-3 | order arrives for A |
| kept on the phone | integration | AC-4 | no deleted id |

Command: `npx vitest run tests/integration/sync/pull-orders-assigned.test.ts tests/integration/sync/pull-orders.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/pull-orders.test.ts | the driver test expects the CONFIRMED order that driver two holds by DELIVERY_OTHER | the driver gets only the IN_DELIVERY and recently delivered orders |

## Out of scope
- The IN_DELIVERY branch keeps its present scope.
- The customer of an order assigned to another driver still arrives with its available credit.
