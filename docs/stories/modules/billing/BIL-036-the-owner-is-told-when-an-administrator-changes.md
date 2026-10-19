---
id: BIL-036
title: The owner is told when an administrator changes the plan
module: billing
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [BIL-035]
read_first: [src/modules/billing/notices.ts]
design_refs: [finances/subscription]
constraints: []
asvs: [v5.0.0-2.3.3]
---

# BIL-036 — The owner is told when an administrator changes the plan

## Story
Technical story: give billing the one function that tells the owner, in their language, that an administrator gave days, recorded a payment or refunded one.

## Context
- Exists: `notices.ts` (BIL-019, BIL-035), `findActiveOwnerId` (ORG-044), `notify` and `recipientLanguage` (NTF-002). No route calls it yet.
- `notices.ts` gains `adjustmentNotice(language, input)` with the texts of AC-1; amounts are grouped as in BIL-035.
- New `adjustment-notice.ts`: `notifyOwnerOfAdjustment(tx, organizationId, input)` finds the active owner and writes `notify({ recipientId, organizationId, sourceEvent: 'subscription.adjusted', content }, tx)` in that person's language; without an owner it does nothing. The text never names the administrator or the reason.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 The texts
  When <gesture> is announced to a French owner and to an English owner
  Then each has one unread notice `subscription.adjusted`, reading <french> and <english>
  Examples:
    | gesture                                       | french                                                                        | english                                                                  |
    | GIFT, ESSENTIAL, 30 days                      | Cadeau : 30 jours de forfait Essentiel offerts à votre commerce.              | Gift: 30 days of the Essential plan added to your business.              |
    | PAYMENT_RECORDED, ESSENTIAL, 3 months, 15000  | Paiement de 15 000 enregistré par Distribo : forfait Essentiel, 3 mois.       | Payment of 15,000 recorded by Distribo: Essential plan, 3 months.        |
    | PAYMENT_RECORDED, PRO, 1 month, 30000         | Paiement de 30 000 enregistré par Distribo : forfait Pro, 1 mois.             | Payment of 30,000 recorded by Distribo: Pro plan, 1 month.               |
    | REFUNDED, ESSENTIAL, 15000                    | Remboursement de 15 000 : le forfait Essentiel acheté par ce paiement est arrêté. | Refund of 15,000: the Essential plan bought with that payment has ended. |
Scenario: AC-2 No owner
  When the business has no active owner
  Then no notice is written and nothing fails
Scenario: AC-3 A rollback
  When the caller's transaction is rolled back after the call
  Then no notice exists
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/modules/billing/adjustment-notice.ts`, `tests/integration/billing/adjustment-notice.test.ts`
- Modify: `src/modules/billing/notices.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `adjustmentNotice(language: 'FR' | 'EN', input: AdjustmentInput): string`
  - `notifyOwnerOfAdjustment(tx: Prisma.TransactionClient, organizationId: string, input: AdjustmentInput): Promise<void>`
- Types:
  - `AdjustmentInput = { kind: 'GIFT'; plan: PaidPlanCode; days: number } | { kind: 'PAYMENT_RECORDED'; plan: PaidPlanCode; months: PackMonths; amount: bigint } | { kind: 'REFUNDED'; plan: PaidPlanCode; amount: bigint }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: the notice is written in the caller's transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| texts | integration | AC-1 | each Examples row → both texts |
| no owner | integration | AC-2 | no notice, no error |
| rollback | integration | AC-3 | no notice |

Command: `npx vitest run tests/integration/billing/adjustment-notice.test.ts`

## Out of scope
- The gestures that call it: BIL-023, BIL-024, BIL-025.
