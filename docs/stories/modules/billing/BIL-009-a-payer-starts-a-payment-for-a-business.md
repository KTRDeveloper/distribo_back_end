---
id: BIL-009
title: A payer starts a payment for a business
module: billing
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-001, BIL-007, BIL-008, BIL-010, FND-004]
read_first: [src/modules/billing/billing.routes.ts, src/modules/billing/aggregator.port.ts]
design_refs: [finances/subscriptionpayment, finances/subscription/plans-on-paie-pour-son-equipe]
constraints: [C-53]
asvs: [v5.0.0-2.2.1, v5.0.0-2.2.3, v5.0.0-2.4.1, v5.0.0-15.3.3]
---

# BIL-009 — A payer starts a payment for a business

## Story
As a visitor, I want to pay a plan for a business with my mobile-money number so that the business gets the plan I chose.

## Context
- Exists: BIL-001, 007, 008, `priceFor` (FND-014), `normalizeE164`, `findOrganizationByPaymentCode` (ORG-044), `checkAndConsume`.
- `POST /api/v1/billing/payments`, public. Body, strict: `id` (UUIDv7, the payment id), `code` (as in BIL-007), `plan` (ESSENTIAL, PRO, ENTERPRISE), `months` (1, 3, 6, 12), `operator` (MTN_MOMO, ORANGE_MONEY), `payer_phone_number` (`normalizeE164`, else 400), `customer_tax_id` (optional, 1 to 20 letters and digits), `terms_version` (at most 20 characters).
- Order: validation; limits of 10 an hour per `req.ip` (`billing:pay:<ip>`) and 5 an hour per payer number (hashed), provisional, else 429 `RATE_LIMITED` and `warn` event `payment_create_rate_limited`; business ACTIVE (else 404); `terms_version` equal to `CURRENT_TERMS_VERSION` (provisional constant in `payment.service.ts`), else 409 `TERMS_CHANGED`.
- Then, in one transaction with a lock on the id: a stored payment with the same business, plan, months, operator and number is answered again; another body gives 409 `PAYMENT_ID_USED`. Else the amount is `priceFor`, `requestPayment({ clientReference: id, … })` runs and the row is inserted PENDING with its reference. An aggregator failure is rethrown: nothing stored.
- Answer 201 with the `PaymentView` fields.
- `C-53`: `SubscriptionPayment`: `provider_reference` is unique; `months` is 1, 3, 6 or 12; `amount` is computed by the server from the price grid; status moves only from PENDING to another value, then from SUCCEEDED to REFUNDED; `confirmed_at` is set exactly when status is SUCCEEDED or REFUNDED; `operator = OTHER` exactly when an administrator recorded the payment, and `payer_phone_number` is set otherwise.

## Acceptance criteria
```gherkin
Scenario: AC-1 A payment starts
  When a visitor sends ESSENTIAL, 3 months, MTN_MOMO, a valid number, a NIU and the current terms version
  Then the answer is 201, amount 15000, PENDING; one row holds the amount, the aggregator's reference, the terms version and the NIU; the aggregator got one request
Scenario: AC-2 A repeat
  When the same body is sent twice with one `id`
  Then the answers are equal, with one row and one aggregator request; the same `id` with another plan answers 409 `PAYMENT_ID_USED`
Scenario Outline: AC-3 Refused, nothing stored, no aggregator call
  When the request has <problem>
  Then the answer is <answer>
  Examples:
    | problem                                                  | answer                 |
    | plan FREE, months 2, an invalid number, or a long NIU    | 400 `VALIDATION_ERROR` |
    | an unknown, SUSPENDED or CLOSED business                 | 404 `NOT_FOUND`        |
    | an older terms version                                   | 409 `TERMS_CHANGED`    |
```

## Abuse cases
```gherkin
Scenario: AB-1 The browser chooses the amount (tampering, T2)
  When the body carries `amount` 1
  Then the answer is 400 `VALIDATION_ERROR`, no row exists and the aggregator is not called
Scenario: AB-2 A flood, or a stranger's phone harassed (denial of service)
  When one address sends 11 payments in an hour, or 6 requests name one payer number
  Then the 11th and the 6th answer 429 `RATE_LIMITED` before any read
```

## Implementation
- Create: `src/modules/billing/payment.repository.ts`, `src/modules/billing/payment.service.ts`, `tests/integration/billing/payment-create.test.ts`
- Modify: `src/modules/billing/billing.routes.ts`, `src/modules/billing/billing.schemas.ts`, `src/modules/billing/billing.openapi.ts`
- Pattern: `tests/integration/auth/register-request.test.ts`
- Signatures:
  - `createPayment(input: CreatePaymentInput, ip: string): Promise<PaymentView>`
- Types:
  - `CreatePaymentInput = the body fields in camelCase; payerPhoneNumber is already normalized; customerTaxId: string | null`
  - `PaymentView = { id; status; plan; months; amount: bigint; operator }`
- Errors: `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `TERMS_CHANGED` 409, `PAYMENT_ID_USED` 409, `RATE_LIMITED` 429
- Dependencies: `zod`, `express`

## Security
- v5.0.0-2.2.1: closed lists and a body that names every writable field.
- v5.0.0-2.2.3: the amount comes from the server's grid, never from the request.
- v5.0.0-2.4.1: creation is limited per address and per payer number.
- v5.0.0-15.3.3: the answer lists six fields, no number or reference.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| starts | integration | AC-1, C-53 | 201, row, one aggregator request |
| repeat | integration | AC-2 | equal answers, one row; other plan → 409 |
| refused | integration | AC-3 | each Examples row → answer, nothing stored |
| browser amount | security | AB-1, CWE-915 | amount sent → 400, no row |
| flood | security | AB-2, CWE-770 | 11th and 6th → 429 |

Command: `npx vitest run tests/integration/billing/payment-create.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the payments path | add POST /api/v1/billing/payments, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the payments path | add POST /api/v1/billing/payments, remove nothing |

## Out of scope
- Activation: BIL-014, BIL-034. Reading the status: BIL-015.
