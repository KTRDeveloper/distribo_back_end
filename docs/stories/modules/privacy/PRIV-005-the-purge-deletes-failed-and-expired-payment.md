---
id: PRIV-005
title: The purge deletes failed and expired payment requests after 90 days
module: privacy
kind: change
rev: 1
amends: [PRIV-003]
size: S
risk: high
depends_on: [PRIV-003, BIL-001]
read_first: [src/modules/privacy/purge.service.ts]
design_refs: [donnees-personnelles-et-conservation/durees-de-conservation, finances/subscriptionpayment]
constraints: [CM-44]
asvs: [v5.0.0-14.2.4]
---

# PRIV-005 — The purge deletes failed and expired payment requests after 90 days

## Story
Technical story: let the daily purge delete the subscription payment requests that never succeeded, so that the payer's phone number is not kept longer than 90 days.

## Context
- Exists: `purge(now)` and its `DELETERS` table, one batched delete per table (PRIV-003); `subscription_payments` with `status` and `created_at` (BIL-001). A receipt, a period and an event may cite a payment through `payment_id`.
- New deleter `subscription_payments` in `purge.service.ts`, written like the others (batches of 1000 by physical row id, cutoff computed by the database from `now`): status FAILED or EXPIRED, `created_at` more than 90 days before `now`, and cited by no row of `subscription_receipts`, `subscriptions` or `subscription_events`.
- Rows that succeeded, were refunded or are still pending are commercial data and are never deleted here.
- The counts returned and logged by `purge` gain the key `subscription_payments`.
- Why: a request that never succeeded still holds `payer_phone_number` and the aggregator answer `provider_payload`.
- `CM-44`: The daily purge deletes subscription payment requests that ended FAILED or EXPIRED 90 days after their creation, because they hold the payer's phone number; a payment that succeeded, was refunded, is still pending or is cited by a receipt, a period or an event is never deleted.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Retention of payment requests
  Given a payment request <status> created <age> ago
  When the purge runs
  Then the row is <result>
  Examples:
    | status    | age      | result  |
    | FAILED    | 91 days  | deleted |
    | EXPIRED   | 91 days  | deleted |
    | FAILED    | 89 days  | kept    |
    | PENDING   | 91 days  | kept    |
    | SUCCEEDED | 400 days | kept    |
    | REFUNDED  | 400 days | kept    |
Scenario: AC-2 A cited payment stays
  Given an EXPIRED payment request 91 days old that an event cites
  When the purge runs
  Then the row is kept and the purge does not fail
Scenario: AC-3 Batches and counts
  When 2500 payment requests are due
  Then all are deleted, the counts show `subscription_payments` 2500 and a second run shows 0
```

## Abuse cases
```gherkin
Scenario: AB-1 Purging a payment that happened (tampering)
  When the purge runs on a database with 11-year-old SUCCEEDED and REFUNDED payments that have receipts
  Then they and their receipts are untouched
```

## Implementation
- Create: `tests/integration/privacy/purge-payments.test.ts`
- Modify: `src/modules/privacy/purge.service.ts`
- Pattern: `src/modules/privacy/purge.service.ts`
- Signatures:
  - `purge(now: Date): Promise<Record<string, number>>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-14.2.4: payer phone numbers of requests that never succeeded are removed after 90 days.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| retention | integration | AC-1, CM-44 | each Examples row → deleted or kept |
| cited kept | integration | AC-2 | event cites the row → kept, no error |
| batches | integration | AC-3 | 2500 deleted, then 0 |
| history kept | security | AB-1, CWE-284 | old succeeded and refunded payments untouched |

Command: `npx vitest run tests/integration/privacy/purge-payments.test.ts tests/integration/privacy/purge.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/privacy/purge.test.ts | the expected counts list five tables | add `subscription_payments: 0` (no payment is seeded there) |

## Out of scope
- Settling payments that stay pending (BIL-021). Purging commercial data after 10 years (not in v1).
