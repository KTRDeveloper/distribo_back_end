---
id: BIL-024
title: A super administrator records a payment made outside the aggregator
module: billing
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-023, BIL-012, BIL-015, BIL-027]
read_first: [src/modules/billing/billing.admin.routes.ts, src/modules/billing/payment.repository.ts]
design_refs: [finances/subscriptionpayment]
constraints: [C-53]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-15.3.3]
---

# BIL-024 — A super administrator records a payment made outside the aggregator

## Story
As a super-admin, I want to record a payment a business made outside the aggregator so that it gets its plan and its receipt.

## Context
- Exists: `addPaidForfait` (BIL-027), `issueReceipt` (BIL-012), `findPaymentView` (BIL-015), `priceFor` (FND-014), the admin router and the helpers of BIL-023.
- `POST /api/v1/admin/organizations/{organizationId}/billing/payments`, same chain as BIL-023. Body, strict: `id` (UUIDv7, the payment id), `plan`, `months` (1, 3, 6 or 12), optional `customer_tax_id` (1 to 20 letters or digits), `reason` (1 to 2000 characters). No amount: the server prices it.
- `payment.repository.ts` gains `insertRecordedPayment`: SUCCEEDED, operator OTHER, no payer number, `provider_reference` `ADMIN-<id>`, `terms_version` `ADMIN`, `confirmed_at = now`.
- `recordPayment(admin, organizationId, input, now)`, one transaction: unknown business is 404 `NOT_FOUND`; lock the business; a payment with this `id` of the same business, plan and months is answered again, any other is 409 `ID_USED`. Else `recordAdminAction` RECORD_PAYMENT, `insertRecordedPayment`, `addPaidForfait` (actor ADMINISTRATOR), `issueReceipt` with the business name, a PAYMENT event (actor ADMINISTRATOR), `recomputeRights`, `enforceLimits`, `notifyOwnerOfAdjustment`.
- Answer 201 with the payment view of BIL-015.
- `C-53`: `SubscriptionPayment`: `provider_reference` is unique; `months` is 1, 3, 6 or 12; `amount` is computed by the server from the price grid; status moves only from PENDING to another value, then from SUCCEEDED to REFUNDED; `confirmed_at` is set exactly when status is SUCCEEDED or REFUNDED; `operator = OTHER` exactly when an administrator recorded the payment, and `payer_phone_number` is set otherwise.

## Acceptance criteria
```gherkin
Scenario: AC-1 A recorded payment
  Given a business on the free plan
  When a super administrator posts plan ESSENTIAL, 3 months, the NIU `P123456789012A` and a reason
  Then the answer is 201 with status SUCCEEDED, operator OTHER, amount 15000 and an ACTIVE period of 3 months; the payment has no payer number; the receipt shows the business name and that NIU; one RECORD_PAYMENT action, one PAYMENT event and one owner's notice exist
Scenario: AC-2 A repeat
  When the same body is posted twice, then once with the same `id` and another plan
  Then the second answer is 201 with the same payment, the third is 409 `ID_USED`, and one payment, period, receipt and action exist
Scenario Outline: AC-3 Refused
  When the request has <problem>
  Then the answer is <answer> and nothing is written
  Examples:
    | problem                                                             | answer                 |
    | an `amount` field, months 2, plan FREE, no reason, a NIU with a space | 400 `VALIDATION_ERROR` |
    | no administration token                                             | 401 `UNAUTHORIZED`     |
    | an unknown business                                                 | 404 `NOT_FOUND`        |
```

## Abuse cases
```gherkin
Scenario: AB-1 A moderator records a payment (elevation of privilege, T7)
  When a MODERATOR posts a valid body
  Then the answer is 403 `FORBIDDEN` and no payment, period or action exists
Scenario: AB-2 A failure leaves a half-done payment (tampering)
  When issuing the receipt throws
  Then no payment, period, action or event exists
```

## Implementation
- Create: `src/modules/billing/record-payment.service.ts`, `tests/integration/billing/record-payment.test.ts`
- Modify: `src/modules/billing/billing.admin.routes.ts`, `src/modules/billing/billing.schemas.ts`, `src/modules/billing/billing.openapi.ts`, `src/modules/billing/payment.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `recordPayment(admin: { administratorId: string }, organizationId: string, input: RecordPaymentInput, now: Date): Promise<PaymentView>`
- Types:
  - `RecordPaymentInput = { id: string; plan: PaidPlanCode; months: PackMonths; customer_tax_id?: string; reason: string }`
- Errors: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `ID_USED` 409
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: the role is checked before the body is read; only a SUPER_ADMIN passes.
- v5.0.0-2.3.3: payment, period, receipt, event, action and notice are written in one transaction.
- v5.0.0-15.3.3: the amount, status and operator are never read from the body.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| recorded | integration | AC-1, C-53 | answer, rows, receipt NIU |
| repeat | integration | AC-2 | same answer, 409, single rows |
| refused | integration | AC-3 | each Examples row → answer, no rows |
| moderator | security | AB-1, CWE-269 | 403, no rows |
| half done | security | AB-2, CWE-367 | receipt throws → nothing written |

Command: `npx vitest run tests/integration/billing/record-payment.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the recorded-payment path | add POST /api/v1/admin/organizations/{organizationId}/billing/payments, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the recorded-payment path | add POST /api/v1/admin/organizations/{organizationId}/billing/payments, remove nothing |

## Out of scope
- The NIU format is not checked (Q-043).
