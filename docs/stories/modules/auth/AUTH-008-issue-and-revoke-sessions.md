---
id: AUTH-008
title: Issue and revoke sessions
module: auth
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [AUTH-007, AUTH-006, AUTH-005]
read_first: [src/lib/refresh-token.ts, src/config/env.ts]
design_refs: [acces-et-securite/device, acces-et-securite/refreshtoken]
constraints: [CM-08, C-34]
asvs: [v5.0.0-7.2.2, v5.0.0-7.2.4, v5.0.0-7.4.2]
---

# AUTH-008 — Issue and revoke sessions

## Story
Technical story: open a session (device, refresh token, access token) and end sessions, so that every sign-in path creates and ends sessions the same way.

## Context
- Exists: tables (AUTH-007); `signAccessToken` (AUTH-006); `generateRefreshToken`, `hashRefreshToken` in `src/lib/refresh-token.ts`; env `REFRESH_TOKEN_EXPIRES_IN_DAYS` (default 30 today).
- Adds: `src/modules/auth/session.repository.ts` and `session.service.ts`; `REFRESH_TOKEN_EXPIRES_IN_DAYS` defaults to 90 in `src/config/env.ts`.
- `issueSession(personId, device, tx?)` creates a `Device` from `DeviceInfo = { platform: ANDROID|IOS; model?: string(100); app_version: string(32); push_token?: string(512); integrity_verdict?: string(100) }`, one refresh token expiring in 90 days, and an access token; returns `{ deviceId, accessToken, refreshToken, expiresIn }`.
- `revokeSessions(personId, reason, { exceptDeviceId? })` sets `revoked_at` on the person's live devices and `revoked_at` and `revoked_reason` on their live refresh tokens, and returns the number of devices ended.
- `CM-08`: Access token (JWT) lives 15 minutes and is not stored; refresh token lives 90 days, extended at each use, replaced at each use; a reused token revokes only its own device session (REUSE_DETECTED).
- `C-34`: `Device.last_synced_at` and `Device.scope_version_seen` are set by the server only; `RefreshToken.token_hash` is unique; `revoked_reason` is set if and only if `revoked_at` is set.

## Acceptance criteria
```gherkin
Scenario: AC-1 Issue
  When issueSession runs for a registered person with device info
  Then one device and one refresh token exist, the token hash is the SHA-256 of the returned refresh token, `expires_at` is 90 days ahead, and the access token carries the person id and device id
Scenario: AC-2 One device per session
  When issueSession runs twice for the same person
  Then two devices and two refresh tokens exist
Scenario Outline: AC-3 Revoke
  Given a person with devices A, B and C
  When revokeSessions is called with reason <reason> and exceptDeviceId <except>
  Then <ended> devices end and the ended devices' tokens carry the reason
  Examples:
    | reason         | except | ended |
    | LOGOUT_ALL     | none   | 3     |
    | PASSWORD_RESET | B      | 2     |
Scenario: AC-4 Only the named person
  When revokeSessions runs for person X
  Then the devices of person Y are unchanged
Scenario: AC-5 Invalid device info
  When platform is "WINDOWS" or app_version is empty
  Then issueSession throws `httpError(400, 'VALIDATION_ERROR', ...)` and creates nothing
```

## Abuse cases
```gherkin
Scenario: AB-1 Reading a refresh token from the database (information disclosure)
  When the tables are dumped
  Then no refresh token can be derived without the raw value
```

## Implementation
- Create: `src/modules/auth/session.repository.ts`, `src/modules/auth/session.service.ts`, `tests/integration/auth/session-service.test.ts`
- Modify: `src/config/env.ts`
- Pattern: `src/modules/tasks/tasks.repository.ts`
- Signatures:
  - `issueSession(personId: string, device: DeviceInfo, tx?: Prisma.TransactionClient): Promise<{ deviceId: string; accessToken: string; refreshToken: string; expiresIn: number }>`
  - `revokeSessions(personId: string, reason: RevokedReason, options?: { exceptDeviceId?: string }): Promise<number>`
- Types:
  - `RevokedReason = 'LOGOUT' | 'DEVICE_REMOVED' | 'LOGOUT_ALL' | 'REUSE_DETECTED' | 'PASSWORD_RESET' | 'ACCOUNT_SUSPENDED'`
  - `DeviceInfo = { platform: 'ANDROID' | 'IOS'; model?: string; app_version: string; push_token?: string; integrity_verdict?: string }`
- Errors: `VALIDATION_ERROR` 400
- Dependencies: `jsonwebtoken`, `zod`, `@prisma/client`

## Security
- v5.0.0-7.2.4: every sign-in creates a new device, refresh token and access token.
- v5.0.0-7.4.2: `revokeSessions` ends all live sessions of a person in one transaction.
- v5.0.0-7.2.2: the refresh token is 32 random bytes; only its SHA-256 is stored.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| issue | integration | AC-1, CM-08 | session → rows, hash matches, 90 days, claims |
| two sessions | integration | AC-2 | two calls → 2 devices, 2 tokens |
| revoke | integration | AC-3, C-34 | each Examples row → count and reasons |
| other person | integration | AC-4 | Y unchanged |
| invalid device | integration | AC-5 | bad platform, empty version → 400, no rows |
| hash only | security | AB-1, CWE-312 | dump refresh_tokens → no column equals the raw token |

Command: `npx vitest run tests/integration/auth/session-service.test.ts`

## Out of scope
- Rotation at refresh (AUTH-015). Routes (later stories).
