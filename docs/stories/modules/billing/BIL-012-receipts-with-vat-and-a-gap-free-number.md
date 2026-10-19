---
id: BIL-012
title: Receipts with VAT and a gap-free number
module: billing
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [BIL-003, BIL-010]
read_first: [src/config/env.ts]
design_refs: [finances/subscriptionreceipt]
constraints: [C-54]
asvs: [v5.0.0-2.2.3, v5.0.0-2.3.3]
---

# BIL-012 — Receipts with VAT and a gap-free number

## Story
Technical story: give billing the function that issues the frozen receipt of a payment, with its number and its VAT, in the transaction that confirms the payment.

## Context
- Exists: `subscription_receipts` and `next_subscription_receipt_number` (BIL-003); `addDays` and dates helpers (BIL-010). No route calls it yet.
- `env.ts` adds `VAT_RATE_BP` (0 or 1925, default 1925); `.env.example` lists it.
- New `receipt.repository.ts` (inserts, and `SELECT next_subscription_receipt_number($1)` through a parameterized query) and `receipt.service.ts`:
  - `splitVat(total, rateBp)`: `amountExclTax = round(total × 10000 / (10000 + rateBp))` to the nearest franc, half up, in `bigint`; `vatAmount = total − amountExclTax`. 5 000 gives 4 193 and 807.
  - `issueReceipt(tx, { payment, customerName, startsAt, endsAt, now })`: takes its number from the function in the same transaction and inserts a RECEIPT with the name, the payment's NIU, the rate and a French label, `Essentiel — 3 mois, du 12/10/2026 au 12/01/2027` (plans Essentiel, Pro, Entreprise; `1 mois`; dates in the Africa/Douala zone).
- `C-54`: `SubscriptionReceipt`: `number` is unique and has no gap; `amount = amount_excl_tax + vat_amount`; `cancels_receipt_id` is set exactly when `kind = CREDIT_NOTE`, and a receipt has at most one credit note; no update, no delete.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 VAT
  When `splitVat(<total>, <rate>)` runs
  Then the result is <excl> and <vat>
  Examples:
    | total  | rate | excl   | vat  |
    | 5000   | 1925 | 4193   | 807  |
    | 15000  | 1925 | 12579  | 2421 |
    | 25000  | 1925 | 20964  | 4036 |
    | 5000   | 0    | 5000   | 0    |
Scenario: AC-2 A receipt
  When a payment of 5 000 for ESSENTIAL, 3 months, with a NIU, is receipted for the business "Test Shop"
  Then a RECEIPT exists with number `R-<year>-000001`, that name, that NIU, the label, amounts 4 193, 807 and 5 000, rate 1925 and `payment_id`
Scenario: AC-3 Consecutive numbers
  When two receipts are issued one after the other
  Then their numbers end in 000001 and 000002
Scenario Outline: AC-4 Label dates
  When a receipt covers <from> to <to> for <plan>, <months> months
  Then its label is <label>
  Examples:
    | plan      | months | from                 | to                   | label                                          |
    | ESSENTIAL | 3      | 2026-10-11T23:30:00Z | 2027-01-11T23:30:00Z | Essentiel — 3 mois, du 12/10/2026 au 12/01/2027 |
    | PRO       | 1      | 2026-10-12T09:00:00Z | 2026-11-12T09:00:00Z | Pro — 1 mois, du 12/10/2026 au 12/11/2026       |
Scenario Outline: AC-5 The setting
  When the environment is validated with <setting>
  Then validation <result>
  Examples:
    | setting           | result            |
    | none              | passes, 1925      |
    | VAT_RATE_BP=0     | passes            |
    | VAT_RATE_BP=500   | fails, names it   |
```

## Abuse cases
```gherkin
Scenario: AB-1 A failed confirmation leaves a hole in the numbers (repudiation, T8)
  When a receipt is issued in a transaction that is rolled back, then another receipt is issued
  Then the second takes the number the first would have had
```

## Implementation
- Create: `src/modules/billing/receipt.repository.ts`, `src/modules/billing/receipt.service.ts`, `tests/integration/billing/receipt-issue.test.ts`, `tests/unit/billing/vat.test.ts`
- Modify: `src/config/env.ts`, `.env.example`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `splitVat(total: bigint, rateBp: number): { amountExclTax: bigint; vatAmount: bigint }`
  - `issueReceipt(tx: Prisma.TransactionClient, input: ReceiptInput): Promise<ReceiptRow>`
- Types:
  - `ReceiptInput = { payment: { id: string; organizationId: string; plan: PaidPlanCode; months: PackMonths; amount: bigint; customerTaxId: string | null }; customerName: string; startsAt: Date; endsAt: Date; now: Date }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.3: amounts are integers and `amount` equals excl. tax plus VAT, which the table also checks.
- v5.0.0-2.3.3: the number is taken in the transaction that inserts the receipt, so a rollback frees it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| vat | unit | AC-1 | each Examples row → amounts |
| receipt | integration | AC-2, C-54 | fields of the stored receipt |
| numbers | integration | AC-3 | 000001 then 000002 |
| label | integration | AC-4 | each Examples row → label |
| setting | unit | AC-5 | each Examples row → passes or names the variable |
| no hole | security | AB-1, CWE-345 | rollback then issue → same number |

Command: `npx vitest run tests/integration/billing/receipt-issue.test.ts tests/unit/billing/vat.test.ts`

## Out of scope
- Credit notes: BIL-038. Reading receipts: BIL-015 and BIL-017.
