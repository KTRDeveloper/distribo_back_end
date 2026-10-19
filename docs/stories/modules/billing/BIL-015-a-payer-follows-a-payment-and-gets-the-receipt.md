---
id: BIL-015
title: A payer follows a payment and gets the receipt
module: billing
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [BIL-009, BIL-014, BIL-012]
read_first: [src/modules/billing/payment.repository.ts, src/modules/billing/billing.routes.ts]
design_refs: [finances/subscriptionpayment, finances/subscriptionreceipt]
constraints: [C-53]
asvs: [v5.0.0-2.4.1, v5.0.0-15.3.1, v5.0.0-2.2.1]
---

# BIL-015 — A payer follows a payment and gets the receipt

## Story
As a visitor, I want to follow my payment and read its receipt so that I know whether the business got its plan.

## Context
- Exists: payments (BIL-009), confirmation (BIL-014), receipts (BIL-012), `findOrganizationSummary` (ORG-044), `checkAndConsume`.
- `GET /api/v1/billing/payments/{id}`, public: the payment id the payer chose is the only key. `id` must be a UUID, else 400 `VALIDATION_ERROR`; no query field. An unknown id answers 404 `NOT_FOUND`.
- At most 120 reads an hour per `req.ip` (key `billing:status:<ip>`, provisional), counted before any read; the next answers 429 `RATE_LIMITED` and logs `warn` event `payment_status_rate_limited`.
- Answer 200 `{ id, status, business_name, plan, months, amount, operator, period, receipt }`. `period` is `{ starts_at, ends_at }` of the period this payment bought, once SUCCEEDED, else null. `receipt` is `{ number, label, customer_name, customer_tax_id, amount_excl_tax, vat_rate_bp, vat_amount, amount, issued_at }` of the RECEIPT row, else null. `findPaymentView(id)` in `payment.repository.ts` reads the three tables.
- `C-53`: `SubscriptionPayment`: `provider_reference` is unique; `months` is 1, 3, 6 or 12; `amount` is computed by the server from the price grid; status moves only from PENDING to another value, then from SUCCEEDED to REFUNDED; `confirmed_at` is set exactly when status is SUCCEEDED or REFUNDED; `operator = OTHER` exactly when an administrator recorded the payment, and `payer_phone_number` is set otherwise.

## Acceptance criteria
```gherkin
Scenario: AC-1 Waiting
  Given a PENDING payment
  When the payer reads it
  Then the answer is 200 with status PENDING, the business name, plan, months, amount and operator, and `period` and `receipt` null
Scenario: AC-2 Paid
  Given a SUCCEEDED payment of 15000 with a NIU
  When the payer reads it
  Then `period` has the dates of the bought period and `receipt` holds the number, the label, the NIU, 12 903 excluding tax, the rate 1925, 2 097 of VAT and 15000
Scenario Outline: AC-3 Other states
  When the payment is <state>
  Then the answer shows status <state>; for REFUNDED the receipt is still the original RECEIPT row
  Examples:
    | state    |
    | FAILED   |
    | EXPIRED  |
    | REFUNDED |
Scenario Outline: AC-4 Refused
  When the request has <problem>
  Then the answer is <answer>
  Examples:
    | problem                  | answer                 |
    | an `id` that is no UUID  | 400 `VALIDATION_ERROR` |
    | an unknown id            | 404 `NOT_FOUND`        |
    | the 121st read in an hour from one address | 429 `RATE_LIMITED` |
```

## Abuse cases
```gherkin
Scenario: AB-1 Reading other payers' NIU and receipts (information disclosure, T5)
  When a stranger reads many ids and one real payment
  Then unknown ids give the same 404, the 121st read gives 429, and the answer holds no payer number, provider reference, payload or business id
```

## Implementation
- Create: `tests/integration/billing/payment-status.test.ts`
- Modify: `src/modules/billing/payment.repository.ts`, `src/modules/billing/payment.service.ts`, `src/modules/billing/billing.routes.ts`, `src/modules/billing/billing.schemas.ts`, `src/modules/billing/billing.openapi.ts`
- Pattern: `tests/integration/auth/register-request.test.ts`
- Signatures:
  - `readPayment(id: string, ip: string): Promise<PaymentStatusView>`
- Types:
  - `PaymentStatusView = { id; status; business_name; plan; months; amount; operator; period: { starts_at; ends_at } | null; receipt: ReceiptView | null }`
- Errors: `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `RATE_LIMITED` 429
- Dependencies: `zod`, `express`

## Security
- v5.0.0-2.4.1: reads are limited per address before any lookup.
- v5.0.0-15.3.1: the answer lists its fields; no number, reference, payload or business id.
- v5.0.0-2.2.1: the id is a UUID and no query field is accepted.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| waiting | integration | AC-1, C-53 | PENDING answer |
| paid | integration | AC-2 | period and receipt fields |
| states | integration | AC-3 | each Examples row → status |
| refused | integration | AC-4 | each Examples row → answer |
| disclosure | security | AB-1, CWE-200 | same 404, 429, no private field |

Command: `npx vitest run tests/integration/billing/payment-status.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the payment status path | add GET /api/v1/billing/payments/{id}, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the payment status path | add GET /api/v1/billing/payments/{id}, remove nothing |

## Out of scope
- The owner's list of receipts: BIL-017.
