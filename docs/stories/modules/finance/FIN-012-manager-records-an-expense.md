---
id: FIN-012
title: Manager records an expense
module: finance
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [FIN-011, FIN-003, ACC-004, ACC-007, FIN-004]
read_first: [src/modules/finance/finance.service.ts, src/modules/organization/organization.repository.ts]
design_refs: [finances/expense]
constraints: [C-27, CM-17]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-15.3.3]
---

# FIN-012 — Manager records an expense

## Story
As a manager, I want to record an expense paid by a collaborator so that the money they hold goes down.

## Context
- Exists: `addAmountHeld` (ORG-006); rule `create` on Expense for MANAGER online, OWNER always (ACC-004); `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/expenses` with `{ id, paid_by_id?, amount, category?, description?, occurred_at? }`; `paid_by_id` defaults to the caller; `amount` an integer of at least 1; `category` up to 100; `description` up to 2000; `occurred_at` not in the future (default now). Response 201.
- `src/modules/finance/held-money.ts` gets `recordExpenseInTx(tx, input)`: it inserts the row (`recorded_by_id` the caller) and lowers `paid_by_id`'s held money by the amount.
- The organization must be ACTIVE; the payer must be a collaborator of it (ACTIVE or gone).
- `C-27`: `Expense.amount` > 0 and `paid_by_id` is a collaborator of the organization, active or gone; `Handover.amount` > 0, `from_person_id` a collaborator active or gone, `from_person_id` differs from `to_person_id` except the former owner's automatic handover, `to_person_id` an ACTIVE OWNER or MANAGER; expenses and handovers are never modified, only cancelled once with `cancelled_at` and `cancelled_by_id` set together.
- `CM-17`: amount_held = payments recorded minus refunds made, expenses paid and handovers given, plus handovers received; a reversed entry counts the other way; a cancelled expense or handover no longer counts; the owner's amount is tracked but never presented.

## Acceptance criteria
```gherkin
Scenario: AC-1 Record
  Given a driver holding 60000
  When a MANAGER records an expense of 5000 paid by the driver, category "Carburant"
  Then the response is 201 and the driver's amount_held is 55000
Scenario: AC-2 Default payer
  When paid_by_id is omitted
  Then the caller is the payer
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is stored
  Examples:
    | problem                                       | status                      |
    | amount 0 or 1.5                               | 400 VALIDATION_ERROR        |
    | occurred_at in the future                     | 400 VALIDATION_ERROR        |
    | a payer who is not a collaborator             | 404 NOT_FOUND               |
    | a SELLER or DRIVER caller                     | 403 FORBIDDEN               |
    | a CLOSED organization                         | 409 ORGANIZATION_NOT_ACTIVE |
Scenario: AC-4 Repeat
  When the same id is posted twice
  Then one expense exists and money is lowered once
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller hides cash in expenses (vertical)
  When a SELLER or DRIVER posts an expense
  Then the response is 403 and nothing is stored
Scenario: AB-2 Payer of another business (horizontal)
  When paid_by_id belongs to another business's team only
  Then the response is 404
```

## Implementation
- Create: `src/modules/finance/held-money.ts`, `tests/integration/finance/record-expense.test.ts`
- Modify: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.schemas.ts`, `src/modules/finance/finance.service.ts`
- Pattern: `src/modules/finance/finance.service.ts`
- Signatures:
  - `recordExpenseInTx(tx: Prisma.TransactionClient, input: ExpenseInput): Promise<Expense>`
- Types:
  - `ExpenseInput = { id: string; organizationId: string; paidById: string; amount: bigint; category?: string; description?: string; recordedById: string; occurredAt: Date }`
- Errors: `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `FORBIDDEN` 403, `ORGANIZATION_NOT_ACTIVE` 409
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner.
- v5.0.0-2.3.3: expense and held money are one transaction.
- v5.0.0-15.3.3: strict schema.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| record | integration | AC-1, CM-17, C-27 | 201, held 55000 |
| default payer | integration | AC-2 | caller |
| refusals | integration | AC-3 | each Examples row → status |
| repeat | integration | AC-4 | once |
| seller | security | AB-1, WSTG-ATHZ-03 | 403 |
| foreign payer | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/finance/record-expense.test.ts`

## Out of scope
- Cancelling (FIN-013). OpenAPI (FIN-020).
