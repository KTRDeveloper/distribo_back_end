---
id: BIL-022
title: The nightly check compares payments with the aggregator's statement
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-021]
read_first: [src/modules/billing/payment.repository.ts, src/jobs/reconcile.ts]
design_refs: [finances/subscriptionpayment]
constraints: [C-53]
asvs: [v5.0.0-16.3.3, v5.0.0-16.5.3]
---

# BIL-022 — The nightly check compares payments with the aggregator's statement

## Story
Technical story: give billing a nightly check of a day's payments against the aggregator's statement, so that money without a plan, or a plan without money, is found the next morning.

## Context
- Exists: `listStatement(day)` returns every aggregator payment of a UTC day as `AggregatorPayment` (BIL-008); payments (BIL-009).
- `payment.repository.ts` gains `findPaymentsByReferences(references)` and `listConfirmedOn(day)` (SUCCEEDED payments whose `confirmed_at` falls in that UTC day), each with id, status, amount and provider reference.
- `reconcilePayments(day, now)` in the new `reconcile.service.ts` reads the statement and the local rows and returns the mismatches, ids only, each with a fixed event:
  - `payment_unknown_locally`: the statement says SUCCEEDED and no local payment has the reference;
  - `money_without_plan`: SUCCEEDED in the statement and the local payment is neither SUCCEEDED nor REFUNDED;
  - `payment_amount_differs`: SUCCEEDED on both sides with different amounts;
  - `plan_without_money`: a local payment confirmed that day with no SUCCEEDED statement line.
- It reports only and repairs nothing (C-53). The job `src/jobs/reconcile-payments.ts` logs each mismatch at `error` with the event and the payment id (the reference when unknown locally), and returns 1 when any exists, else 0. `day` defaults to yesterday UTC; script `job:reconcile-payments`.
- `C-53`: `SubscriptionPayment`: `provider_reference` is unique; `months` is 1, 3, 6 or 12; `amount` is computed by the server from the price grid; status moves only from PENDING to another value, then from SUCCEEDED to REFUNDED; `confirmed_at` is set exactly when status is SUCCEEDED or REFUNDED; `operator = OTHER` exactly when an administrator recorded the payment, and `payer_phone_number` is set otherwise.

## Acceptance criteria
```gherkin
Scenario: AC-1 A clean day
  Given 2 payments settled on 2026-10-11, present on both sides with the same amounts
  When `reconcilePayments('2026-10-11', now)` runs
  Then the list is empty and the job returns 0
Scenario Outline: AC-2 A mismatch
  When <case>
  Then the list holds one mismatch with the event <event>, and the job returns 1
  Examples:
    | case                                                           | event                      |
    | the statement has a SUCCEEDED payment no local row has         | `payment_unknown_locally`  |
    | the statement says SUCCEEDED and the local payment is PENDING  | `money_without_plan`       |
    | both are SUCCEEDED and the amounts differ                      | `payment_amount_differs`   |
    | a local payment confirmed that day has no statement line       | `plan_without_money`       |
Scenario: AC-3 Other states are not mismatches
  Given a REFUNDED local payment and a FAILED statement line for a FAILED local payment
  When it runs
  Then the list is empty
Scenario: AC-4 The logs
  When the job finds a mismatch
  Then one `error` log holds the event and the id, and no amount, phone number or reference of a known payment
Scenario: AC-5 The day
  When the job runs without a day at 2026-10-12T02:00:00Z
  Then it checks 2026-10-11, and `package.json` has the script `job:reconcile-payments`
```

## Abuse cases
```gherkin
Scenario: AB-1 A payer is charged and nothing activates (repudiation, T9)
  Given the aggregator took the money, the confirmation never came and the sweep failed
  When the nightly check runs
  Then it reports `money_without_plan` with the payment id, and changes nothing
```

## Implementation
- Create: `src/modules/billing/reconcile.service.ts`, `src/jobs/reconcile-payments.ts`, `tests/integration/billing/reconcile-payments.test.ts`
- Modify: `src/modules/billing/payment.repository.ts`, `package.json`
- Pattern: `src/jobs/reconcile.ts`
- Signatures:
  - `reconcilePayments(day: string, now: Date): Promise<PaymentMismatch[]>`
  - `runReconcilePaymentsJob(day?: string, now?: Date): Promise<number>`
- Types:
  - `PaymentMismatch = { event: 'payment_unknown_locally' | 'money_without_plan' | 'payment_amount_differs' | 'plan_without_money'; id: string }`
- Dependencies: `@prisma/client`, `pino`

## Security
- v5.0.0-16.3.3: each mismatch is a logged event with a fixed name and an id.
- v5.0.0-16.5.3: a failed read ends the job non-zero, so a broken check is never read as clean.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| clean day | integration | AC-1, C-53 | empty list, exit 0 |
| mismatches | integration | AC-2 | each Examples row → event, exit 1 |
| other states | integration | AC-3 | REFUNDED and FAILED → empty |
| logs | integration | AC-4 | event and id only |
| day | integration | AC-5 | default day, script present |
| charged, no plan | security | AB-1, CWE-778 | money_without_plan, rows unchanged |

Command: `npx vitest run tests/integration/billing/reconcile-payments.test.ts`

## Out of scope
- Repairing a mismatch: an administrator does it (BIL-024, BIL-025). Scheduling the job: Q-010.
