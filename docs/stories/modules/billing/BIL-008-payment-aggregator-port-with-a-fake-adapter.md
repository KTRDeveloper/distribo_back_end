---
id: BIL-008
title: Payment aggregator port with a fake adapter
module: billing
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [FND-003]
read_first: [src/config/env.ts, docs/stories/decisions/ADR-006-payment-aggregator.md]
design_refs: [finances/subscriptionpayment]
constraints: []
asvs: [v5.0.0-2.2.1, v5.0.0-8.2.1]
---

# BIL-008 — Payment aggregator port with a fake adapter

## Story
Technical story: provide the port to the payment aggregator and a fake adapter, so that the payment flow is built and tested without any real account.

## Context
- No HTTP client, package or URL for a third-party service is allowed (ADR-006, proposed): the real adapter is in no story.
- New `src/modules/billing/aggregator.port.ts`: `PaymentAggregator` with `requestPayment({ clientReference, amount, operator, payerPhone, description })` giving `{ providerReference }`; `getStatus(providerReference)` giving `{ status, amount, paidAt }` or null; `verifyConfirmation({ headers, rawBody })` giving `{ providerReference }` when the call really comes from the aggregator, else null; `listStatement(day)` giving every payment of that UTC day. Operators: MTN_MOMO and ORANGE_MONEY.
- New `aggregator.fake.ts`: `FakeAggregator`. A repeat of `requestPayment` with one `clientReference` returns the same `providerReference`. Test helpers: `settle(providerReference, status, paidAt?)`, `confirmationFor(providerReference)` (headers with `x-fake-signature: valid`) and `reset()`. `verifyConfirmation` accepts only that signature.
- New `aggregator.ts`: `getPaymentAggregator()` returns the one fake instance. `env.ts` adds `PAYMENT_DRIVER` (only `fake`, default `fake`); `.env.example` lists it.

## Acceptance criteria
```gherkin
Scenario: AC-1 A request
  When `requestPayment` runs for 15 000, MTN_MOMO, with a payer number, twice with one `clientReference`
  Then both calls give the same `providerReference` and `getStatus` says PENDING with amount 15 000
Scenario: AC-2 Settling
  When `settle(ref, SUCCEEDED, paidAt)` runs and `getStatus(ref)` is read
  Then the status is SUCCEEDED with that `paidAt`; an unknown reference gives null
Scenario Outline: AC-3 Confirmations
  When `verifyConfirmation` receives <call>
  Then the result is <result>
  Examples:
    | call                                          | result                    |
    | the output of `confirmationFor(ref)`          | `{ providerReference }`   |
    | the same body without the signature header    | null                      |
    | a wrong signature value                       | null                      |
    | a body that is not JSON                       | null                      |
Scenario: AC-4 Statement
  When two payments are settled on one day and `listStatement` runs for that day and for the next
  Then it lists both for the first day and none for the next
Scenario Outline: AC-5 The setting
  When the environment is validated with <setting>
  Then validation <result>
  Examples:
    | setting            | result           |
    | none               | passes, `fake`   |
    | PAYMENT_DRIVER=momo | fails, names it |
```

## Abuse cases
```gherkin
Scenario: AB-1 A forged confirmation is believed (spoofing, T1)
  When `verifyConfirmation` receives a body naming a real pending reference with no valid signature
  Then the result is null and `getStatus` still says PENDING
```

## Implementation
- Create: `src/modules/billing/aggregator.port.ts`, `src/modules/billing/aggregator.fake.ts`, `src/modules/billing/aggregator.ts`, `tests/unit/billing/aggregator-fake.test.ts`
- Modify: `src/config/env.ts`, `.env.example`
- Pattern: `tests/unit/shared/money.test.ts`
- Signatures:
  - `getPaymentAggregator(): PaymentAggregator`
- Types:
  - `AggregatorStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED'`
  - `AggregatorPayment = { providerReference: string; status: AggregatorStatus; amount: bigint; paidAt: Date | null }`
  - `PaymentAggregator = { requestPayment(input: { clientReference: string; amount: bigint; operator: 'MTN_MOMO' | 'ORANGE_MONEY'; payerPhone: string; description: string }): Promise<{ providerReference: string }>; getStatus(providerReference: string): Promise<AggregatorPayment | null>; verifyConfirmation(input: { headers: Record<string, string | undefined>; rawBody: Buffer }): { providerReference: string } | null; listStatement(day: string): Promise<AggregatorPayment[]> }`
- Dependencies: `zod`

## Security
- v5.0.0-2.2.1: `requestPayment` throws a RangeError for an amount of 0 or less.
- v5.0.0-8.2.1: a confirmation is believed only when `verifyConfirmation` gives a reference; what it claims about the status proves nothing (BIL-014 asks `getStatus`).

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| request | unit | AC-1 | two calls → one reference, PENDING, amount |
| settle | unit | AC-2 | SUCCEEDED with date; unknown → null |
| confirmations | unit | AC-3 | each Examples row → result |
| statement | unit | AC-4 | day filter |
| setting | unit | AC-5 | each Examples row → passes or names the variable |
| forged | security | AB-1, CWE-345 | unsigned body → null, still PENDING |

Command: `npx vitest run tests/unit/billing/aggregator-fake.test.ts`

## Out of scope
- A real aggregator adapter and its secrets: they wait for ADR-006.
- Calling the port from a route or a job: BIL-009, BIL-014, BIL-021, BIL-022.
