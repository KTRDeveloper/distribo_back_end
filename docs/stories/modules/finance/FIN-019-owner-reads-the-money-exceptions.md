---
id: FIN-019
title: Owner reads the money exceptions
module: finance
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [FIN-016, ORD-013, FIN-004, FIN-010]
read_first: [src/modules/finance/finance.service.ts, src/modules/order/order.repository.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, finances/expense]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# FIN-019 — Owner reads the money exceptions

## Story
As an owner, I want the money gestures made by other people grouped by person so that I see at a glance what left without a customer asking.

## Context
- Exists: ledger, expenses, handovers, order lines with `price_set_by_id`.
- Adds: `GET /api/v1/organizations/{organizationId}/exceptions/money?from&to` (OWNER only, others 403; `from` and `to` ISO dates, at most 92 days apart, default the last 7 days). Response `{ items: [{ person_id, refunds: { count, amount }, credit_notes: { count, amount }, reversals: { count, amount }, expenses: { count, amount }, price_gaps: { count, amount } }] }`, one item per collaborator other than the owner who did at least one, sorted by total amount.
- Counted gestures: REFUND and CREDIT_NOTE entries recorded by the person (not reversals); reversal entries, cancelled expenses and cancelled handovers by the person (cancelled_by); non-cancelled expenses recorded by the person; order lines whose `price_set_by_id` is the person and whose applied price is below the reference (amount = (reference − applied) × delivered quantity, else ordered quantity, rounded like a line). Dates: `occurred_at`, `cancelled_at`, `price_set_at`.
- Abandoned rests of partial deliveries are added by DLV-012.

## Acceptance criteria
```gherkin
Scenario: AC-1 Grouped by person
  Given Jean recorded 2 refunds and 1 expense, and Paul gave 12 price gaps
  When the owner reads the last 7 days
  Then two items are returned, each with its counts and amounts
Scenario: AC-2 Owner's own gestures excluded
  Then gestures recorded by the owner never appear
Scenario: AC-3 Period
  When a gesture is older than `from`
  Then it is not counted
Scenario Outline: AC-4 Validation and roles
  When the request has <case>
  Then the response is <status>
  Examples:
    | case                              | status |
    | a MANAGER caller                  | 403    |
    | a period of 93 days               | 400    |
    | from after to                     | 400    |
Scenario: AC-5 Price gap value
  When a line was sold at 3000 for a reference of 3200, quantity 7
  Then the gap amount is 1400
```

## Abuse cases
```gherkin
Scenario: AB-1 Nothing hidden from the owner (repudiation)
  When a manager records a refund and later reverses it
  Then both the refund and the reversal appear under the manager's name
Scenario: AB-2 Another business (horizontal)
  When a member of A requests the exceptions of B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/finance/money-exceptions.test.ts`
- Modify: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.service.ts`, `src/modules/finance/finance.schemas.ts`, `src/modules/finance/finance.openapi.ts`
- Pattern: `src/modules/finance/finance.routes.ts`
- Signatures:
  - `moneyExceptions(actor: Actor, query: { from?: string; to?: string }): Promise<{ items: MoneyExceptionItem[] }>`
- Errors: `FORBIDDEN` 403, `VALIDATION_ERROR` 400, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: owner only.
- v5.0.0-8.2.3: only person ids and totals are returned.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| grouped | integration | AC-1 | two items |
| owner excluded | integration | AC-2 | none for the owner |
| period | integration | AC-3 | old gesture ignored |
| validation | integration | AC-4 | each Examples row → status |
| price gap value | integration | AC-5 | 1400 |
| nothing hidden | security | AB-1, CWE-778 | both listed |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/finance/money-exceptions.test.ts`

## Out of scope
- Synchronization exceptions (SYNC module).
