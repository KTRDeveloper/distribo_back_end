---
id: SYNC-008
title: Device tracking and full resynchronization
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-003, AUTH-007, PER-005]
read_first: [src/modules/sync/sync.service.ts, src/modules/sync/sync.viewer.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, acces-et-securite/device]
constraints: [CM-03, C-34]
asvs: [v5.0.0-7.4.2, v5.0.0-8.2.2]
---

# SYNC-008 — Device tracking and full resynchronization

## Story
As a seller, I want my phone to start again from zero when my rights change so that it never keeps data I lost the right to see.

## Context
- Exists: pull (SYNC-003); `devices.last_synced_at` and `scope_version_seen` written only by sync; `Person.scope_version` bumped by rights changes (CM-03).
- Changes: the pull route reads header `X-Scope-Version` (the version the phone knows). When it is lower than `Person.scope_version`, or the device is revoked, the response is 200 `{ resync_required: true, timestamp }` with no `changes`. A pull with `last_pulled_at` empty is a full pull and, when it completes, sets the device's `scope_version_seen` to the person's current value. Every pull sets `last_synced_at` to server time.
- A revoked device (`revoked_at` set) answers 401 `SESSION_REVOKED`. The response always contains `scope_version`.
- `CM-03`: `Person.scope_version` is incremented by the server on every rights change.
- `C-34`: `Device.last_synced_at` and `Device.scope_version_seen` are set by the server only; `RefreshToken.token_hash` is unique; `revoked_reason` is set if and only if `revoked_at` is set.

## Acceptance criteria
```gherkin
Scenario: AC-1 Rights changed
  Given the person's scope_version is 5 and the phone sends 4
  When it pulls
  Then the response is `{ resync_required: true }` without changes
Scenario: AC-2 Full pull records the version
  When the phone then pulls with last_pulled_at empty
  Then `scope_version_seen` is 5 and the response carries scope_version 5
Scenario: AC-3 Up to date
  When the phone sends 5
  Then a normal incremental pull is returned
Scenario: AC-4 Last sync time
  Then every pull sets the device's last_synced_at to server time
Scenario: AC-5 Revoked device
  When the device was revoked
  Then the response is 401 `SESSION_REVOKED`
```

## Abuse cases
```gherkin
Scenario: AB-1 A phone claiming a newer version (tampering)
  When the phone sends X-Scope-Version 999
  Then the server still compares with the database and the pull is normal; scope_version_seen never exceeds the person's value
```

## Implementation
- Create: `tests/integration/sync/resync.test.ts`
- Modify: `src/modules/sync/sync.routes.ts`, `src/modules/sync/sync.service.ts`, `src/modules/sync/sync.viewer.ts`
- Pattern: `src/modules/sync/sync.service.ts`
- Signatures:
  - `recordPull(viewer: Viewer, phoneScopeVersion: number, full: boolean): Promise<void>`
- Errors: `SESSION_REVOKED` 401
- Dependencies: `express`, `@prisma/client`

## Security
- v5.0.0-7.4.2: a revoked device cannot pull.
- v5.0.0-8.2.2: the server compares with its own scope_version.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| rights changed | integration | AC-1, CM-03 | resync_required |
| full pull | integration | AC-2, C-34 | seen = 5 |
| up to date | integration | AC-3 | normal |
| last sync | integration | AC-4 | server time |
| revoked | integration | AC-5 | 401 |
| newer claim | security | AB-1, CWE-345 | not trusted |

Command: `npx vitest run tests/integration/sync/resync.test.ts`

## Out of scope
- Erasing data on the phone (client).
