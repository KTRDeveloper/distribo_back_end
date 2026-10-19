---
id: ORG-028
title: A new business gets its payment code and the free plan
module: organization
kind: change
rev: 1
amends: [ORG-004, ORG-005]
size: S
risk: high
depends_on: [ORG-004, ORG-005, ORG-020, FND-014]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.repository.ts]
design_refs: [identite-et-organisation/organization, synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone]
constraints: [C-41]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.1, v5.0.0-15.3.3]
---

# ORG-028 — A new business gets its payment code and the free plan

## Story
As an owner, I want my new business to start on the free plan with its own payment code so that I can later pay for more room.

## Context
- Exists: `POST /api/v1/organizations` (`createOrganization`), body `{id, name, description?, email?}`; the plan columns (ORG-020); `PLANS`, `generatePaymentCode` (FND-014).
- At creation the server writes `payment_code` (`generatePaymentCode()`), `plan` FREE, and `max_collaborators`, `max_products` from `PLANS.FREE`. The body never carries them.
- A unique violation on `payment_code` only draws a new code, 5 tries in all, each in a new transaction; after 5 the error goes up (500). Any other unique violation is rethrown unchanged.
- The body loses `email` (strict schema); the column stays until ORG-032 and nothing writes it.
- The `POST` answer and `GET /organizations/{organizationId}` add `payment_code, plan, plan_ends_at, grace_ends_at, max_collaborators, max_products` and lose `email`. Only the team reads them (anyone else already gets 404). The list of my businesses and the lookup keep their fields.
- Contacts are not in the creation body: the owner adds them with ORG-024.
- `C-41`: `Organization.payment_code` is unique; `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only; `plan = FREE` exactly when `plan_ends_at` is empty; a set `grace_ends_at` is after `plan_ends_at`.

## Acceptance criteria
```gherkin
Scenario: AC-1 A new business starts on the free plan
  When a person creates a business
  Then the answer is 201 with `plan` "FREE", `plan_ends_at` null, `grace_ends_at` null, `max_collaborators` 2, `max_products` 30 and no `email`
Scenario: AC-2 The payment code has the fixed shape
  Then `payment_code` is 8 characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`
Scenario: AC-3 A taken code is drawn again
  Given the first draw equals the code of an existing business
  When a business is created
  Then the answer is 201 and the stored code is the second draw
Scenario: AC-4 Five taken codes stop the creation
  Given every draw equals an existing code
  Then the answer is 500 INTERNAL_ERROR and no business, collaboration or counter is stored
Scenario: AC-5 The body cannot set the server fields
  When the body carries `email`, `payment_code`, `plan`, `max_collaborators` or `max_products`
  Then the answer is 400 VALIDATION_ERROR and nothing is stored
Scenario: AC-6 The team reads the plan fields
  Then `GET /organizations/{organizationId}` for an ACTIVE member carries the six plan fields
```

## Abuse cases
```gherkin
Scenario: AB-1 The plan of a business is read by an outsider (information disclosure, T9)
  When a person who is not an ACTIVE member (none, INVITED, REVOKED or PAUSED) reads the business
  Then the answer is 404 NOT_FOUND
  And a lookup item carries only `id`, `name` and `description`
```

## Implementation
- Create: `tests/integration/organization/create-plan.test.ts`
- Modify: `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/middleware/idempotent.ts`
- Signatures:
  - `insertOrganizationWithOwner(personId, input, plan: { paymentCode: string; maxCollaborators: number | null; maxProducts: number | null }, inSameTransaction?): Promise<CreatedOrganization>`
  - `isPaymentCodeCollision(error: unknown): boolean`
- Types:
  - `OrganizationView adds payment_code: string, plan: 'FREE' | 'ESSENTIAL' | 'PRO' | 'ENTERPRISE', plan_ends_at: string | null, grace_ends_at: string | null, max_collaborators: number | null, max_products: number | null; email removed`
- Errors: `VALIDATION_ERROR` 400
- Dependencies: none added

## Security
- v5.0.0-8.2.1: owner, plan and limits come from the session and `PLANS.FREE`, never from the body.
- v5.0.0-15.3.1: the plan fields are in the detail view only.
- v5.0.0-15.3.3: the strict body schema lists `id`, `name` and `description` only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| free plan | integration | AC-1, C-41 | 201 → FREE, null dates, 2 and 30, no email |
| code shape | integration | AC-2 | 8 symbols of the alphabet |
| code collision | integration | AC-3 | first draw taken (generatePaymentCode mocked) → 201, second draw stored |
| code exhausted | integration | AC-4 | five taken draws → 500, nothing stored |
| server fields refused | integration | AC-5 | each extra field → 400, no row |
| team view | integration | AC-6 | ACTIVE member → six plan fields |
| outsider | security | AB-1, CWE-200 | non-member, INVITED, REVOKED, PAUSED → 404; lookup item keys unchanged |

Command: `npx vitest run tests/integration/organization tests/integration/api-docs`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/organization/create.test.ts | the key list, the `email` fields and the `email not-mail` case expect `email` | key list without `email` and with the six plan fields; the `email` case becomes a 400 for an unknown field |
| tests/integration/organization/actor-and-read.test.ts | the detail test expects seven keys with `email` | the keys and the object without `email`, with the six plan fields |

## Out of scope
- Dropping `organizations.email`: ORG-032.
