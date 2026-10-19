---
id: BIL-007
title: A payer checks the business name from its payment code
module: billing
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORG-044, FND-014]
read_first: [src/app.ts, src/modules/person/person.routes.ts]
design_refs: [finances/subscription/plans-on-paie-pour-son-equipe, identite-et-organisation/organization]
constraints: [C-41]
asvs: [v5.0.0-2.4.1, v5.0.0-15.3.1]
---

# BIL-007 — A payer checks the business name from its payment code

## Story
As a visitor, I want to type the code of a business on the payment site and see its name so that I know I am paying for the right business.

## Context
- Exists: `findOrganizationByPaymentCode` (ORG-044), `rate-limit` (`checkAndConsume`), the router in `src/app.ts`. The route is public: the site asks for no sign-in, and a payment only adds rights.
- Adds the module files `billing.routes.ts`, `billing.service.ts`, `billing.schemas.ts`, `billing.openapi.ts` and the mount `/billing` in `src/app.ts`.
- `GET /api/v1/billing/shops/{code}`. The code is trimmed and upper-cased, then must be 8 characters of `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, else 400 `VALIDATION_ERROR`. Answer 200 `{ "name": string }` and nothing more.
- An unknown code, a deleted business and a business that is not ACTIVE all answer the same 404 `NOT_FOUND`.
- At most 30 lookups an hour per `req.ip`, counted before the lookup (key `billing:code:<ip>`); the 31st answers 429 `RATE_LIMITED` and logs `warn` event `payment_code_rate_limited`, no ip. Both numbers are provisional.
- `C-41`: `Organization.payment_code` is unique; `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only; `plan = FREE` exactly when `plan_ends_at` is empty; a set `grace_ends_at` is after `plan_ends_at`.

## Acceptance criteria
```gherkin
Scenario: AC-1 A code gives the name
  When a client with no sign-in reads the shop of an ACTIVE business
  Then the answer is 200 with exactly `{ "name": "<the name>" }`
Scenario: AC-2 A loose code
  When the code is sent in lower case with spaces around it
  Then the answer is the same as for the exact code
Scenario Outline: AC-3 A code that gives nothing
  When the code is <code>
  Then the answer is <answer>
  Examples:
    | code                                | answer                          |
    | well formed, held by no business    | 404 `NOT_FOUND`                 |
    | held by a SUSPENDED or CLOSED one   | the same 404 `NOT_FOUND`        |
    | 7 characters, or with `0`, `O`, `1` | 400 `VALIDATION_ERROR`, no value |
Scenario: AC-4 The limit
  When one address makes 31 lookups within the hour
  Then the first 30 are answered normally and the 31st is 429 `RATE_LIMITED`
```

## Abuse cases
```gherkin
Scenario: AB-1 Codes are guessed (enumeration, T6)
  When one address asks for 40 well-formed unknown codes
  Then the first 30 answers are identical 404s, the next are 429, and the database is not read after the limit
```

## Implementation
- Create: `src/modules/billing/billing.routes.ts`, `src/modules/billing/billing.service.ts`, `src/modules/billing/billing.schemas.ts`, `src/modules/billing/billing.openapi.ts`, `tests/integration/billing/shop-lookup.test.ts`
- Modify: `src/app.ts`
- Pattern: `tests/integration/auth/register-request.test.ts`
- Signatures:
  - `lookupShop(code: string, ip: string): Promise<{ name: string }>`
- Errors: `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `RATE_LIMITED` 429
- Dependencies: `zod`, `express`

## Security
- v5.0.0-2.4.1: lookups are limited per address before any read.
- v5.0.0-15.3.1: the answer holds the name only: no id, plan, status or team.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| shop name | integration | AC-1, C-41 | ACTIVE business → 200 with name only |
| loose code | integration | AC-2 | lower case with spaces → same answer |
| nothing | integration | AC-3 | each Examples row → answer |
| limit | integration | AC-4 | 31 calls → 30 normal, then 429 |
| guessing | security | AB-1, CWE-307 | 40 unknown codes → identical 404s then 429 |

Command: `npx vitest run tests/integration/billing/shop-lookup.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the shop path | add GET /api/v1/billing/shops/{code}, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the shop path | add GET /api/v1/billing/shops/{code}, remove nothing |

## Out of scope
- The start date and price shown after the choice of a plan: BIL-033.
- Creating a payment: BIL-009.
