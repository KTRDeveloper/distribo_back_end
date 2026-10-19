---
id: BIL-035
title: The owner is told when a payment is confirmed
module: billing
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [BIL-014, NTF-002]
read_first: [src/modules/billing/confirmation.service.ts, src/modules/billing/notices.ts]
design_refs: [finances/subscription/plans-on-paie-pour-son-equipe]
constraints: []
asvs: [v5.0.0-16.3.1]
---

# BIL-035 — The owner is told when a payment is confirmed

## Story
Technical story: tell the owner, in their language and with the payer's number masked, that a payment was received, in the same transaction as the activation.

## Context
- Exists: `confirmPayment` (BIL-014), `notices.ts` (BIL-019), `notify` and `recipientLanguage` (NTF-002), `findActiveOwnerId` (ORG-044).
- New `src/lib/mask-phone.ts`: `maskPhone('+237677123456')` is `+237 6 77…` (the first six digits grouped 3, 1, 2, then `…`).
- `notices.ts` gains `paidNotice(language, input)`. Inside the activation transaction, `confirmPayment` writes `notify({ recipientId, organizationId, sourceEvent: 'subscription.paid', content }, tx)` for the active owner, in that person's language. No active owner, no notice. The payer's number appears only masked.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 The notice
  Given a confirmed ESSENTIAL 3-month payment of 15000 ending on 12 January 2027
  When the owner's language is <language>
  Then the owner has one unread notice `subscription.paid` reading <text>
  Examples:
    | language | text                                                                                  |
    | FR       | Paiement de 15 000 reçu du +237 6 77… : Essentiel actif jusqu'au 12 janvier 2027.     |
    | EN       | Payment of 15,000 received from +237 6 77…: Essential active until January 12, 2027. |
Scenario: AC-2 No owner
  When the business has no active owner
  Then the payment is still activated and no notice is written
Scenario: AC-3 A replay
  When the same payment is confirmed twice
  Then the owner has one notice
Scenario: AC-4 The mask
  When `maskPhone` gets `+237677123456`
  Then it returns `+237 6 77…`
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/lib/mask-phone.ts`, `tests/unit/lib/mask-phone.test.ts`, `tests/integration/billing/payment-notice.test.ts`
- Modify: `src/modules/billing/confirmation.service.ts`, `src/modules/billing/notices.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `maskPhone(e164: string): string`
  - `paidNotice(language: 'FR' | 'EN', input: { amount: bigint; maskedPhone: string; plan: PaidPlanCode; planEndsAt: Date }): string`
- Dependencies: none added

## Security
- v5.0.0-16.3.1: the notice shows a masked number and no log carries it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| notice | integration | AC-1 | each Examples row → text |
| no owner | integration | AC-2 | activated, no notice |
| replay | integration | AC-3 | one notice |
| mask | unit | AC-4 | +237677123456 → +237 6 77… |

Command: `npx vitest run tests/integration/billing/payment-notice.test.ts tests/unit/lib/mask-phone.test.ts`

## Out of scope
- Notices for administrator gestures: BIL-036.
