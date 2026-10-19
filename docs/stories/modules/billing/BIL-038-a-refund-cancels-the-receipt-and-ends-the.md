---
id: BIL-038
title: A refund cancels the receipt and ends the periods of the payment
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-012, BIL-014, BIL-027]
read_first: [src/modules/billing/receipt.service.ts, src/modules/billing/payment.repository.ts]
design_refs: [finances/subscriptionpayment, finances/subscriptionreceipt]
constraints: [C-53, C-54]
asvs: [v5.0.0-2.2.3, v5.0.0-2.3.3]
---

# BIL-038 — A refund cancels the receipt and ends the periods of the payment

## Story
Technical story: give billing the function that refunds a confirmed payment: a credit note for its receipt and the end of the periods it bought, in the caller's transaction.

## Context
- Exists: `lockPayment`, `setPaymentOutcome` (BIL-014); `issueReceipt` and the number function (BIL-012); `endPeriod` (BIL-027); `insertEvent`. No route calls it yet.
- `receipt.repository.ts` gains `findReceiptOfPayment`, `findCreditNoteOfPayment` and `insertCreditNote`; `subscription.repository.ts` gains `listOpenPeriodsOfPayment(tx, paymentId)` (ACTIVE or SCHEDULED).
- `issueCreditNote(tx, receipt, now)` in `receipt.service.ts`: next number of the same series, kind CREDIT_NOTE, label `Avoir — ` plus the receipt's, same customer, rate and positive amounts, `cancels_receipt_id` the receipt's id.
- `applyRefund(tx, { paymentId, organizationId, actor, now })` in the new `refund.service.ts` locks the payment: unknown or of another business is 404 `NOT_FOUND`, not SUCCEEDED is 409 `PAYMENT_NOT_REFUNDABLE`. It sets REFUNDED (the confirmation date stays), issues the credit note, ends each open period of the payment (ACTIVE: `ends_at = now`; SCHEDULED: `ends_at = starts_at`; ENDED, reason REFUNDED; one FORFAIT_ENDED event each) and writes one PAYMENT event (actor ADMINISTRATOR, the payment id). Later periods keep their dates. Returns `{ creditNote, endedIds }`; the caller recomputes the rights.
- `C-53`: `SubscriptionPayment`: `provider_reference` is unique; `months` is 1, 3, 6 or 12; `amount` is computed by the server from the price grid; status moves only from PENDING to another value, then from SUCCEEDED to REFUNDED; `confirmed_at` is set exactly when status is SUCCEEDED or REFUNDED; `operator = OTHER` exactly when an administrator recorded the payment, and `payer_phone_number` is set otherwise.
- `C-54`: `SubscriptionReceipt`: `number` is unique and has no gap; `amount = amount_excl_tax + vat_amount`; `cancels_receipt_id` is set exactly when `kind = CREDIT_NOTE`, and a receipt has at most one credit note; no update, no delete.

## Acceptance criteria
```gherkin
Scenario: AC-1 An active period
  Given a SUCCEEDED payment of 15000 for ESSENTIAL, 3 months, its receipt R-2026-000001 and its ACTIVE period
  When `applyRefund` runs
  Then the payment is REFUNDED, a CREDIT_NOTE `R-2026-000002` has the receipt's amounts and `cancels_receipt_id`, the period is ENDED REFUNDED with `ends_at = now`, and one FORFAIT_ENDED and one PAYMENT event name the administrator
Scenario: AC-2 A scheduled period
  Given the payment bought a SCHEDULED period, and another period follows it
  When `applyRefund` runs
  Then the scheduled period is ENDED REFUNDED with `ends_at = starts_at` and the following one is unchanged
Scenario: AC-3 A period already over
  Given the payment's period is ENDED with reason EXPIRED
  When `applyRefund` runs
  Then the credit note exists and the period is unchanged
Scenario Outline: AC-4 Refused
  When the payment is <case>
  Then <answer> is thrown and nothing is written
  Examples:
    | case                              | answer                         |
    | PENDING, FAILED, EXPIRED or REFUNDED | 409 `PAYMENT_NOT_REFUNDABLE` |
    | of another business, or unknown   | 404 `NOT_FOUND`                |
```

## Abuse cases
```gherkin
Scenario: AB-1 Two refunds at once (race, T3)
  When `applyRefund` runs twice in parallel for one payment
  Then one credit note exists and the other call fails with 409
```

## Implementation
- Create: `src/modules/billing/refund.service.ts`, `tests/integration/billing/refund-payment.test.ts`
- Modify: `src/modules/billing/receipt.service.ts`, `src/modules/billing/receipt.repository.ts`, `src/modules/billing/subscription.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `applyRefund(tx: Prisma.TransactionClient, input: RefundInput): Promise<RefundResult>`
  - `issueCreditNote(tx: Prisma.TransactionClient, receipt: ReceiptRow, now: Date): Promise<ReceiptRow>`
- Types:
  - `RefundInput = { paymentId: string; organizationId: string; actor: { administratorId: string; adminActionId: string }; now: Date }`
  - `RefundResult = { creditNote: ReceiptRow; endedIds: string[] }`
- Errors: `NOT_FOUND` 404, `PAYMENT_NOT_REFUNDABLE` 409
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.3: the credit note repeats the receipt's amounts, so receipt and credit note cancel out.
- v5.0.0-2.3.3: status, credit note, periods and events belong to the caller's transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| active | integration | AC-1, C-53, C-54 | payment, credit note, period, events |
| scheduled | integration | AC-2 | ended empty, next unchanged |
| over | integration | AC-3 | credit note, period unchanged |
| refused | integration | AC-4 | each Examples row → error, no rows |
| race | security | AB-1, CWE-362 | parallel → one credit note |

Command: `npx vitest run tests/integration/billing/refund-payment.test.ts`

## Out of scope
- The route, the admin action, the rights and the notice: BIL-025.
