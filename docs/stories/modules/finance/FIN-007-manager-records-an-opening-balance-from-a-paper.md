---
id: FIN-007
title: Manager records an opening balance from a paper notebook
module: finance
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [FIN-005]
read_first: [src/modules/finance/finance.service.ts, src/modules/finance/finance.routes.ts]
design_refs: [finances/ledgerentry/reprise-de-cahier]
constraints: [C-23]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]
---

# FIN-007 — Manager records an opening balance from a paper notebook

## Story
As a manager, I want to copy a customer's debt from my paper notebook so that their balance starts right.

## Context
- Exists: `appendLedgerEntry`; rule for kind OPENING_BALANCE (MANAGER online, OWNER always; ACC-004); `notify`.
- Adds: `POST /api/v1/organizations/{organizationId}/customers/{relationshipId}/opening-balances` with `{ id, amount, note }` (`note` required); response 201. The balance rises; a registered customer is notified `balance.increased`. Several may be recorded for one customer; a wrong one is reversed (FIN-009). An advance from the notebook is a credit note (FIN-006).
- Same refusals as FIN-005. The relationship must already exist (creating it is REL-007).
- `C-23`: `LedgerEntry.amount` > 0; `balance_effect` is a generated column of `kind`, `amount` and `reverses_entry_id`; `mode` is set if and only if `kind` is PAYMENT or REFUND.

## Acceptance criteria
```gherkin
Scenario: AC-1 Record
  When a MANAGER records 45000 for a customer with balance 0
  Then the balance is 45000 and the customer is notified
Scenario: AC-2 Several allowed
  When a second opening balance of 5000 is recorded
  Then the balance is 50000
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                    | status                   |
    | no note                    | 400 VALIDATION_ERROR     |
    | a SELLER caller            | 403 FORBIDDEN            |
    | the manager's own record   | 403 OWN_RECORD           |
    | a counter                  | 409 COUNTER_ONLY_RETURNS |
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller inflates a customer's debt (vertical)
  When a SELLER posts an opening balance
  Then the response is 403 and the balance is unchanged
```

## Implementation
- Create: `tests/integration/finance/opening-balance.test.ts`
- Modify: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.schemas.ts`, `src/modules/finance/finance.service.ts`
- Pattern: `src/modules/finance/finance.routes.ts`
- Signatures:
  - `recordOpeningBalance(actor: Actor, relationshipId: string, input: { id: string; amount: number; note: string }): Promise<LedgerEntryView>`
- Errors: `OWN_RECORD` 403, `COUNTER_ONLY_RETURNS` 409, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| record | integration | AC-1, C-23 | balance and notification |
| several | integration | AC-2 | 50000 |
| refusals | integration | AC-3 | each Examples row → status |
| seller | security | AB-1, WSTG-ATHZ-03 | 403 |

Command: `npx vitest run tests/integration/finance/opening-balance.test.ts`

## Out of scope
- Creating the customer with the opening balance in one call.
