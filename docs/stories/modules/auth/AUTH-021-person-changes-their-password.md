---
id: AUTH-021
title: Person changes their password
module: auth
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [AUTH-020, AUTH-009, AUTH-010]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/session.service.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-05]
asvs: [v5.0.0-6.2.2, v5.0.0-6.2.3, v5.0.0-7.4.3]
---

# AUTH-021 — Person changes their password

## Story
As a customer, I want to change my password while signed in so that I can replace one I fear is known.

## Context
- Exists: `verifyPassword`, `validatePasswordRules`, `hashPassword`, `revokeSessions(personId, reason, { exceptDeviceId })`; the attempt counter (AUTH-012).
- Adds: `POST /api/v1/auth/password/change` (authenticated) with `{ current_password, new_password }`; response 204.
- The current password is checked first; a failure adds 1 to counter `pwchange:<personId>` and answers 401 `INVALID_CREDENTIALS`; at 5 failures the answer is 429 `LOGIN_LOCKED` for `loginLockMinutes`.
- On success the hash is replaced and every other device is revoked with reason `PASSWORD_RESET`; the current device stays signed in.
- `CM-05`: Password: 8 to 64 characters, spaces allowed, no composition rules, refused when on the blocklist, hashed with Argon2id; 5 failed attempts force a wait.

## Acceptance criteria
```gherkin
Scenario: AC-1 Change
  When the right current password and a valid new one are posted
  Then the response is 204 and only the new password verifies
Scenario: AC-2 Other phones signed out
  Given the person has three devices
  Then the two other devices are revoked with reason PASSWORD_RESET and the current one is live
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and the password is unchanged
  Examples:
    | problem                               | status                 |
    | a wrong current password              | 401 INVALID_CREDENTIALS|
    | new_password "1234567"                | 400 WEAK_PASSWORD      |
    | new_password equal to the current one | 400 VALIDATION_ERROR   |
    | a 65-character new_password           | 400 WEAK_PASSWORD      |
Scenario: AC-4 Lock
  When 5 wrong current passwords are sent
  Then the sixth attempt answers 429 `LOGIN_LOCKED`
```

## Abuse cases
```gherkin
Scenario: AB-1 Stolen session changes the password (elevation)
  When a request with a valid access token but a wrong current password arrives
  Then the password is unchanged
Scenario: AB-2 No token (unauthenticated)
  When the request has no valid token
  Then the response is 401
```

## Implementation
- Create: `tests/integration/auth/password-change.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.service.ts`
- Signatures:
  - `changePassword(personId: string, deviceId: string, input: { current_password: string; new_password: string }): Promise<void>`
- Errors: `INVALID_CREDENTIALS` 401, `LOGIN_LOCKED` 429, `WEAK_PASSWORD` 400, `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`, `argon2`

## Security
- v5.0.0-6.2.3: the current password is required.
- v5.0.0-7.4.3: the other sessions end.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| change | integration | AC-1, CM-05 | 204, only new verifies |
| other phones | integration | AC-2 | two revoked, current live |
| refusals | integration | AC-3 | each Examples row → status |
| lock | integration | AC-4 | sixth → 429 |
| stolen session | security | AB-1, CWE-620 | wrong current → unchanged |
| no token | security | AB-2, WSTG-ATHN-04 | 401 |

Command: `npx vitest run tests/integration/auth/password-change.test.ts`

## Out of scope
- Password reset by code (AUTH-020).
