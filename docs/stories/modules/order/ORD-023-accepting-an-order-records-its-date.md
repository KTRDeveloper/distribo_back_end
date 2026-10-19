---
id: ORD-023
title: Accepting an order records its date
module: order
kind: change
rev: 1
amends: [ORD-008, ORD-011]
size: S
risk: high
depends_on: [ORD-022, ORD-011]
read_first: [src/modules/order/order.state.ts, src/modules/order/order.views.ts]
design_refs: [commandes-et-livraisons/order/refus-et-annulation, commandes-et-livraisons/order]
constraints: [C-51]
asvs: [v5.0.0-2.3.1, v5.0.0-15.3.1]
---

# ORD-023 — Accepting an order records its date

## Story
As a customer, I want an order the supplier turned down to be told apart from one cancelled after acceptance so that I know whether the supplier ever agreed to it.

## Context
- Exists: `transitionOrder` (ORD-008) with `TransitionFields = { cancellationReason? }`; `acceptOrder` (ORD-011) calls it for CONFIRMED without fields. A failed delivery attempt (IN_DELIVERY to CONFIRMED) uses the same step.
- Change: `TransitionFields` gains `acceptedAt?: Date`. With it, the step to CONFIRMED is allowed only from PENDING and writes `accepted_at` in the same conditional update; from any other status it answers 409 `INVALID_TRANSITION` and writes nothing. Without it nothing changes, so a failed delivery attempt never sets the date.
- `acceptOrder` passes `acceptedAt: new Date()`, the server clock. A date from a phone arrives through synchronization, not here.
- `PartyView` in `order.views.ts` and its OpenAPI document gain `accepted_at` (ISO string or null) for both parties. The apps show "Refusée" when `placed_by_party` is CUSTOMER, `cancelled_by_party` SUPPLIER and `accepted_at` empty, else "Annulée": no derived field.
- `C-51`: `status` PENDING requires `placed_by_party` CUSTOMER and an empty `accepted_at`; a set `accepted_at` requires `placed_by_party` CUSTOMER.
- `C-51`: `status` PENDING requires `placed_by_party` CUSTOMER and an empty `accepted_at`; a set `accepted_at` requires `placed_by_party` CUSTOMER.

## Acceptance criteria
```gherkin
Scenario: AC-1 Accepting records the date
  When a SELLER accepts a PENDING order placed by a customer
  Then the order is CONFIRMED and `accepted_at` is the server time
  And the supplier view and the customer view both show it
Scenario: AC-2 A failed delivery attempt keeps the date as it was
  Given an IN_DELIVERY order
  When the step to CONFIRMED is taken without `acceptedAt`
  Then `accepted_at` is unchanged, empty for a supplier-entered order and kept for an accepted one
Scenario Outline: AC-3 Only a pending order can be accepted
  When the step to CONFIRMED with `acceptedAt` is taken on an order that is <status>
  Then the answer is 409 INVALID_TRANSITION and nothing changes
  Examples:
    | status      |
    | CONFIRMED   |
    | IN_DELIVERY |
    | DELIVERED   |
    | CANCELLED   |
Scenario: AC-4 Refusal and cancellation
  When a PENDING order is refused
  Then `accepted_at` stays empty
  And an accepted order the supplier then cancels keeps its date
Scenario: AC-5 Views and documents
  When a supplier-entered order is read by either party
  Then `accepted_at` is null
  And GET /api/v1/docs/openapi.json lists `accepted_at`, a string or null, in both order views
```

## Abuse cases
```gherkin
Scenario: AB-1 A second acceptance rewrites the date (tampering)
  Given an order already accepted
  When a SELLER accepts it again
  Then the answer is 409 INVALID_TRANSITION and the first date remains
```

## Implementation
- Create: `tests/integration/order/accepted-at.test.ts`
- Modify: `src/modules/order/order.state.ts`, `src/modules/order/order.service.ts`, `src/modules/order/order.views.ts`, `src/modules/order/order.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `type TransitionFields = { cancellationReason?: string; acceptedAt?: Date }`
  - `transitionOrder(tx: Prisma.TransactionClient, orderId: string, to: OrderStatus, actor: TransitionActor, fields?: TransitionFields, options?: { viaSync?: boolean }): Promise<Order>`
- Types:
  - `PartyView gains accepted_at: string | null`
- Errors: `409` INVALID_TRANSITION when acceptedAt is given and the order is not PENDING
- Dependencies: `@prisma/client`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-2.3.1: the date and the status are written by one conditional update on PENDING, so two parallel acceptances cannot both win.
- v5.0.0-15.3.1: the view lists `accepted_at` field by field; no whole row is returned.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| accept | integration | AC-1, C-51 | accept a PENDING customer order → CONFIRMED, date set, both views show it |
| failed attempt | integration | AC-2 | IN_DELIVERY to CONFIRMED without the field → date unchanged |
| not pending | integration | AC-3 | each Examples row → 409, status and date unchanged |
| refuse and cancel | integration | AC-4 | refuse → date empty; accept then cancel → date kept |
| views | integration | AC-5 | entered order → null; openapi.json lists the field |
| second acceptance | security | AB-1, CWE-841 | accept twice → second 409, first date kept |

Command: `npx vitest run tests/integration/order/accepted-at.test.ts tests/unit/order tests/integration/order/accept-order.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/unit/order/calculations-and-views.test.ts | the customer view test lists the exact keys | add accepted_at to the expected keys |

## Out of scope
- An acceptance made offline: its date comes through synchronization.
- The labels 'Refusée' and 'Annulée': the apps compute them.
