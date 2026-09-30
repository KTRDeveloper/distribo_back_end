---
id: AUTH-016
title: Refresh a session with rotation
module: auth
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [AUTH-008]
read_first: [src/modules/auth/session.service.ts, src/modules/auth/session.repository.ts]
design_refs: [acces-et-securite/refreshtoken]
constraints: [CM-08, C-34]
asvs: [v5.0.0-7.2.2, v5.0.0-7.4.1, v5.0.0-9.2.1, v5.0.0-16.3.1]
---

# AUTH-016 — Refresh a session with rotation

## Story
As a customer, I want my session to renew itself so that I stay signed in without typing my password.

## Context
- Exists: `issueSession`, `revokeSessions`, tables (AUTH-007, AUTH-008).
- Adds: `POST /api/v1/auth/refresh` with `{ refresh_token }`; success 200 `{ access_token, refresh_token, expires_in, token_type }`.
- Rotation: the presented token gets `rotated_at`; a new token for the same device is stored, expiring 90 days from now; a new access token is signed. Marking is one conditional update (`WHERE rotated_at IS NULL AND revoked_at IS NULL`).
- Unknown, revoked, expired token or revoked device: 401 `INVALID_REFRESH_TOKEN`. A token that was already rotated is a reuse: the device session ends with reason `REUSE_DETECTED` (device and its live tokens), log `warn` event `refresh_reuse_detected`, answer 401 `SESSION_REVOKED`. Other devices stay signed in.
- A suspended person: revoke all sessions with reason `ACCOUNT_SUSPENDED` and answer 401 `SESSION_REVOKED`.
- `CM-08`: Access token (JWT) lives 15 minutes and is not stored; refresh token lives 90 days, extended at each use, replaced at each use; a reused token revokes only its own device session (REUSE_DETECTED).
- `C-34`: `Device.last_synced_at` and `Device.scope_version_seen` are set by the server only; `RefreshToken.token_hash` is unique; `revoked_reason` is set if and only if `revoked_at` is set.

## Acceptance criteria
```gherkin
Scenario: AC-1 Rotation
  When a valid refresh token is used
  Then a new pair is returned, the old token has rotated_at set and the new token belongs to the same device
Scenario Outline: AC-2 Rejections
  When the token is <case>
  Then the response is 401 `INVALID_REFRESH_TOKEN`
  Examples:
    | case                              |
    | unknown                           |
    | expired                           |
    | revoked                           |
    | of a revoked device               |
Scenario: AC-3 Reuse
  When a token that was already used is presented again
  Then the response is 401 `SESSION_REVOKED`, that device is revoked with reason REUSE_DETECTED and its newest token is revoked, and the person's other devices still refresh
Scenario: AC-4 Suspended person
  When a suspended person refreshes
  Then all their sessions are revoked with reason ACCOUNT_SUSPENDED and the response is 401 `SESSION_REVOKED`
Scenario: AC-5 Parallel use
  When the same token is sent twice at the same time
  Then one succeeds and the other is handled as a reuse
```

## Abuse cases
```gherkin
Scenario: AB-1 Stolen token replayed (spoofing)
  When a thief and the owner both use one token, one after the other
  Then the second use ends that device's session and both later calls fail
Scenario: AB-2 Access token used as refresh token (tampering)
  When an access token is sent as `refresh_token`
  Then the response is 401 `INVALID_REFRESH_TOKEN`
```

## Implementation
- Create: `tests/integration/auth/refresh.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/session.service.ts`, `src/modules/auth/session.repository.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/session.service.ts`
- Signatures:
  - `refreshSession(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>`
- Errors: `INVALID_REFRESH_TOKEN` 401, `SESSION_REVOKED` 401
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-7.4.1: revocation is enforced at refresh.
- v5.0.0-7.2.2: only a hash of the token is compared; rotation is a conditional update.
- v5.0.0-16.3.1: reuse detection is logged with a fixed event name.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| rotation | integration | AC-1, CM-08 | new pair, rotated_at, same device |
| rejections | integration | AC-2 | each Examples row → 401 |
| reuse | integration | AC-3, C-34 | second use → SESSION_REVOKED, device revoked, other device still works |
| suspended | integration | AC-4 | all revoked, 401 |
| parallel | integration | AC-5, CWE-362 | two parallel calls → one success |
| replay | security | AB-1, WSTG-SESS-06, CWE-294 | thief then owner → both fail afterwards |
| wrong token type | security | AB-2, WSTG-SESS-07 | access token → 401 |

Command: `npx vitest run tests/integration/auth/refresh.test.ts`

## Out of scope
- Logout routes (AUTH-017, AUTH-018).
