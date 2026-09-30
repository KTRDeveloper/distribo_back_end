---
id: FIN-013
title: Manager cancels an expense
module: finance
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [FIN-012, FIN-004]
read_first: [src/modules/finance/held-money.ts, src/modules/finance/finance.routes.ts]
design_refs: [finances/expense]
constraints: [C-27]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3]
---

# FIN-013 — Manager cancels an expense

## Story
As a manager, I want to cancel an expense entered by mistake so that the payer's held money is restored.

## Context
- Exists: expenses (FIN-012); rule `cancel` on Expense (MANAGER online, OWNER always).
- Adds: `POST /api/v1/organizations/{organizationId}/expenses/{expenseId}/cancel` with `{ id }`; response 200 with the expense showing `cancelled_at` and `cancelled_by_id`. The payer's held money rises by the amount; the row stays, struck through.
- A second cancellation, or another organization's expense, answers 409 `ALREADY_CANCELLED` or 404.
- `C-27`: `Expense.amount` > 0 and `paid_by_id` is a collaborator of the organization, active or gone; `Handover.amount` > 0, `from_person_id` a collaborator active or gone, `from_person_id` differs from `to_person_id` except the former owner's automatic handover, `to_person_id` an ACTIVE OWNER or MANAGER; expenses and handovers are never modified, only cancelled once with `cancelled_at` and `cancelled_by_id` set together.

## Acceptance criteria
```gherkin
Scenario: AC-1 Cancel
  When a MANAGER cancels an expense of 5000
  Then cancelled_at and cancelled_by_id are set and the payer's amount_held is +5000
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                       | status                   |
    | an expense already cancelled  | 409 ALREADY_CANCELLED    |
    | an expense of another business| 404 NOT_FOUND            |
    | a SELLER caller               | 403 FORBIDDEN            |
Scenario: AC-3 Parallel cancels
  When two managers cancel at once
  Then one succeeds and money is restored once
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller cancels an expense (vertical)
  When a SELLER or DRIVER posts cancel
  Then the response is 403 and the expense is unchanged
```

## Implementation
- Create: `tests/integration/finance/cancel-expense.test.ts`
- Modify: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.schemas.ts`, `src/modules/finance/finance.service.ts`, `src/modules/finance/held-money.ts`
- Pattern: `src/modules/finance/finance.routes.ts`
- Signatures:
  - `cancelExpense(actor: Actor, expenseId: string): Promise<ExpenseView>`
- Errors: `ALREADY_CANCELLED` 409, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner.
- v5.0.0-2.3.3: the cancel is one conditional update with the cache change.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| cancel | integration | AC-1, C-27 | fields and held +5000 |
| refusals | integration | AC-2 | each Examples row → status |
| parallel | integration | AC-3, CWE-362 | once |
| seller | security | AB-1, WSTG-ATHZ-03 | 403 |

Command: `npx vitest run tests/integration/finance/cancel-expense.test.ts`

## Out of scope
- Editing an expense: never allowed.
