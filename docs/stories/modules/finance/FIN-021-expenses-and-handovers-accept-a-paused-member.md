---
id: FIN-021
title: Expenses and handovers accept a paused member
module: finance
kind: change
rev: 1
amends: [FIN-012, FIN-015]
size: XS
risk: medium
depends_on: [FIN-012, FIN-015, ORG-022]
read_first: [src/modules/finance/finance.service.ts]
design_refs: [finances/handover, identite-et-organisation/collaboration]
constraints: [CM-39]
asvs: [v5.0.0-8.2.2, v5.0.0-2.3.3]
---

# FIN-021 — Expenses and handovers accept a paused member

## Story
As an owner, I want to record the handover of a paused team member so that the money they hold does not stay on their name once they lose access.

## Context
- Exists: `recordExpense` and `recordHandover` in `finance.service.ts` accept a payer or a remitter whose collaboration is ACTIVE or REVOKED and answer 404 NOT_FOUND for any other status. The tables' database rules accept every status (FIN-011, FIN-014), so no migration is needed.
- Change: both services also accept a PAUSED collaboration (ORG-022). INVITED stays refused, and so does a person of another business or an unknown id.
- Nothing else moves: the receiver of a handover is still an ACTIVE OWNER or MANAGER, held money rises and falls by the same operations, and the nightly check (FIN-018) already covers every collaboration.
- The doc comments of both functions and the `@throws` lines say ACTIVE, PAUSED or revoked.
- `CM-39`: A paused member keeps the money they hold, visible to the owner: for the payer of an expense and the person who hands money over, a paused member counts like a departed one, so that money can be collected and expenses recorded.
- `CM-39`: A paused member keeps the money they hold, visible to the owner: for the payer of an expense and the person who hands money over, a paused member counts like a departed one, so that money can be collected and expenses recorded.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Handover from a member in each status
  Given a member holding 10000 whose collaboration is <status>
  When the owner records a handover of 4000 from them
  Then the answer is <result>
  Examples:
    | status  | result        |
    | ACTIVE  | 201           |
    | PAUSED  | 201           |
    | REVOKED | 201           |
    | INVITED | 404 NOT_FOUND |
Scenario: AC-2 The money moves
  When the owner records a handover of 4000 from a PAUSED member holding 10000
  Then the member's held money is 6000 and the owner's rises by 4000
Scenario Outline: AC-3 Expense paid by a member in each status
  When the owner records an expense paid by a member whose collaboration is <status>
  Then the answer is <result>
  Examples:
    | status  | result        |
    | PAUSED  | 201           |
    | INVITED | 404 NOT_FOUND |
```

## Abuse cases
```gherkin
Scenario: AB-1 A person of another business is named (access control)
  When the owner records a handover from a PAUSED member of another business
  Then the answer is 404 NOT_FOUND and no handover exists
```

## Implementation
- Create: `tests/integration/finance/paused-member.test.ts`
- Modify: `src/modules/finance/finance.service.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Errors: `404` NOT_FOUND when the payer or remitter has no collaboration in the caller's business, or only an invitation
- Dependencies: none added

## Security
- v5.0.0-8.2.2: the collaboration is looked up inside the caller's own business; a person of another business is the same 404.
- v5.0.0-2.3.3: the row, the held money and the notice stay one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| handover statuses | integration | AC-1, CM-39 | each Examples row → status code |
| money | integration | AC-2 | handover from a paused member → held money falls, receiver's rises |
| expense statuses | integration | AC-3, CM-39 | each Examples row → status code |
| other business | security | AB-1, CWE-639 | paused member of another business → 404, nothing stored |

Command: `npx vitest run tests/integration/finance`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/finance/record-expense.test.ts | refuses an INVITED payer and one of another business; no case uses PAUSED | unchanged |
| tests/integration/finance/record-handover.test.ts | refuses an INVITED remitter and one of another business; no case uses PAUSED | unchanged |

## Out of scope
- Who may be paused, and when (billing stories).
- Revoked members and the departure of a person: unchanged.
