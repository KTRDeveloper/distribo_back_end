---
id: FIN-015
title: Owner or manager records a handover received
module: finance
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [FIN-014, FIN-012, NTF-002, FIN-004]
read_first: [src/modules/finance/held-money.ts, src/modules/finance/finance.service.ts]
design_refs: [finances/handover]
constraints: [C-27, CM-17]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-15.3.3]
---

# FIN-015 — Owner or manager records a handover received

## Story
As a manager, I want to record the money I received from a collaborator so that what they hold goes down and mine goes up.

## Context
- Exists: `recordExpenseInTx` and the held-money file (FIN-012); rule `create` on Handover for MANAGER online, OWNER always; `notify`; `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/handovers` with `{ id, from_person_id, amount, occurred_at? }` and `recordHandoverInTx(tx, input)` in `held-money.ts`. The receiver is always the caller, who must be an ACTIVE OWNER or MANAGER. `from_person_id` must be a collaborator (ACTIVE or gone) other than the caller (400 `VALIDATION_ERROR` otherwise).
- Effect: the remitter's held money falls by the amount and the receiver's rises (when remitter and receiver are the same person, only a fall). The remitter is notified `handover.recorded`: "<receiver> a noté avoir reçu <amount> de vous. Il vous reste <remaining> à remettre." with `remaining` the remitter's held money after the handover.
- `C-27`: `Expense.amount` > 0 and `paid_by_id` is a collaborator of the organization, active or gone; `Handover.amount` > 0, `from_person_id` a collaborator active or gone, `from_person_id` differs from `to_person_id` except the former owner's automatic handover, `to_person_id` an ACTIVE OWNER or MANAGER; expenses and handovers are never modified, only cancelled once with `cancelled_at` and `cancelled_by_id` set together.
- `CM-17`: amount_held = payments recorded minus refunds made, expenses paid and handovers given, plus handovers received; a reversed entry counts the other way; a cancelled expense or handover no longer counts; the owner's amount is tracked but never presented.

## Acceptance criteria
```gherkin
Scenario: AC-1 Record
  Given a driver holding 60000 and a MANAGER holding 0
  When the MANAGER records a handover of 55000 from the driver
  Then the driver holds 5000 and the manager holds 55000
Scenario: AC-2 Remitter told
  Then the driver has one unread `handover.recorded` mentioning 55000 and 5000
Scenario: AC-3 Partial and over
  When a handover of 70000 is recorded from a driver holding 60000
  Then it is accepted and the driver holds -10000
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is stored
  Examples:
    | problem                                   | status                |
    | from_person_id equal to the caller        | 400 VALIDATION_ERROR  |
    | a remitter who is not a collaborator      | 404 NOT_FOUND         |
    | amount 0                                  | 400 VALIDATION_ERROR  |
    | a SELLER or DRIVER caller                 | 403 FORBIDDEN         |
Scenario: AC-5 Repeat
  When the same id is posted twice
  Then one handover exists
```

## Abuse cases
```gherkin
Scenario: AB-1 A driver records their own handover (vertical)
  When a DRIVER posts
  Then the response is 403 and nothing is stored
Scenario: AB-2 Noting less than received (tampering)
  Then the remitter is told the noted amount and the remaining figure, so a lower note is visible to them
```

## Implementation
- Create: `tests/integration/finance/record-handover.test.ts`
- Modify: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.schemas.ts`, `src/modules/finance/finance.service.ts`, `src/modules/finance/held-money.ts`
- Pattern: `src/modules/finance/finance.service.ts`
- Signatures:
  - `recordHandoverInTx(tx: Prisma.TransactionClient, input: HandoverInput): Promise<Handover>`
- Types:
  - `HandoverInput = { id: string; organizationId: string; fromPersonId: string; toPersonId: string; amount: bigint; occurredAt: Date }`
- Errors: `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner; the receiver is the caller.
- v5.0.0-2.3.3: handover and both caches are one transaction, in a fixed order.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| record | integration | AC-1, CM-17, C-27 | 5000 and 55000 |
| remitter told | integration | AC-2 | notification text |
| over | integration | AC-3 | accepted, negative |
| refusals | integration | AC-4 | each Examples row → status |
| repeat | integration | AC-5 | once |
| driver | security | AB-1, WSTG-ATHZ-03 | 403 |
| lower note visible | security | AB-2, CWE-778 | remaining amount in the notice |

Command: `npx vitest run tests/integration/finance/record-handover.test.ts`

## Out of scope
- Cancelling and disputing (FIN-016).
