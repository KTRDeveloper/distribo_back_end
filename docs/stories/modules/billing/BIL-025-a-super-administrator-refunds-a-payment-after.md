---
id: BIL-025
title: A super administrator refunds a payment after an error
module: billing
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [BIL-023, BIL-038, BIL-017]
read_first: [src/modules/billing/billing.admin.routes.ts, src/modules/billing/refund.service.ts]
design_refs: [finances/subscriptionpayment, finances/subscriptionreceipt]
constraints: [C-54]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-2.3.3]
---

# BIL-025 — A super administrator refunds a payment after an error

## Story
As a super-admin, I want to refund a payment made by mistake so that the business gets a credit note and its plan stops.

## Context
- Exists: `applyRefund`, `findCreditNoteOfPayment` (BIL-038), `lockPayment` (BIL-014), the receipt view of BIL-017, `recomputeRights`, `enforceLimits`, `notifyOwnerOfAdjustment`, the admin router (BIL-023).
- `POST /api/v1/admin/organizations/{organizationId}/billing/payments/{paymentId}/refund`, same chain as BIL-023. Both ids must be UUIDs; body, strict: `reason` (1 to 2000 characters). The payment id is the key of the gesture.
- `refundPayment(admin, organizationId, paymentId, input, now)`, one transaction: lock the payment; unknown, or of another business, is 404 `NOT_FOUND`; already REFUNDED is answered again with nothing written. Else `recordAdminAction` REFUND_PAYMENT (target the business), `applyRefund`, `recomputeRights`, `enforceLimits`, `notifyOwnerOfAdjustment`.
- Answer 200 `{ payment_id, status: 'REFUNDED', credit_note }`, the credit note being the item of BIL-017.
- `C-54`: `SubscriptionReceipt`: `number` is unique and has no gap; `amount = amount_excl_tax + vat_amount`; `cancels_receipt_id` is set exactly when `kind = CREDIT_NOTE`, and a receipt has at most one credit note; no update, no delete.

## Acceptance criteria
```gherkin
Scenario: AC-1 A refund
  Given a SUCCEEDED ESSENTIAL payment with its receipt and ACTIVE period, and 4 collaborators
  When a super administrator posts a reason
  Then the answer is 200 with the credit note, one `admin_actions` row REFUND_PAYMENT targets the business, the business is on the free plan with its extra collaborators paused, and the owner has one notice
Scenario: AC-2 A repeat
  When the same refund is posted twice
  Then both answers are the same 200, and one credit note, one action and one notice exist
Scenario Outline: AC-3 Refused
  When the request has <problem>
  Then the answer is <answer> and nothing is written
  Examples:
    | problem                                                | answer                         |
    | a PENDING, FAILED or EXPIRED payment                   | 409 `PAYMENT_NOT_REFUNDABLE`   |
    | a payment of another business, or an unknown one       | 404 `NOT_FOUND`                |
    | no reason, an unknown field, an id that is not a UUID  | 400 `VALIDATION_ERROR`         |
    | no administration token                                | 401 `UNAUTHORIZED`             |
```

## Abuse cases
```gherkin
Scenario: AB-1 A moderator refunds a payment (elevation of privilege, T7)
  When a MODERATOR posts a valid refund
  Then the answer is 403 `FORBIDDEN` and the payment, receipts and periods are unchanged
Scenario: AB-2 A payment of another business under a business id (information disclosure)
  When the path names business A and the payment of business B
  Then the answer is 404 and nothing of B changes
```

## Implementation
- Create: `src/modules/billing/refund-payment.service.ts`, `tests/integration/billing/refund-gesture.test.ts`
- Modify: `src/modules/billing/billing.admin.routes.ts`, `src/modules/billing/billing.schemas.ts`, `src/modules/billing/billing.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `refundPayment(admin: { administratorId: string }, organizationId: string, paymentId: string, input: { reason: string }, now: Date): Promise<RefundView>`
- Types:
  - `RefundView = { payment_id: string; status: 'REFUNDED'; credit_note: ReceiptView }`
- Errors: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `PAYMENT_NOT_REFUNDABLE` 409
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: the role is checked before the body is read; only a SUPER_ADMIN passes.
- v5.0.0-8.2.2: the payment must belong to the business of the path, else 404.
- v5.0.0-2.3.3: action, refund, rights and notice are written in one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| refund | integration | AC-1, C-54 | answer, action, free plan, notice |
| repeat | integration | AC-2 | same answer, single rows |
| refused | integration | AC-3 | each Examples row → answer, no rows |
| moderator | security | AB-1, CWE-269 | 403, nothing changed |
| other business | security | AB-2, CWE-639 | 404, B unchanged |

Command: `npx vitest run tests/integration/billing/refund-gesture.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the refund path | add POST /api/v1/admin/organizations/{organizationId}/billing/payments/{paymentId}/refund, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the refund path | add POST /api/v1/admin/organizations/{organizationId}/billing/payments/{paymentId}/refund, remove nothing |

## Out of scope
- Returning the money to the payer: done outside Distribo. Which periods a refund ends is open (Q-043).
