---
id: PER-001
title: Retire the old sign-in module
module: person
kind: removal
rev: 1
amends: [FND-001]
size: M
risk: medium
depends_on: [FND-001, FND-006]
read_first: [src/app.ts, src/modules/user/user.repository.ts]
design_refs: [identite-et-organisation/person]
constraints: []
asvs: [v5.0.0-15.2.3]
---

# PER-001 — Retire the old sign-in module

## Story
Technical story: retire the old phone-and-password sign-in module so that the v10 authentication (AUTH module) is built on the new tables instead of patched onto the old ones.

## Context
- Exists: `src/modules/auth/` (7 files), `scripts/create-user.ts`, `tests/integration/auth.test.ts`, `tests/fixtures/auth.ts`; `src/modules/user/user.repository.ts` imports `toAuthUser` from the auth repository; four API-docs tests use the auth routes.
- Removes: the auth module, its routes in `src/app.ts` and its OpenAPI registration, the create-user script, the auth integration test and fixtures. Keeps `src/lib/otp.ts`, `refresh-token.ts`, `otp-delivery-queue.ts`, `rate-limit.ts`, `jwt.ts`, `src/middleware/auth.ts`, the database tables, and the OTP worker.
- Changes: `user.repository.ts` maps the account and person itself instead of importing from the auth module.
- After this story nobody can register or log in until the AUTH stories land; tests sign tokens directly with `tests/helpers/request.ts`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Legacy routes are gone
  When a client posts to `/api/v1/auth/register`, `/api/v1/auth/login` or `/api/v1/auth/refresh`
  Then the response is 404 `NOT_FOUND`
Scenario: AC-2 Documentation matches
  When GET `/api/v1/docs/openapi.json` is read
  Then no path starts with `/api/v1/auth` and `/api/v1/users/me` is still listed
Scenario: AC-3 Profile still works with a signed token
  Given a seeded account and a token signed with `createAuthenticatedRequest`
  When the client calls GET `/api/v1/users/me`
  Then the response is 200 with the same fields as before this story
Scenario: AC-4 The suite is green
  When `npm test` runs
  Then every remaining test passes
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Modify: `src/app.ts`, `src/modules/user/user.repository.ts`
- Pattern: `src/modules/user/user.repository.ts`
- Dependencies: none added

## Security
- v5.0.0-15.2.3: no unused authentication code stays in the production build.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| routes removed | integration | AC-1 | POST register, login, refresh → 404 NOT_FOUND |
| docs updated | integration | AC-2 | openapi paths → none under /api/v1/auth; /api/v1/users/me present |
| profile works | integration | AC-3 | seeded account, signed token → GET /api/v1/users/me → 200 with id and name |
| suite green | integration | AC-4 | full `npm test` → no failure |

Command: `npx vitest run tests/integration/user.test.ts tests/integration/api-docs`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/auth.test.ts | tests the removed routes | file deleted |
| tests/integration/api-docs/catalog.test.ts | asserts `/api/v1/auth/*` paths | assert `/api/v1/health` and `/api/v1/users/me` instead and that no auth path exists |
| tests/integration/api-docs/auth-execute.test.ts | registers through the removed API to get a token | seed an account and sign the token with `createAuthenticatedRequest` |
| tests/integration/api-docs/error-response.test.ts | posts to `/api/v1/auth/register` | post invalid input to `/api/v1/tasks` and keep the 4xx assertions |
| tests/integration/api-docs/generate-script.test.ts | expects `/api/v1/auth/login` | expect `/api/v1/users/me` |

## Out of scope
- New registration and login (AUTH module).
- Person table rebuild (PER-002).
