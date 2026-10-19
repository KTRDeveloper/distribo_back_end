---
id: BIL-021
title: Old pending payments are settled with the aggregator
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-014]
read_first: [src/modules/billing/confirmation.service.ts, src/modules/billing/payment.repository.ts]
design_refs: [finances/subscriptionpayment]
constraints: [C-53]
asvs: [v5.0.0-2.3.3, v5.0.0-16.5.3]
---

# BIL-021 — Old pending payments are settled with the aggregator

## Story
Technical story: give billing a job that asks the aggregator about payments still pending after a while, so that a lost confirmation never leaves a paid business without a plan.

## Context
- Exists: `confirmPayment` (BIL-014), payments (BIL-009).
- `payment.repository.ts` gains `listStalePending(before, limit)`: PENDING payments created at or before `before`, oldest first, with id, provider reference and `created_at`.
- `settlePendingPayments(now)` in the new `settle.service.ts` reads at most `SETTLE_BATCH` (200) payments pending for `SETTLE_AFTER_MINUTES` (15, provisional) and calls `confirmPayment(providerReference, null, now)` for each. Only the aggregator's answer settles a payment, never the clock (C-53).
- The outcomes `ACTIVATED`, `FAILED`, `EXPIRED`, `STILL_PENDING` fill `activated`, `failed`, `expired`, `pending`; every payment read is in `checked`.
- An anomaly is 404 `NOT_FOUND` (reference unknown to the aggregator), 409 `PAYMENT_MISMATCH`, or a payment pending for more than `PENDING_TOO_LONG_HOURS` (24, provisional). It logs `warn` event `payment_settle_anomaly` with the payment id, and the loop goes on.
- Any other error is logged at `error` with the payment id; the loop goes on and the first one is rethrown after it.
- Job `src/jobs/settle-payments.ts`: `runSettlePaymentsJob(now)` logs the report at `info`, returns 1 when `anomalies` is above 0, else 0; script `job:settle-payments`.
- `C-53`: `SubscriptionPayment`: `provider_reference` is unique; `months` is 1, 3, 6 or 12; `amount` is computed by the server from the price grid; status moves only from PENDING to another value, then from SUCCEEDED to REFUNDED; `confirmed_at` is set exactly when status is SUCCEEDED or REFUNDED; `operator = OTHER` exactly when an administrator recorded the payment, and `payer_phone_number` is set otherwise.

## Acceptance criteria
```gherkin
Scenario: AC-1 A missed confirmation
  Given a PENDING 3-month ESSENTIAL payment of 15000 created 20 minutes ago, and the aggregator saying SUCCEEDED for 15000
  When `settlePendingPayments` runs
  Then the payment is SUCCEEDED, a period and a receipt exist, and the report is `{ checked: 1, activated: 1, failed: 0, expired: 0, pending: 0, anomalies: 0 }`
Scenario: AC-2 Which payments are read
  Given a PENDING payment 5 minutes old, a FAILED one 1 hour old, and 201 PENDING ones 20 minutes old
  When it runs
  Then the aggregator is asked about 200 of the 201, the oldest first, and about neither of the others
Scenario Outline: AC-3 Not paid yet
  When the aggregator says <says> for a payment 20 minutes old
  Then the payment becomes <status> and the report counts it in <counter>
  Examples:
    | says    | status  | counter   |
    | PENDING | PENDING | `pending` |
    | FAILED  | FAILED  | `failed`  |
    | EXPIRED | EXPIRED | `expired` |
Scenario Outline: AC-4 Anomalies
  When a payment 20 minutes old meets <problem>
  Then one `warn` log with event `payment_settle_anomaly` and its id is written, `anomalies` is 1, the payment is unchanged and the other payments are still settled
  Examples:
    | problem                                           |
    | a reference the aggregator lacks                  |
    | SUCCEEDED for another amount                      |
    | pending for 25 hours                              |
Scenario: AC-5 The job
  When `runSettlePaymentsJob` runs once with an anomaly and once without
  Then it returns 1, then 0
```

## Abuse cases
```gherkin
Scenario: AB-1 The aggregator's confirmation never arrives (denial of service, T9)
  Given a payer who paid and a confirmation call that was lost
  When the job runs 20 minutes later
  Then the plan is active as after the call, once
Scenario: AB-2 One broken payment blocks the others (denial of service)
  Given `confirmPayment` throws on the second of three payments
  When the job runs
  Then the first and third are settled, and the error is logged with the second's id and rethrown after the loop
```

## Implementation
- Create: `src/modules/billing/settle.service.ts`, `src/jobs/settle-payments.ts`, `tests/integration/billing/settle-payments.test.ts`
- Modify: `src/modules/billing/payment.repository.ts`, `package.json`
- Pattern: `src/jobs/reconcile.ts`
- Signatures:
  - `settlePendingPayments(now: Date): Promise<SettleReport>`
  - `runSettlePaymentsJob(now: Date): Promise<number>`
- Types:
  - `SettleReport = { checked: number; activated: number; failed: number; expired: number; pending: number; anomalies: number }`
- Dependencies: `@prisma/client`, `pino`

## Security
- v5.0.0-2.3.3: each payment settles in its own transaction, through `confirmPayment`.
- v5.0.0-16.5.3: an unexpected error is rethrown after the loop, so a broken sweep is never read as clean.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| missed confirmation | integration | AC-1 | activated, report |
| selection | integration | AC-2, C-53 | young and FAILED payments not asked, batch of 200, oldest first |
| not paid | integration | AC-3 | each Examples row → status, counter |
| anomalies | integration | AC-4 | each Examples row → warn, count, others settled |
| job | integration | AC-5 | exit 1, exit 0 |
| lost confirmation | security | AB-1, CWE-754 | no call received → plan active after the sweep |
| broken payment | security | AB-2, CWE-755 | throw on the second → others settled, error rethrown |

Command: `npx vitest run tests/integration/billing/settle-payments.test.ts`

## Out of scope
- The statement check: BIL-022. Scheduling: Q-010.
