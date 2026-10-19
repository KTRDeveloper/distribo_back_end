---
id: BIL-014
title: A confirmed payment activates one period and its receipt
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-009, BIL-012, BIL-013, BIL-020, BIL-027, BIL-008]
read_first: [src/modules/billing/payment.repository.ts, src/modules/billing/upgrade.service.ts]
design_refs: [finances/subscription/plans-on-paie-pour-son-equipe, finances/subscriptionpayment]
constraints: [C-53]
asvs: [v5.0.0-2.3.3, v5.0.0-8.2.1, v5.0.0-16.3.1]
---

# BIL-014 — A confirmed payment activates one period and its receipt

## Story
Technical story: give billing the one function that turns a confirmed payment into a period, a receipt and new rights, once, in one transaction, so that a payment is never counted twice or half done.

## Context
- Exists: payments (BIL-009), `getPaymentAggregator` (BIL-008), `addPaidForfait` (BIL-027), `issueReceipt` (BIL-012), `recomputeRights` (BIL-013), `enforceLimits` (BIL-020), `insertEvent`, `findOrganizationSummary` (ORG-044).
- `payment.repository.ts` gains `findPaymentByReference`, `lockPayment` (`FOR UPDATE`) and `setPaymentOutcome`.
- `confirmPayment(providerReference, receivedBody, now)` in the new `confirmation.service.ts`: no payment is 404 `NOT_FOUND`; not PENDING is `ALREADY_DONE`. `getStatus` runs outside the transaction: PENDING gives `STILL_PENDING`; FAILED or EXPIRED sets the payment to that status (`FAILED`, `EXPIRED`); SUCCEEDED for another amount logs `warn` event `payment_amount_mismatch` (payment id) and throws 409 `PAYMENT_MISMATCH`.
- SUCCEEDED for the right amount, in one transaction: lock the payment, recheck PENDING (else `ALREADY_DONE`); set SUCCEEDED, `confirmed_at = now`, `provider_payload = { received, checked }`; `addPaidForfait`; `issueReceipt` with the business name; a PAYMENT event (actor PAYER); `recomputeRights`; `enforceLimits`. Outcome `ACTIVATED`. The owner's notice is BIL-035.
- `C-53`: `SubscriptionPayment`: `provider_reference` is unique; `months` is 1, 3, 6 or 12; `amount` is computed by the server from the price grid; status moves only from PENDING to another value, then from SUCCEEDED to REFUNDED; `confirmed_at` is set exactly when status is SUCCEEDED or REFUNDED; `operator = OTHER` exactly when an administrator recorded the payment, and `payer_phone_number` is set otherwise.

## Acceptance criteria
```gherkin
Scenario: AC-1 Activation
  Given a PENDING ESSENTIAL 3-month payment of 15000, the aggregator saying SUCCEEDED for 15000, and 2 collaborators paused under the free plan
  When `confirmPayment` runs with an empty queue
  Then the payment is SUCCEEDED with `confirmed_at`, an ACTIVE 3-month period carries its id, a receipt and one PAYMENT event exist, the business is ESSENTIAL with 5 collaborators, the 2 collaborators are back and the outcome is `ACTIVATED`
Scenario: AC-2 A replay
  When `confirmPayment` runs twice for one payment
  Then the second outcome is `ALREADY_DONE` and one period and one receipt exist
Scenario Outline: AC-3 Not paid
  When the aggregator says <says>
  Then the outcome is <result> and no period or receipt is added
  Examples:
    | says    | result                             |
    | PENDING | `STILL_PENDING`, payment unchanged |
    | FAILED  | `FAILED`, payment FAILED           |
    | EXPIRED | `EXPIRED`, payment EXPIRED         |
    | unknown | 404 `NOT_FOUND`                    |
Scenario: AC-4 Another amount
  When the aggregator says SUCCEEDED for 5000 on a payment of 15000
  Then 409 `PAYMENT_MISMATCH` is thrown, the payment stays PENDING and one `warn` log holds the payment id only
```

## Abuse cases
```gherkin
Scenario: AB-1 A failure leaves a half-done payment (tampering)
  When issuing the receipt throws during a confirmation
  Then the payment is still PENDING and no period, receipt or event exists
Scenario: AB-2 Two confirmations arrive at once (race, T3)
  When `confirmPayment` runs twice in parallel
  Then one period and one receipt exist
```

## Implementation
- Create: `src/modules/billing/confirmation.service.ts`, `tests/integration/billing/confirm-payment.test.ts`
- Modify: `src/modules/billing/payment.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `confirmPayment(providerReference: string, receivedBody: unknown, now: Date): Promise<ConfirmOutcome>`
- Types:
  - `ConfirmOutcome = 'ACTIVATED' | 'ALREADY_DONE' | 'STILL_PENDING' | 'FAILED' | 'EXPIRED'`
- Errors: `NOT_FOUND` 404, `PAYMENT_MISMATCH` 409
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: status, period, receipt, event, rights and limits are written in one transaction.
- v5.0.0-8.2.1: the status comes from the aggregator, not from the caller.
- v5.0.0-16.3.1: logs hold the payment id only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| activation | integration | AC-1, C-53 | rows, seats back, outcome |
| replay | integration | AC-2 | ALREADY_DONE, single rows |
| not paid | integration | AC-3 | each Examples row → outcome |
| mismatch | integration | AC-4 | 409, PENDING, log content |
| half done | security | AB-1, CWE-367 | receipt throws → nothing written |
| race | security | AB-2, CWE-362 | parallel calls → one period |

Command: `npx vitest run tests/integration/billing/confirm-payment.test.ts`

## Out of scope
- The owner's notice: BIL-035. The route the aggregator calls: BIL-034. Payments never confirmed: BIL-021, BIL-022.
