---
id: FIN-020
title: Owner reads the treasury and expenses
module: finance
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [FIN-019, FND-009, FIN-004, FIN-010]
read_first: [src/modules/finance/finance.service.ts, src/modules/finance/finance.openapi.ts]
design_refs: [finances/ledgerentry, finances/expense]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.1]
---

# FIN-020 — Owner reads the treasury and expenses

## Story
As an owner, I want the money that came in and went out over a period so that I know my treasury.

## Context
- Exists: ledger and expenses.
- Adds: `GET /api/v1/organizations/{organizationId}/treasury?from&to` (OWNER and MANAGER; period rules as FIN-019). Response `{ inflows, outflows, net }` in francs: inflows are PAYMENT entries of relationships where the organization is supplier plus REFUND entries of relationships where it is customer (reversals subtract); outflows are PAYMENT entries where it is customer, REFUND entries where it is supplier, and non-cancelled expenses (reversals subtract). SALE, CREDIT_NOTE and OPENING_BALANCE are not money.
- `GET /api/v1/organizations/{organizationId}/expenses?limit&cursor&from&to` (OWNER and MANAGER): paginated expenses newest first, cancelled ones flagged.
- `finance.openapi.ts` documents the expense routes of FIN-012 and FIN-013 as well.

## Acceptance criteria
```gherkin
Scenario: AC-1 Treasury
  Given payments of 50000 and 20000 received, a refund of 5000 given and an expense of 8000
  When the owner reads the period
  Then inflows are 70000, outflows 13000 and net 57000
Scenario: AC-2 Reversals
  When a payment of 20000 was reversed
  Then inflows are 50000
Scenario: AC-3 Expense list
  Then expenses are listed newest first with cancelled ones flagged and paginated
Scenario Outline: AC-4 Roles and period
  When the request has <case>
  Then the response is <status>
  Examples:
    | case                    | status |
    | a SELLER caller         | 403    |
    | a period of 93 days     | 400    |
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's treasury (horizontal)
  When a member of A reads the treasury of B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/finance/treasury.test.ts`
- Modify: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.service.ts`, `src/modules/finance/finance.schemas.ts`, `src/modules/finance/finance.openapi.ts`
- Pattern: `src/modules/finance/finance.routes.ts`
- Signatures:
  - `treasury(actor: Actor, query: { from?: string; to?: string }): Promise<{ inflows: number; outflows: number; net: number }>`
  - `listExpenses(actor: Actor, query: ListExpensesQuery): Promise<{ items: ExpenseView[]; next_cursor: string | null }>`
- Errors: `FORBIDDEN` 403, `VALIDATION_ERROR` 400, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: owner and manager.
- v5.0.0-15.3.1: totals only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| treasury | integration | AC-1 | 70000, 13000, 57000 |
| reversals | integration | AC-2 | 50000 |
| expenses | integration | AC-3 | order, flags, paging |
| roles and period | integration | AC-4 | each Examples row → status |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/finance/treasury.test.ts`

## Out of scope
- Quantities sold and bought per article (a read on delivered lines, ORD-022).
