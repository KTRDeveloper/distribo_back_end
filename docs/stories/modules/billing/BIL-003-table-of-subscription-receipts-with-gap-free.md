---
id: BIL-003
title: Table of subscription receipts with gap-free numbers
module: billing
kind: migration
rev: 1
amends: []
size: M
risk: high
depends_on: [BIL-001]
read_first: [prisma/schema.prisma, prisma/migrations/20261004180000_adm_002_admin_actions/migration.sql]
design_refs: [finances/subscriptionreceipt, contraintes-a-poser-au-niveau-base-de]
constraints: ['SubscriptionReceipt:required', 'SubscriptionReceipt.number:unique', 'SubscriptionReceipt.kind:enum', 'SubscriptionReceipt:fk', C-54, C-39]
asvs: [v5.0.0-2.2.3]
---

# BIL-003 — Table of subscription receipts with gap-free numbers

## Story
Technical story: create the receipt table, its number function and its credit-note rules so that a receipt can never be changed, skipped or cancelled twice.

## Context
- Exists: `subscription_payments` (BIL-001), `organizations`.
- Migration `<timestamp>_bil_003_subscription_receipts`: enum `ReceiptKind`; table `subscription_receipts` as in the design, `issued_at` default now(); unique on `cancels_receipt_id`.
- Checks (23514): `number` matches `R-YYYY-NNNNNN`; `amount` = `amount_excl_tax` + `vat_amount`; `amount` above 0, other amounts not below 0; `cancels_receipt_id` set exactly when `kind` is CREDIT_NOTE.
- Trigger `subscription_receipts_check_credit_note` (23514): the cancelled row is a RECEIPT with the same business, payment and amounts.
- SQL function `next_subscription_receipt_number(issued timestamptz)`: takes `pg_advisory_xact_lock`, returns `R-<issue year>-<last suffix + 1, 6 digits>`; one series across years. A BEFORE INSERT trigger takes the same lock and refuses (23514) any other number.
- GRANT SELECT, INSERT and EXECUTE on the function only (C-39). `prisma/schema.prisma`: enum, model and a plain-words `//` comment above it (never changed, numbers gap-free, one credit note per receipt, migration).
- `SubscriptionReceipt:required`: NOT NULL: `number`, `kind`, `organization_id`, `payment_id`, `customer_name`, `label`, `amount_excl_tax`, `vat_rate_bp`, `vat_amount`, `amount`, `issued_at`
- `SubscriptionReceipt.number:unique`: unique
- `SubscriptionReceipt.kind:enum`: one of RECEIPT, CREDIT_NOTE
- `SubscriptionReceipt:fk`: references organization_id → Organization; payment_id → SubscriptionPayment; cancels_receipt_id → SubscriptionReceipt
- `C-54`: `SubscriptionReceipt`: `number` is unique and has no gap; `amount = amount_excl_tax + vat_amount`; `cancels_receipt_id` is set exactly when `kind = CREDIT_NOTE`, and a receipt has at most one credit note; no update, no delete.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.

## Acceptance criteria
```gherkin
Scenario: AC-1 A receipt
  When a RECEIPT of 5 000 (4 193 excl. tax, 807 VAT, rate 1925) is inserted with the number the function returned
  Then it is stored with `issued_at` set
Scenario Outline: AC-2 Wrong rows are refused
  When a row is inserted with <problem>
  Then the database refuses it with <code>
  Examples:
    | problem                                           | code  |
    | `amount` not equal to excl. tax plus VAT          | 23514 |
    | number `R-26-1`                                   | 23514 |
    | CREDIT_NOTE without `cancels_receipt_id`          | 23514 |
    | a second credit note for one receipt              | 23505 |
    | a credit note with another amount                 | 23514 |
Scenario: AC-3 Numbers
  Given an empty table, then a table whose last number is `R-2026-000007`
  When the function runs for a date in 2026
  Then it returns `R-2026-000001`, then `R-2026-000008`; inserting `R-2026-000010` is refused with 23514
Scenario: AC-4 Never changed or deleted
  When the application account updates, deletes or truncates
  Then each statement fails with 42501
```

## Abuse cases
```gherkin
Scenario: AB-1 A receipt amount is rewritten (tampering, T8)
  When the application account sets `amount` of a stored receipt
  Then the statement fails with 42501 and the row is unchanged
Scenario: AB-2 Two receipts at once (tampering, T8)
  When two transactions each ask for a number and insert
  Then the numbers are consecutive, none skipped and none repeated
```

## Implementation
- Create: `prisma/migrations/<timestamp>_bil_003_subscription_receipts/migration.sql`, `tests/integration/billing/subscription-receipts-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `next_subscription_receipt_number(issued timestamptz) RETURNS text`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the database, not the writer, keeps numbers gap-free and receipts unchanged.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| receipt | integration | AC-1, SubscriptionReceipt:required, SubscriptionReceipt.number:unique, SubscriptionReceipt.kind:enum, SubscriptionReceipt:fk | insert → stored |
| wrong rows | integration | AC-2, C-54 | each Examples row → the code |
| numbers | integration | AC-3 | function and gap → results |
| immutable | integration | AC-4, C-39 | UPDATE, DELETE, TRUNCATE → 42501 |
| rewrite | security | AB-1, CWE-345 | UPDATE amount → 42501 |
| parallel | security | AB-2, CWE-362 | two transactions → consecutive numbers |

Command: `npx vitest run tests/integration/billing/subscription-receipts-table.test.ts`

## Out of scope
- Issuing receipts and VAT arithmetic: BIL-012. A yearly reset of the series: open question.
