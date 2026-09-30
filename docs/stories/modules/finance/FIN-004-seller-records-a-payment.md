---
id: FIN-004
title: Seller records a payment
module: finance
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [FIN-003, REL-009, ACC-004, ACC-007]
read_first: [src/modules/finance/ledger.service.ts, src/modules/relationship/relationship.visibility.ts]
design_refs: [finances/ledgerentry]
constraints: [C-23, C-38]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-15.3.3]
---

# FIN-004 — Seller records a payment

## Story
As a seller, I want to record a customer's payment so that their balance goes down and I hold the money.

## Context
- Exists: `appendLedgerEntry` (FIN-003); rule `create` LedgerEntry kind PAYMENT for SELLER, always (ACC-004); `idempotent()`; `loadActor`.
- Adds: `POST /api/v1/organizations/{organizationId}/customers/{relationshipId}/payments` with `{ id, amount, mode, transaction_reference?, note? }`; `amount` an integer of at least 1, `mode` CASH or MOBILE_MONEY, `transaction_reference` up to 100 characters and only for MOBILE_MONEY, `note` up to 2000. Response 201 `{ id, kind, amount, mode, occurred_at, balance }`.
- The entry is recorded by the caller (who now holds the money), `occurred_at` is server time. The relationship must be the organization's own customer relationship, ACTIVE or ENDED (payments stay possible), not PENDING, and not a counter (409 `COUNTER_ONLY_RETURNS`). A CLOSED organization may record payments; a SUSPENDED one answers 409 `ORGANIZATION_NOT_ACTIVE`.
- `C-23`: `LedgerEntry.amount` > 0; `balance_effect` is a generated column of `kind`, `amount` and `reverses_entry_id`; `mode` is set if and only if `kind` is PAYMENT or REFUND.
- `C-38`: Every online route that changes data carries the client-created id; an id already received changes nothing and returns the first result.

## Acceptance criteria
```gherkin
Scenario: AC-1 Record a payment
  Given a customer with balance 45000
  When a SELLER records 20000 in cash
  Then the response is 201, balance is 25000 and the seller's amount_held is +20000
Scenario: AC-2 Mobile money
  When the mode is MOBILE_MONEY with a reference
  Then the entry stores the reference and the held money counts it
Scenario: AC-3 Advance
  When the payment exceeds the balance
  Then the balance becomes negative and the response is 201
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is stored
  Examples:
    | problem                                     | status                      |
    | amount 0 or 1.5 or negative                 | 400 VALIDATION_ERROR        |
    | mode "CARD"                                 | 400 VALIDATION_ERROR        |
    | a reference with mode CASH                  | 400 VALIDATION_ERROR        |
    | a counter                                   | 409 COUNTER_ONLY_RETURNS    |
    | a PENDING relationship                      | 409 RELATIONSHIP_NOT_ACTIVE |
    | a SUSPENDED organization                    | 409 ORGANIZATION_NOT_ACTIVE |
    | a DRIVER caller                             | 403 FORBIDDEN               |
Scenario: AC-5 Closed business
  When the organization is CLOSED
  Then the payment is accepted
```

## Abuse cases
```gherkin
Scenario: AB-1 Double recording by retry (tampering)
  When the same id is posted twice
  Then one entry exists and both answers are equal
Scenario: AB-2 Client-set fields (mass assignment)
  When the body contains kind, balance_effect, recorded_by_id or occurred_at
  Then the response is 400
Scenario: AB-3 Another business's customer (horizontal)
  When a member of A posts to a relationship of B
  Then the response is 404
```

## Implementation
- Create: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.schemas.ts`, `src/modules/finance/finance.service.ts`, `tests/integration/finance/record-payment.test.ts`
- Modify: `src/app.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `recordPayment(actor: Actor, relationshipId: string, input: PaymentInput): Promise<LedgerEntryView>`
- Types:
  - `PaymentInput = { id: string; amount: number; mode: 'CASH' | 'MOBILE_MONEY'; transaction_reference?: string; note?: string }`
- Errors: `VALIDATION_ERROR` 400, `COUNTER_ONLY_RETURNS` 409, `RELATIONSHIP_NOT_ACTIVE` 409, `ORGANIZATION_NOT_ACTIVE` 409, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: seller and above; the ledger rule carries kind PAYMENT.
- v5.0.0-2.3.3: entry, balance and held money are one transaction.
- v5.0.0-15.3.3: strict schema; the sign and the recorder come from the server.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| record | integration | AC-1, C-23 | balance and held money |
| mobile money | integration | AC-2 | reference stored |
| advance | integration | AC-3 | negative balance |
| refusals | integration | AC-4 | each Examples row → status |
| closed business | integration | AC-5 | 201 |
| retry | security | AB-1, C-38, CWE-362 | one entry |
| client fields | security | AB-2, CWE-915 | 400 |
| other business | security | AB-3, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/finance/record-payment.test.ts`

## Out of scope
- Payments during delivery (DLV module). OpenAPI registration (FIN-010).
