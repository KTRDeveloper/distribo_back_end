---
id: FIN-016
title: Cancel a handover and dispute the noted amount
module: finance
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [FIN-015, FIN-004]
read_first: [src/modules/finance/held-money.ts, src/modules/finance/finance.routes.ts]
design_refs: [finances/handover]
constraints: [C-27]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-16.3.1]
---

# FIN-016 — Cancel a handover and dispute the noted amount

## Story
As a driver, I want to say "this is not the right amount" about a handover noted in my name so that the owner is warned at once.

## Context
- Exists: handovers (FIN-015).
- Adds: `POST /api/v1/organizations/{organizationId}/handovers/{handoverId}/cancel` with `{ id }` (MANAGER online or OWNER; restores both caches; once, 409 `ALREADY_CANCELLED`) and `POST /api/v1/organizations/{organizationId}/handovers/{handoverId}/dispute` with `{ id, comment? }` (only the remitter `from_person_id`, for any collaboration status ACTIVE; up to 2000 characters). Dispute changes no data: the owner is notified `handover.disputed` naming the handover, the amount and the remitter.
- Another business's handover, or a dispute by someone other than the remitter, answers 404.
- `C-27`: `Expense.amount` > 0 and `paid_by_id` is a collaborator of the organization, active or gone; `Handover.amount` > 0, `from_person_id` a collaborator active or gone, `from_person_id` differs from `to_person_id` except the former owner's automatic handover, `to_person_id` an ACTIVE OWNER or MANAGER; expenses and handovers are never modified, only cancelled once with `cancelled_at` and `cancelled_by_id` set together.

## Acceptance criteria
```gherkin
Scenario: AC-1 Cancel
  When a MANAGER cancels a handover of 55000
  Then cancelled_at and cancelled_by_id are set, the remitter's held money is +55000 and the receiver's −55000
Scenario: AC-2 Dispute
  When the remitter disputes
  Then the owner has one unread `handover.disputed` and no amount changes
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                                        | status                |
    | cancelling twice                               | 409 ALREADY_CANCELLED |
    | a dispute by someone who is not the remitter   | 404 NOT_FOUND         |
    | a SELLER or DRIVER cancelling                  | 403 FORBIDDEN         |
    | a handover of another business                 | 404 NOT_FOUND         |
Scenario: AC-4 Repeat
  When the same dispute id is posted twice
  Then one notification exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Cash kept by the receiver, blamed on the remitter (repudiation)
  When the receiver notes less than received
  Then the remitter's dispute reaches the owner and the noted amount stays visible
Scenario: AB-2 Disputing someone else's handover (horizontal)
  When another collaborator posts a dispute
  Then the response is 404 and no notification is created
```

## Implementation
- Create: `tests/integration/finance/handover-cancel-dispute.test.ts`
- Modify: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.schemas.ts`, `src/modules/finance/finance.service.ts`, `src/modules/finance/held-money.ts`
- Pattern: `src/modules/finance/finance.routes.ts`
- Signatures:
  - `cancelHandover(actor: Actor, handoverId: string): Promise<HandoverView>`
  - `disputeHandover(actor: Actor, handoverId: string, input: { id: string; comment?: string }): Promise<void>`
- Errors: `ALREADY_CANCELLED` 409, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: cancellation by manager online or owner.
- v5.0.0-8.2.2: a dispute is only for the remitter of that handover.
- v5.0.0-16.3.1: a dispute is logged at `warn` with event `handover_disputed`.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| cancel | integration | AC-1, C-27 | caches restored |
| dispute | integration | AC-2 | owner notified, no change |
| refusals | integration | AC-3 | each Examples row → status |
| repeat | integration | AC-4 | one notification |
| blame shift | security | AB-1, CWE-778 | owner told |
| other collaborator | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/finance/handover-cancel-dispute.test.ts`

## Out of scope
- Resolving a dispute: a phone call.
