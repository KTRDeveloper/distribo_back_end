---
id: ADM-006
title: Administrator signs in with password and authenticator code
module: admin
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ADM-004, ADM-002, AUTH-012, AUTH-009, ORG-004]
read_first: [src/modules/auth/auth.service.ts, src/lib/jwt.ts]
design_refs: [gouvernance-de-la-plateforme/administrator, acces-et-securite/connexion-verrouillage-et-telephone]
constraints: [C-29]
asvs: [v5.0.0-6.3.3, v5.0.0-7.2.1, v5.0.0-9.2.2, v5.0.0-6.3.1]
---

# ADM-006 — Administrator signs in with password and authenticator code

## Story
As a moderator, I want to sign in to the administration space with my password and my authenticator code so that only staff reach it.

## Context
- Exists: `verifyPassword`, the attempt counter (AUTH-012), `verifyTotp` (ADM-004), `signAccessToken` style (AUTH-006), `findByActivePhone`.
- Adds: `POST /api/v1/admin/auth/login` with `{ phone_number, password, totp_code }`; response 200 `{ access_token, expires_in, role }`. No refresh token: the session lasts 15 minutes (Q-013).
- Checks in one order: lock counter, person, password (dummy hash for unknown), live Administrator (`removed_at` empty), person status not SUSPENDED, TOTP. Any failure answers 401 `INVALID_CREDENTIALS`, same body. Failures add to the counter of `admin:<phone>`.
- The token payload is `{ sub: personId, adm: administratorId, role, typ: 'admin' }`; `src/middleware/admin-auth.ts` provides `adminAuthMiddleware` (accepts only `typ` admin and re-checks that the administrator is still live) and `requireAdminRole(min)`, and sets `req.admin`. A normal access token is refused on admin routes and an admin token on normal routes.
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC (super administrators only), and is immutable.

## Acceptance criteria
```gherkin
Scenario: AC-1 Sign in
  When an administrator posts the right number, password and code
  Then the response is 200 with an admin token that expires in 15 minutes
Scenario Outline: AC-2 Failures look alike
  When the login has <case>
  Then the response is 401 `INVALID_CREDENTIALS` with the same body
  Examples:
    | case                                     |
    | a wrong password                         |
    | a wrong or reused code                   |
    | a person who is not an administrator     |
    | a removed administrator                  |
    | a suspended person                       |
    | an unknown number                        |
Scenario: AC-3 Lock
  When 5 failures occur for one number
  Then the next attempt answers 429 `LOGIN_LOCKED`
Scenario: AC-4 Token types
  Then a normal access token on an admin route answers 401 and an admin token on a normal route answers 401
Scenario: AC-5 Removed while signed in
  When an administrator is removed and calls an admin route with a valid token
  Then the response is 401
```

## Abuse cases
```gherkin
Scenario: AB-1 Password alone (spoofing)
  When a request has the right password and no or a wrong code
  Then no token is issued
Scenario: AB-2 Ordinary token on admin routes (elevation)
  When a customer's access token is used on an admin route
  Then the response is 401
```

## Implementation
- Create: `src/modules/admin/admin.routes.ts`, `src/modules/admin/admin.schemas.ts`, `src/modules/admin/admin.service.ts`, `src/middleware/admin-auth.ts`, `tests/integration/admin/admin-login.test.ts`
- Modify: `src/app.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `adminLogin(input: { phone_number: string; password: string; totp_code: string }): Promise<{ access_token: string; expires_in: number; role: string }>`
  - `adminAuthMiddleware: RequestHandler`
  - `requireAdminRole(min: 'MODERATOR' | 'SUPER_ADMIN'): RequestHandler`
- Errors: `INVALID_CREDENTIALS` 401, `LOGIN_LOCKED` 429
- Dependencies: `express`, `zod`, `jsonwebtoken`, `argon2`, `otplib`

## Security
- v5.0.0-6.3.3: password and authenticator code are both required.
- v5.0.0-9.2.2: the token type must be `admin`.
- v5.0.0-6.3.1: lock after 5 failures.
- v5.0.0-7.2.1: the administrator is re-checked on every admin request.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| sign in | integration | AC-1, C-29 | token, 15 minutes |
| failures alike | integration | AC-2 | each Examples row → 401 same body |
| lock | integration | AC-3 | 429 |
| token types | integration | AC-4 | 401 both ways |
| removed | integration | AC-5 | 401 |
| password only | security | AB-1, WSTG-ATHN-11, CWE-308 | no token |
| ordinary token | security | AB-2, WSTG-ATHZ-03 | 401 |

Command: `npx vitest run tests/integration/admin/admin-login.test.ts`

## Out of scope
- Recovery of a lost authenticator (ADM-008). OpenAPI (ADM-015).
