---
id: BIL-023
title: A super administrator gives days of a plan to a business
module: billing
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ADM-016, BIL-013, BIL-020, BIL-036, BIL-037]
read_first: [src/middleware/admin-auth.ts, src/modules/billing/forfait.service.ts]
design_refs: [finances/subscription]
constraints: [C-55]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-15.3.3]
---

# BIL-023 — A super administrator gives days of a plan to a business

## Story
As a super-admin, I want to give days of a plan to a business so that I can make up for a problem or reward a customer.

## Context
- Exists: `addGiftForfait`, `findPeriod` (BIL-037), `recomputeRights` (BIL-013), `enforceLimits` (BIL-020), `notifyOwnerOfAdjustment` (BIL-036), `recordAdminAction` (ADM-016), `findOrganizationSummary` (ORG-044).
- `POST /api/v1/admin/organizations/{organizationId}/billing/gift-days` in the new `billing.admin.routes.ts` (`Router({ mergeParams: true })`), mounted in `src/app.ts` before `/admin`. Chain: `adminAuthMiddleware`, `requireAdminRole('SUPER_ADMIN')`, then the body.
- Body, strict: `id` (UUIDv7, the gift period's id), `plan` (ESSENTIAL, PRO or ENTERPRISE), `days` (integer 1 to 365), `reason` (1 to 2000 characters).
- `giveDays(admin, organizationId, input, now)`, one transaction: unknown business is 404 `NOT_FOUND`; lock the business; a GIFT period with this `id` of the same business, plan and days (`ends_at - starts_at`) is answered again with nothing written, any other period with it is 409 `ID_USED`. Else `recordAdminAction` GIFT_DAYS (target the business), `addGiftForfait`, `recomputeRights`, `enforceLimits`, `notifyOwnerOfAdjustment`.
- Answer 201 `{ id, plan, days, status, starts_at, ends_at }`; a repeat gets the same fields.
- `C-55`: `SubscriptionEvent`: `person_id` is set exactly when `actor = OWNER`; `administrator_id` and `admin_action_id` are set exactly when `actor = ADMINISTRATOR`; `payment_id` is set when `actor = PAYER`; no update, no delete.

## Acceptance criteria
```gherkin
Scenario: AC-1 A gift
  Given ESSENTIAL running until 2026-11-01T00:00:00Z
  When a super administrator posts plan PRO, 30 days and a reason
  Then the answer is 201 with a SCHEDULED period of 30 days from 2026-11-01T00:00:00Z, one `admin_actions` row GIFT_DAYS targets the business with the reason, one FORFAIT_ADDED event holds the administrator and action ids, and the owner has one notice `subscription.adjusted`
Scenario: AC-2 A business on the free plan
  When the same gift goes to a business with no period and 2 paused collaborators
  Then the period is ACTIVE, the business has the PRO limits at once and the collaborators are back
Scenario: AC-3 A repeat
  When the same body is posted twice, then once more with the same `id` and other days
  Then the second answer is 201 with the same fields, the third is 409 `ID_USED`, and one period, one action, one event and one notice exist
Scenario Outline: AC-4 Refused
  When the request has <problem>
  Then the answer is <answer> and nothing is written
  Examples:
    | problem                                                          | answer                 |
    | days 0 or 366, plan FREE, no reason, an unknown field, a bad id | 400 `VALIDATION_ERROR` |
    | no administration token                                          | 401 `UNAUTHORIZED`     |
    | an unknown business                                              | 404 `NOT_FOUND`        |
```

## Abuse cases
```gherkin
Scenario: AB-1 A moderator or an app user gifts days (elevation of privilege, T7)
  When a MODERATOR, and a customer's app token, post a valid gift
  Then the answers are 403 `FORBIDDEN` and 401 `UNAUTHORIZED`, and no action, period or notice exists
```

## Implementation
- Create: `src/modules/billing/billing.admin.routes.ts`, `src/modules/billing/gift.service.ts`, `tests/integration/billing/gift-days.test.ts`
- Modify: `src/modules/billing/billing.schemas.ts`, `src/modules/billing/billing.openapi.ts`, `src/app.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `giveDays(admin: { administratorId: string }, organizationId: string, input: GiftDaysInput, now: Date): Promise<GiftView>`
- Types:
  - `GiftDaysInput = { id: string; plan: PaidPlanCode; days: number; reason: string }`
  - `GiftView = { id: string; plan: PaidPlanCode; days: number; status: 'ACTIVE' | 'SCHEDULED' | 'ENDED'; starts_at: string; ends_at: string }`
- Errors: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `ID_USED` 409
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: the role is checked before the body is read; only a SUPER_ADMIN passes.
- v5.0.0-2.3.3: action, period, event, rights, limits and notice are written in one transaction.
- v5.0.0-15.3.3: the four body fields are the only writable ones; the business comes from the path, the administrator from the token.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| gift | integration | AC-1, C-55 | answer, action, event, notice |
| free plan | integration | AC-2 | ACTIVE, limits, collaborators back |
| repeat | integration | AC-3 | same answer, 409, single rows |
| refused | integration | AC-4 | each Examples row → answer, no rows |
| moderator | security | AB-1, CWE-269 | 403 and 401, no rows |

Command: `npx vitest run tests/integration/billing/gift-days.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the gift-days path | add POST /api/v1/admin/organizations/{organizationId}/billing/gift-days, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the gift-days path | add POST /api/v1/admin/organizations/{organizationId}/billing/gift-days, remove nothing |

## Out of scope
- Which plan and how many days fit a case: left to the administrator (Q-043).
