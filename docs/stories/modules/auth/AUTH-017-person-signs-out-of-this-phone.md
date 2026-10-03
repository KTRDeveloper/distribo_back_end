---
id: AUTH-017
title: Person signs out of this phone
module: auth
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [AUTH-016, AUTH-009, AUTH-010]
read_first: [src/modules/auth/session.service.ts, src/modules/auth/auth.routes.ts]
design_refs: [acces-et-securite/refreshtoken, acces-et-securite/connexion-verrouillage-et-telephone]
constraints: []
asvs: [v5.0.0-7.4.1, v5.0.0-8.2.2]
---

# AUTH-017 — Person signs out of this phone

## Story
As a customer, I want to sign out of this phone so that nobody can renew its session.

## Context
- Exists: `POST /auth/refresh` (AUTH-016); `req.user.deviceId` from the access token.
- Adds: `POST /api/v1/auth/logout` (authenticated, no body): ends the device named in the token with reason `LOGOUT` (device `revoked_at`, its live tokens revoked). Response 204. `revokeDevice(personId, deviceId, reason)` in `session.service.ts`.
- The access token still verifies until it expires (15 minutes); its refresh path is closed at once.

## Acceptance criteria
```gherkin
Scenario: AC-1 Sign out
  When a signed-in person posts to /api/v1/auth/logout
  Then the response is 204, the device has revoked_at set and its tokens have reason LOGOUT
Scenario: AC-2 Refresh is closed
  When the same device then uses its refresh token
  Then the response is 401 `INVALID_REFRESH_TOKEN`
Scenario: AC-3 Other phones stay
  Then the person's other devices are unchanged
Scenario: AC-4 Repeat
  When logout is posted twice
  Then both answers are 204
```

## Abuse cases
```gherkin
Scenario: AB-1 Signing another person's device out (horizontal)
  When a token names a device of another person
  Then the other person's device is unchanged and the response is 204 without effect
Scenario: AB-2 No token (unauthenticated)
  When the request has no valid token
  Then the response is 401
```

## Implementation
- Create: `tests/integration/auth/logout.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/session.service.ts`, `src/modules/auth/session.repository.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.routes.ts`
- Signatures:
  - `revokeDevice(personId: string, deviceId: string, reason: RevokedReason): Promise<boolean>`
- Errors: `UNAUTHORIZED` 401
- Dependencies: `express`

## Security
- v5.0.0-7.4.1: ending a session closes its refresh path on the server.
- v5.0.0-8.2.2: the update filters on person id and device id together.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| sign out | integration | AC-1 | 204, revoked device and tokens |
| refresh closed | integration | AC-2 | 401 |
| others stay | integration | AC-3 | other device live |
| repeat | integration | AC-4 | 204 twice |
| other person's device | security | AB-1, WSTG-ATHZ-04 | unchanged |
| no token | security | AB-2, WSTG-ATHN-04 | 401 |

Command: `npx vitest run tests/integration/auth/logout.test.ts`

## Out of scope
- Device list and removal of other phones (AUTH-018).
