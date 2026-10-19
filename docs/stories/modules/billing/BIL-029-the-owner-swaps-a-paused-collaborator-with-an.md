---
id: BIL-029
title: The owner swaps a paused collaborator with an active one
module: billing
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [BIL-018, BIL-019]
read_first: [src/modules/billing/billing.owner.routes.ts, src/modules/billing/seat-limit.service.ts]
design_refs: [finances/subscription]
constraints: [C-42, C-55]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, v5.0.0-2.3.3]
---

# BIL-029 — The owner swaps a paused collaborator with an active one

## Story
As an owner, I want to bring back a paused collaborator by pausing another so that my seats fit my needs.

## Context
- Exists: the router (BIL-018), `seatNotice` (BIL-019), `listTeamSeats`, `setSeatPaused` (ORG-035), `findDriversWithOpenDeliveries` (DLV-015), `listProductsOnSale` (CAT-020), `insertEvent`, `runInTransaction` (BIL-011), `notify`.
- `POST /api/v1/organizations/{organizationId}/billing/swap-seat` on that router. Chain: sign-in, `loadActor`, `requireAbility('keep', 'Collaboration')`, `idempotent()`. Body, strict: `id` (UUIDv7), `pause_collaboration_id`, `resume_collaboration_id` (distinct).
- `swapSeat(actor, input, now)` in the new `swap.service.ts`, one transaction under `lockSubscriptions`. Both ids must be seats of `listTeamSeats` (else 404 `NOT_FOUND`). The seat to pause must be ACTIVE or INVITED, the one to resume PAUSED (else 409 `SEAT_STATE`); a DRIVER with an open delivery cannot be paused (409 `DRIVER_ON_DELIVERY`).
- It calls `setSeatPaused` for both, writes a PAUSED and a RESUMED event (actor OWNER, the owner's person id, details: the collaboration id) and one `seatNotice` to each.
- `writeCurrentKeepChoice(tx, organizationId, personId)`, exported for BIL-030, inserts a KEEP_CHOICE event (actor OWNER) with the seats now not paused and the products now on sale, so that enforcement keeps the swap.
- Answer 201 `{ paused_collaboration_id, resumed_collaboration_id }`.
- `C-42`: At each invitation, the ACTIVE or INVITED collaborators of an organization, owner excluded, number at most `Organization.max_collaborators`; the status PAUSED is written by the server only and never for the OWNER.
- `C-55`: `SubscriptionEvent`: `person_id` is set exactly when `actor = OWNER`; `administrator_id` and `admin_action_id` are set exactly when `actor = ADMINISTRATOR`; `payment_id` is set when `actor = PAYER`; no update, no delete.

## Acceptance criteria
```gherkin
Scenario: AC-1 A swap
  Given limit 2, A and B ACTIVE, C PAUSED
  When the owner pauses A and resumes C
  Then the answer is 201, A is PAUSED and C ACTIVE, one PAUSED, one RESUMED and one KEEP_CHOICE event name the owner, A and C each have one notice, and `enforceSeatLimit` with limit 2 changes nothing afterwards
Scenario Outline: AC-2 A state that refuses
  When <case>
  Then the answer is <answer> and nothing changes
  Examples:
    | case                                             | answer                       |
    | the seat to pause is already PAUSED              | 409 `SEAT_STATE`             |
    | the seat to resume is ACTIVE                     | 409 `SEAT_STATE`             |
    | the seat to pause is a driver on a delivery      | 409 `DRIVER_ON_DELIVERY`     |
    | an id is unknown or the owner's own              | 404 `NOT_FOUND`              |
Scenario: AC-3 Who may
  When a manager, a seller, a driver or a person not signed in sends a valid swap
  Then the answers are 403 `FORBIDDEN` for the first three and 401 `UNAUTHORIZED` for the last
Scenario: AC-4 Body and repeat
  When the body has an extra field, a bad UUID or twice the same id, then a valid swap is sent twice
  Then the first three give 400 `VALIDATION_ERROR`, the repeat equal answers and one set of events
```

## Abuse cases
```gherkin
Scenario: AB-1 A seat of another business is paused (broken access control)
  When an owner of A sends a seat id of business B
  Then the answer is 404, equal to an unknown id's, and B's seat is unchanged
```

## Implementation
- Create: `src/modules/billing/swap.service.ts`, `tests/integration/billing/swap-seat.test.ts`
- Modify: `src/modules/billing/billing.owner.routes.ts`, `src/modules/billing/billing.schemas.ts`, `src/modules/billing/billing.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `swapSeat(actor: OrganizationActor, input: SwapSeatInput, now: Date): Promise<SwapSeatView>`
  - `writeCurrentKeepChoice(tx: Prisma.TransactionClient, organizationId: string, personId: string): Promise<void>`
- Types:
  - `SwapSeatInput = { id: string; pauseCollaborationId: string; resumeCollaborationId: string }`
  - `SwapSeatView = { paused_collaboration_id: string; resumed_collaboration_id: string }`
- Errors: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `SEAT_STATE` 409, `DRIVER_ON_DELIVERY` 409
- Dependencies: `zod`, `express`

## Security
- v5.0.0-8.2.1: only an owner passes `keep`; the business comes from the session.
- v5.0.0-15.3.3: the body lists its fields and refuses any other.
- v5.0.0-2.3.3: seats, events and notices share one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| swap | integration | AC-1, C-55, C-42 | 201, seats, events, notices, enforcement keeps it |
| refused | integration | AC-2 | each Examples row → answer, no change |
| who may | integration | AC-3 | 403 and 401 |
| body and repeat | integration | AC-4 | 400s, equal answers |
| other business | security | AB-1, CWE-639 | 404 equal to unknown, B unchanged |

Command: `npx vitest run tests/integration/billing/swap-seat.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | route list | add POST /api/v1/organizations/{organizationId}/billing/swap-seat |
| tests/integration/per-001.test.ts | route list | add POST /api/v1/organizations/{organizationId}/billing/swap-seat |

## Out of scope
- Products: BIL-030.
