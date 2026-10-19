# Execution report: billing

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

<!-- begin BIL-008 -->
## BIL-008 — Payment aggregator port with a fake adapter

- Filed: 2026-10-19 15:19 UTC
- Status: **done**: port, fake adapter and PAYMENT_DRIVER; 15 tests pass
- Risk: high · story: [BIL-008-payment-aggregator-port-with-a-fake-adapter.md](../modules/billing/BIL-008-payment-aggregator-port-with-a-fake-adapter.md)
- Agent: 32,221 tokens, 14 tool uses, 3 min 11 s

### Agent report

**Summary:** Added PaymentAggregator port, FakeAggregator, getPaymentAggregator() and PAYMENT_DRIVER (fake only) in env and .env.example.

**Decisions:**
- `confirmationFor` returns `{ headers, rawBody }` (rawBody = JSON `{ providerReference }`): the story gave no shape; this feeds `verifyConfirmation` directly.
- `settle` without `paidAt` uses now for SUCCEEDED, null otherwise; unknown reference throws Error (test helper).
- `listStatement(day)` lists payments whose `paidAt` falls on that UTC day (unsettled ones have none).
- Fake methods return `Promise.resolve/reject` instead of `async` (lint rule require-await); a bad amount is a rejected RangeError.

**Tests added beyond the story:**
- `tests/unit/billing/aggregator-fake.test.ts` › different clientReferences give different references; passed at once
- same › amount 0 or less rejects with RangeError (Security v5.0.0-2.2.1); passed at once
- same › signed body without a string providerReference gives null (fail closed); passed at once
- same › reset forgets payments; getPaymentAggregator returns one fake instance (story Context); passed at once

**Evidence:** story tests 15/15; full suite 3318/3319 on first run, the one failure (quality-gates lint check) came from my 3 lint errors, fixed, file rerun 5/5, 0 known; typecheck clean; lint 0 errors, 140 warnings (existing)

**Follow-ups:**
- Tests and implementation were written in one pass, so no separate red run was observed.
<!-- end BIL-008 -->

<!-- begin BIL-010 -->
## BIL-010 — Plan arithmetic for upgrades, queues and grace

- Filed: 2026-10-19 15:21 UTC
- Status: **done**: plan-math.ts pure; 17 unit tests, suite green
- Risk: medium · story: [BIL-010-plan-arithmetic-for-upgrades-queues-and-grace.md](../modules/billing/BIL-010-plan-arithmetic-for-upgrades-queues-and-grace.md)
- Agent: 23,118 tokens, 11 tool uses, 1 min 48 s

### Agent report

**Summary:** Added pure `src/modules/billing/plan-math.ts` (rank, addMonths, addDays, GRACE_DAYS, convertRemainingDays) with unit tests; done.

**Decisions:**
- Conversion uses BigInt: sum of remainingMs x price(plan), one ceiling division by price(to) x 86 400 000.
- Strictly lower plan required (rank(part) < rank(to)); this also refuses PRO to PRO and anything to FREE.
- `remainingMs` must be a safe non-negative integer, else RangeError (NaN, Infinity and fractions too).

**Tests added beyond the story:**
- `tests/unit/billing/plan-math.test.ts` › non-finite or fractional remainingMs: refused with RangeError (ASVS 2.2.1, Security section); passed at once? no, written before the code
- same file › one bad part among good ones refuses the whole call (fail closed)
- same file › addMonths does not mutate its input date

**Evidence:** story tests 17/17; full suite 3336/3336, failing: none, 0 known; typecheck clean; lint 0 errors, 142 warnings (existing)
<!-- end BIL-010 -->

<!-- begin BIL-001 -->
## BIL-001 — Table of subscription payments

- Filed: 2026-10-19 15:46 UTC
- Status: **done**: subscription_payments table, enums, trigger and grants; 42 tests
- Risk: high · story: [BIL-001-table-of-subscription-payments.md](../modules/billing/BIL-001-table-of-subscription-payments.md)
- Agent: 48,548 tokens, 22 tool uses, 3 min 13 s

### Agent report

**Summary:** Migration 20261019070000_bil_001_subscription_payments creates the PaidPlan, PaymentOperator and PaymentStatus enums, the `subscription_payments` table, its CHECKs, the update trigger and the grants. `schema.prisma` has the model and the plain-words comment.

**Decisions:**
- `customer_tax_id` (nullable text): the story does not list it, but the design table (5.5) has it, so the column exists. The trigger freezes it with the other fields.
- "Empty" payer number: I read it as NULL. Added a CHECK that a given number is not blank.
- A status written unchanged (PENDING to PENDING with a new `provider_payload`) is allowed. The trigger only refuses an actual status move that breaks the rule.
- Trigger also freezes `id`, `organization_id`, `operator`, `terms_version`, `created_at`: the story says only status, payload and confirmed_at may change.
- Only DELETE and TRUNCATE are revoked. The default grant already gives distribo_app SELECT, INSERT and UPDATE.

**Tests added beyond the story:**
- `subscription-payments-table.test.ts` › wrong rows: unknown operator or status (22P02), unknown organization (23503), MTN without payer number, PENDING with confirmed_at (the C-53 rules and the story's `operator:enum`, `status:enum` and `fk` rows); passed at once
- `subscription-payments-table.test.ts` › moves: PENDING to FAILED/EXPIRED, SUCCEEDED to FAILED, EXPIRED/REFUNDED to SUCCEEDED, REFUNDED to PENDING (C-53 status rule); passed at once
- `subscription-payments-table.test.ts` › frozen: operator, organization_id, terms_version, created_at, id, and amount changed in the same statement as a legal status move (the trigger rule "only status, payload, confirmed_at may change"); passed at once
- `subscription-payments-table.test.ts` › wrong rows: months 1, 3, 6 and 12 accepted, and an administrator payment (OTHER, no number) accepted (C-53); passed at once

**Evidence:** story tests 42/42; full suite 3446/3446, failing: none, 0 known; typecheck clean; lint 0 errors, 146 warnings (existing)

**Follow-ups:**
- TDD order: I wrote the migration before running the tests, so I never saw them fail first. They only passed after the migration existed.
- `prisma migrate diff` against the dev DB shows unrelated drift (dev_migration_1 drift is already known). I did not check the schema against a clean migrated DB. Check it if the CI has a drift check.
- This story adds no route, so there is no catalog.test.ts or per-001 change.
<!-- end BIL-001 -->
