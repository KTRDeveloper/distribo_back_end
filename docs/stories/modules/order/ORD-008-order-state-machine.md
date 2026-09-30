---
id: ORD-008
title: Order state machine
module: order
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [ORD-002, ORD-007]
read_first: [prisma/schema.prisma, tests/integration/order/status-rules.test.ts]
design_refs: [commandes-et-livraisons/order, annexe-la-table-des-regles/etapes-d-une-commande]
constraints: [CM-12, C-18, C-16]
asvs: [v5.0.0-2.3.1, v5.0.0-2.3.4]
---

# ORD-008 — Order state machine

## Story
Technical story: provide the one function that changes an order's status by a permitted step, so that every route and the sync judge share the same rules.

## Context
- Exists: the DB status rules (ORD-002).
- Adds: `src/modules/order/order.state.ts` (`transitionOrder`) and `src/modules/order/order.repository.ts`.
- `transitionOrder(tx, orderId, to, actor, fields)` runs `UPDATE orders SET status = $to, ... WHERE id = $id AND status = ANY($allowedFrom) RETURNING *`. Allowed origins: CONFIRMED from PENDING; CANCELLED from PENDING or CONFIRMED (fields `cancelled_by_party`, `cancelled_by_id`, `cancelled_at` = now, `cancellation_reason`; reason required for SUPPLIER); IN_DELIVERY from CONFIRMED; DELIVERED from CONFIRMED or IN_DELIVERY (fields `delivered_at` = now, `delivered_by_id`); CONFIRMED from IN_DELIVERY (failed attempt). No row updated: 409 `INVALID_TRANSITION` naming the current status.
- Option `viaSync: true`: CANCELLED to DELIVERED is allowed and sets `sync_issue` "Livrée après annulation" and clears the cancellation columns; DELIVERED to CANCELLED changes nothing and sets `sync_issue` "Annulation impossible : commande livrée" (the call returns the unchanged order).
- `CM-12`: Allowed transitions only: PENDING to CONFIRMED or CANCELLED; CONFIRMED to IN_DELIVERY, DELIVERED or CANCELLED; IN_DELIVERY to DELIVERED or CONFIRMED (failed attempt); DELIVERED wins over CANCELLED; DELIVERED and CANCELLED are frozen except supplier_note.
- `C-18`: Status changes follow the permitted steps; delivery wins; a delivered or cancelled order is frozen except `supplier_note`.
- `C-16`: `cancelled_by_party`, `cancelled_by_id` and `cancelled_at` are set if and only if `status` is CANCELLED; `cancellation_reason` only when CANCELLED and required when the supplier cancelled.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Steps
  When transitionOrder moves an order from <from> to <to>
  Then the result is <result>
  Examples:
    | from        | to          | result                |
    | PENDING     | CONFIRMED   | updated               |
    | PENDING     | CANCELLED   | updated               |
    | CONFIRMED   | IN_DELIVERY | updated               |
    | CONFIRMED   | DELIVERED   | updated               |
    | CONFIRMED   | CANCELLED   | updated               |
    | IN_DELIVERY | DELIVERED   | updated               |
    | IN_DELIVERY | CONFIRMED   | updated               |
    | IN_DELIVERY | CANCELLED   | 409 INVALID_TRANSITION |
    | DELIVERED   | CANCELLED   | 409 INVALID_TRANSITION |
    | CANCELLED   | CONFIRMED   | 409 INVALID_TRANSITION |
    | PENDING     | DELIVERED   | 409 INVALID_TRANSITION |
Scenario: AC-2 Cancellation fields
  When an order is cancelled by the SUPPLIER without a reason
  Then the call throws 400 `VALIDATION_ERROR`
  And with a reason the order stores party, person, time and reason
Scenario: AC-3 Parallel steps
  When an order is cancelled and delivered at the same time
  Then exactly one succeeds and the order is in a valid final status
Scenario: AC-4 Delivery wins through sync
  When viaSync delivers an order that is CANCELLED
  Then it is DELIVERED with sync_issue "Livrée après annulation" and no cancellation columns
  And viaSync cancelling a DELIVERED order leaves it DELIVERED with sync_issue "Annulation impossible : commande livrée"
```

## Abuse cases
```gherkin
Scenario: AB-1 Skipping a step (tampering)
  When code asks for PENDING to DELIVERED
  Then the answer is 409 and the order is unchanged
```

## Implementation
- Create: `src/modules/order/order.state.ts`, `src/modules/order/order.repository.ts`, `tests/integration/order/state-machine.test.ts`
- Pattern: `src/modules/tasks/tasks.repository.ts`
- Signatures:
  - `transitionOrder(tx: Prisma.TransactionClient, orderId: string, to: OrderStatus, actor: { personId: string; party: 'CUSTOMER' | 'SUPPLIER' }, fields?: TransitionFields, options?: { viaSync?: boolean }): Promise<Order>`
- Types:
  - `TransitionFields = { cancellationReason?: string }`
- Errors: `INVALID_TRANSITION` 409, `VALIDATION_ERROR` 400
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.1: a step is applied only by a conditional update on the current status.
- v5.0.0-2.3.4: parallel steps are settled by the row update, not by read-then-write.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| steps | integration | AC-1, CM-12, C-18 | each Examples row → result |
| cancellation fields | integration | AC-2, C-16 | reason required for supplier; fields stored |
| parallel | integration | AC-3, CWE-362 | one success |
| delivery wins | integration | AC-4 | sync outcomes |
| skipped step | security | AB-1, WSTG-BUSL-06 | 409, unchanged |

Command: `npx vitest run tests/integration/order/state-machine.test.ts`

## Out of scope
- Who may take each step (routes, ACC rules).
