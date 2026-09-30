---
id: AUTH-018
title: Person manages their phones
module: auth
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [AUTH-017]
read_first: [src/modules/auth/session.service.ts, src/modules/auth/auth.routes.ts]
design_refs: [acces-et-securite/device, acces-et-securite/connexion-verrouillage-et-telephone]
constraints: []
asvs: [v5.0.0-7.4.3, v5.0.0-7.4.5, v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# AUTH-018 — Person manages their phones

## Story
As a customer, I want to see my signed-in phones and sign any of them out so that I can act after a loss or a theft.

## Context
- Exists: `revokeDevice`, `revokeSessions` (AUTH-008, AUTH-017).
- Adds: `GET /api/v1/auth/devices` (live devices: `id, platform, model, app_version, created_at, last_synced_at, current`); `DELETE /api/v1/auth/devices/{id}` (204, reason `DEVICE_REMOVED`); `POST /api/v1/auth/logout-all` (204, every device including this one, reason `LOGOUT_ALL`).
- `push_token`, `integrity_verdict` and `scope_version_seen` are never returned.

## Acceptance criteria
```gherkin
Scenario: AC-1 List
  Given a person with two live devices and one revoked device
  When they GET /api/v1/auth/devices
  Then two items are returned, ordered by created_at descending, one flagged current
Scenario: AC-2 Remove one
  When they DELETE another live device of theirs
  Then the response is 204 and that device's refresh path is closed
Scenario: AC-3 Unknown or foreign id
  When the id is unknown, malformed or belongs to someone else
  Then the response is 404 `NOT_FOUND` or 400 `VALIDATION_ERROR`
Scenario: AC-4 Sign out everywhere
  When they post to /api/v1/auth/logout-all
  Then every device of the person is revoked with reason LOGOUT_ALL and their refresh tokens fail
```

## Abuse cases
```gherkin
Scenario: AB-1 Another person's devices (horizontal)
  When person A lists or deletes with the id of a device of person B
  Then B's devices are not listed and stay live
Scenario: AB-2 Private fields (information disclosure)
  When the list is read
  Then no push_token, integrity_verdict or scope_version_seen appears
```

## Implementation
- Create: `tests/integration/auth/devices.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/session.repository.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.routes.ts`
- Signatures:
  - `listDevices(personId: string, currentDeviceId: string): Promise<DeviceView[]>`
- Types:
  - `DeviceView = { id: string; platform: string; model: string | null; app_version: string; created_at: string; last_synced_at: string | null; current: boolean }`
- Errors: `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`

## Security
- v5.0.0-7.4.3: a person can end all their other sessions.
- v5.0.0-8.2.2: every query filters on the person id from the token.
- v5.0.0-15.3.1: explicit field list in the response.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1 | 2 live, ordered, current flag |
| remove one | integration | AC-2 | 204, refresh fails |
| bad id | integration | AC-3 | 404 or 400 |
| logout all | integration | AC-4 | all revoked, LOGOUT_ALL |
| other person | security | AB-1, WSTG-ATHZ-04 | B's devices untouched |
| private fields | security | AB-2, CWE-200 | key list has no private field |

Command: `npx vitest run tests/integration/auth/devices.test.ts`

## Out of scope
- The lost phone erasing its data (client behavior).
