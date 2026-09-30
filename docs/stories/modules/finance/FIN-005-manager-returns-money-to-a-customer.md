---
id: FIN-005
title: Manager returns money to a customer
module: finance
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [FIN-004, ACC-004, NTF-002]
read_first: [src/modules/finance/finance.service.ts, src/modules/finance/ledger.service.ts]
design_refs: [finances/ledgerentry]
constraints: [C-23]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-15.3.3]
---

# FIN-005 — Manager returns money to a customer

## Story
As a manager, I want to record money I give back to a customer so that their balance and my held money are right.

## Context
- Exists: `recordPayment` route file (FIN-004); rule `create` LedgerEntry kind REFUND for MANAGER online, OWNER always (ACC-004); `appendLedgerEntry`; `notify`.
- Adds: `POST /api/v1/organizations/{organizationId}/customers/{relationshipId}/refunds` with `{ id, amount, mode, transaction_reference?, note? }` (same limits as a payment); response 201 `LedgerEntryView`.
- A REFUND raises the balance by the amount and lowers the recorder's held money by it. A registered customer is notified `balance.increased`.
- Refused: a counter (409 `COUNTER_ONLY_RETURNS`, use FIN-008); a PENDING relationship; an organization that is not ACTIVE (409 `ORGANIZATION_NOT_ACTIVE`); the manager's own customer record or that of an organization they manage as customer (403 `OWN_RECORD`).
- `C-23`: `LedgerEntry.amount` > 0; `balance_effect` is a generated column of `kind`, `amount` and `reverses_entry_id`; `mode` is set if and only if `kind` is PAYMENT or REFUND.

## Acceptance criteria
```gherkin
Scenario: AC-1 Refund
  Given balance 0 and a manager holding 30000
  When they record a refund of 10000 in cash
  Then the response is 201, balance is 10000 and amount_held is 20000
Scenario: AC-2 Customer notified
  Then a registered customer has one unread `balance.increased`
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is stored
  Examples:
    | problem                                   | status                      |
    | a SELLER or DRIVER caller                 | 403 FORBIDDEN               |
    | a counter                                 | 409 COUNTER_ONLY_RETURNS    |
    | the manager's own record                  | 403 OWN_RECORD              |
    | amount 0 or mode missing                  | 400 VALIDATION_ERROR        |
    | a CLOSED organization                     | 409 ORGANIZATION_NOT_ACTIVE |
```

## Abuse cases
```gherkin
Scenario: AB-1 Double refund by retry (tampering)
  When the same id is posted twice
  Then one entry exists and money leaves once
Scenario: AB-2 Seller gives money back (vertical)
  When a SELLER or DRIVER posts
  Then the response is 403 and nothing is stored
```

## Implementation
- Create: `tests/integration/finance/refund.test.ts`
- Modify: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.schemas.ts`, `src/modules/finance/finance.service.ts`
- Pattern: `src/modules/finance/finance.routes.ts`
- Signatures:
  - `recordRefund(actor: Actor, relationshipId: string, input: PaymentInput): Promise<LedgerEntryView>`
- Errors: `COUNTER_ONLY_RETURNS` 409, `OWN_RECORD` 403, `ORGANIZATION_NOT_ACTIVE` 409, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner.
- v5.0.0-2.3.3: entry and caches in one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| refund | integration | AC-1, C-23 | balance +10000, held −10000 |
| notified | integration | AC-2 | notification |
| refusals | integration | AC-3 | each Examples row → status |
| retry | security | AB-1, CWE-362 | one entry |
| seller | security | AB-2, WSTG-ATHZ-03 | 403 |

Command: `npx vitest run tests/integration/finance/refund.test.ts`

## Out of scope
- The owner's exceptions view of refunds (FIN-019).
