---
id: DLV-013
title: An order assigned to a driver leaves the pool of the other drivers
module: delivery
kind: change
rev: 1
amends: [DLV-003]
size: XS
risk: medium
depends_on: [DLV-003, DLV-004]
read_first: [src/modules/delivery/delivery.repository.ts]
design_refs: [commandes-et-livraisons/delivery]
constraints: [CM-38]
asvs: [v5.0.0-8.2.2, v5.0.0-8.3.1]
---

# DLV-013 — An order assigned to a driver leaves the pool of the other drivers

## Story
As a driver, I want an order given to another driver to leave "À prendre" so that I do not depart with goods already assigned.

## Context
- Exists: `listToDeliverOrders` returns every CONFIRMED order with an address of the organization, and every role sees the same pool (DLV-003 AC-4). An assignment (DLV-004) is a delivery row with `assigned_to_id` and no `departed_at`.
- Change in `delivery.repository.ts`: for a viewer whose role is DRIVER, the query also leaves out the orders that have a live delivery (not deleted, neither arrived nor failed) assigned to someone else. The role comes from the actor, which `listToDeliver` already passes.
- The assigned driver still sees the order, and so do MANAGER, OWNER and SELLER, so a manager can reassign it (DLV-004).
- A failed attempt or a removed assignment puts the order back in the pool of every driver; a reassignment moves it from one driver to the other.
- `CM-38`: The pool of orders to take lists the confirmed orders with a delivery address; a driver does not see there an order assigned to another driver, and sees it again when that assignment ends (failed attempt or removal); managers, owners and sellers see every order of the pool.
- `CM-38`: The pool of orders to take lists the confirmed orders with a delivery address; a driver does not see there an order assigned to another driver, and sees it again when that assignment ends (failed attempt or removal); managers, owners and sellers see every order of the pool.

## Acceptance criteria
```gherkin
Scenario: AC-1 Assigned to another driver
  Given a CONFIRMED order with an address, assigned to driver B and not departed
  When driver A lists the orders to deliver
  Then the order is absent
  And driver B sees it
Scenario Outline: AC-2 Who still sees an assigned order
  Given an order assigned to driver B
  When <viewer> lists the orders to deliver
  Then the order is <result>
  Examples:
    | viewer          | result  |
    | the owner       | listed  |
    | a manager       | listed  |
    | a seller        | listed  |
    | another driver  | absent  |
Scenario Outline: AC-3 An assignment that ended
  Given an order whose delivery assigned to driver B is <state>
  When driver A lists the orders to deliver
  Then the order is listed
  Examples:
    | state                          |
    | failed                         |
    | removed (deleted_at set)       |
Scenario: AC-4 Reassignment
  When a manager moves the assignment from driver B to driver A
  Then driver A sees the order and driver B no longer does
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/delivery/pool-assigned.test.ts`
- Modify: `src/modules/delivery/delivery.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `listToDeliverOrders(viewer: Viewer & { role: Role }, query: { limit: number; cursor?: string }): Promise<{ rows: OrderForDriver[]; nextCursor: string | null }>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: the query still starts from the actor's organization; person and role come from the actor, never from the request.
- v5.0.0-8.3.1: the server hides the order; the phone's own filter only repeats it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| hidden | integration | AC-1, CM-38 | order assigned to B → absent for A, listed for B |
| roles | integration | AC-2, CM-38 | each Examples row → listed or absent |
| ended | integration | AC-3, CM-38 | each Examples row → listed for A |
| reassign | integration | AC-4 | manager reassigns B to A → A sees it, B no longer |

Command: `npx vitest run tests/integration/delivery/driver-lists.test.ts tests/integration/delivery/pool-assigned.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/delivery/driver-lists.test.ts | AC-4 compares the pools of two drivers and seeds no assignment | unchanged; the assigned case is covered by the new test file |

## Out of scope
- The same filter on the orders a phone receives by synchronization (the synchronization stories).
- The pool of a person who is both owner and driver: the role of the actor decides.
