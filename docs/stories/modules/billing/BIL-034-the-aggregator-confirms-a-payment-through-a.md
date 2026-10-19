---
id: BIL-034
title: The aggregator confirms a payment through a verified call
module: billing
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [BIL-014]
read_first: [src/middleware/body-parser.ts, src/modules/billing/billing.routes.ts]
design_refs: [finances/subscription/plans-on-paie-pour-son-equipe]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-2.2.1, v5.0.0-16.3.1]
---

# BIL-034 — The aggregator confirms a payment through a verified call

## Story
As a visitor, I want my payment to count once the aggregator confirms it so that the business gets its plan without my browser having to prove anything.

## Context
- Exists: `confirmPayment` (BIL-014), `getPaymentAggregator` and `verifyConfirmation` (BIL-008), the public router (BIL-007), the global JSON parser in `src/middleware/body-parser.ts`.
- `POST /api/v1/billing/confirmations`, public in the sense that it has no sign-in: the aggregator's proof is the only credential.
- `jsonBodyParser` keeps the raw bytes as `req.rawBody` (a `Buffer`) for this exact path only, through the `verify` option of `express.json`; the 100 kb limit and the other paths do not change.
- The handler passes the headers (lower-cased names, string values) and `req.rawBody` to `verifyConfirmation`. Null (or a missing body) answers 401 `UNAUTHORIZED` and logs a `warn` event `payment_confirmation_rejected`, with no header or body.
- Else it calls `confirmPayment(providerReference, req.body ?? null, now)` and answers 200 `{ "status": "OK" }` for every outcome except errors (404 for an unknown reference, 409 `PAYMENT_MISMATCH`). Nothing else is returned: the call is not a browser.

## Acceptance criteria
```gherkin
Scenario: AC-1 A genuine confirmation
  Given a pending payment that the fake aggregator settled
  When the aggregator's signed call arrives
  Then the answer is 200 `{ "status": "OK" }` and the plan is active
Scenario: AC-2 A repeat
  When the same signed call arrives twice
  Then both answers are 200 and one period exists
Scenario Outline: AC-3 A call that proves nothing
  When the call has <problem>
  Then the answer is 401 `UNAUTHORIZED` and the payment stays PENDING
  Examples:
    | problem                                           |
    | no signature header                               |
    | a wrong signature naming a real pending reference |
    | an empty body                                     |
Scenario: AC-4 An unknown reference
  When a validly signed call names a reference that no payment holds
  Then the answer is 404 `NOT_FOUND`
Scenario: AC-5 The parser is unchanged elsewhere
  When another route receives a JSON body, and this route receives one over 100 kb
  Then the other route parses as before and this one answers 413 `PAYLOAD_TOO_LARGE`
```

## Abuse cases
```gherkin
Scenario: AB-1 A forged confirmation activates a plan (spoofing, T1)
  When a call names a real pending reference, claims success and carries no valid signature
  Then the answer is 401, the payment stays PENDING, no period or receipt exists, and one `warn` log holds no body
Scenario: AB-2 A signed call says success while the aggregator says pending (spoofing, T1)
  When the call is valid but `getStatus` says PENDING
  Then no period exists and the payment stays PENDING
```

## Implementation
- Create: `tests/integration/billing/confirmation-route.test.ts`
- Modify: `src/middleware/body-parser.ts`, `src/modules/billing/billing.routes.ts`, `src/modules/billing/billing.service.ts`, `src/modules/billing/billing.openapi.ts`
- Pattern: `tests/integration/auth/register-request.test.ts`
- Signatures:
  - `handleConfirmation(headers: Record<string, string | undefined>, rawBody: Buffer | undefined, parsedBody: unknown, now: Date): Promise<void>`
- Types:
  - `Request.rawBody?: Buffer (module augmentation in body-parser.ts)`
- Errors: `UNAUTHORIZED` 401, `NOT_FOUND` 404, `PAYMENT_MISMATCH` 409, `PAYLOAD_TOO_LARGE` 413
- Dependencies: `express`

## Security
- v5.0.0-8.2.1: only a call that `verifyConfirmation` accepts is acted on, and `confirmPayment` asks the aggregator for the status again.
- v5.0.0-2.2.1: the body keeps its 100 kb maximum.
- v5.0.0-16.3.1: a rejected call logs the event name only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| genuine | integration | AC-1 | 200, plan active |
| repeat | integration | AC-2 | 200 twice, one period |
| no proof | integration | AC-3 | each Examples row → 401, PENDING |
| unknown | integration | AC-4 | 404 |
| parser | integration | AC-5 | other route unchanged, 413 here |
| forged | security | AB-1, CWE-345 | unsigned success claim → 401, no period, log without body |
| claim vs status | security | AB-2, CWE-807 | valid call, aggregator PENDING → no period |

Command: `npx vitest run tests/integration/billing/confirmation-route.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the confirmations path | add POST /api/v1/billing/confirmations, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the confirmations path | add POST /api/v1/billing/confirmations, remove nothing |

## Out of scope
- The real aggregator's signature scheme: ADR-006.
