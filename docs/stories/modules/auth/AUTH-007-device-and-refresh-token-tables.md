---
id: AUTH-007
title: Device and refresh token tables
module: auth
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [PER-003, FND-005, AUTH-001]
read_first: [prisma/schema.prisma, tests/integration/auth/otp-table.test.ts]
design_refs: [acces-et-securite/device, acces-et-securite/refreshtoken, contraintes-a-poser-au-niveau-base-de]
constraints: ['Device:required', 'Device:fk', 'Device.platform:enum', 'RefreshToken:required', 'RefreshToken:fk', 'RefreshToken.revoked_reason:enum', 'RefreshToken.token_hash:unique', C-34, C-01]
asvs: [v5.0.0-7.2.2, v5.0.0-7.4.1]
---

# AUTH-007 — Device and refresh token tables

## Story
Technical story: create the tables of sessions, one device per login and its refresh tokens, so that each phone can be signed out on its own.

## Context
- Exists: `people` (PER-002); the old `refresh_tokens` table was dropped there.
- Adds: `devices` (`scope_version_seen` int default 0, `revoked_at` null) and `refresh_tokens` (`token_hash` unique, `revoked_reason` null) with a CHECK that `revoked_reason` and `revoked_at` are set together, foreign keys to `people` and `devices`, and indexes on `refresh_tokens(person_id)`, `refresh_tokens(device_id)`, `refresh_tokens(expires_at)`, `devices(person_id)` where `revoked_at` is null.
- `last_synced_at` and `scope_version_seen` are written only by the sync endpoint (SYNC module); no request body may set them.
- `Device` fields: `person_id` FK → Person; `platform` enum [ANDROID / IOS]; `model` string, nullable; `push_token` string, nullable; `app_version` string; `last_synced_at` datetime, nullable; `scope_version_seen` int; `integrity_verdict` string, nullable; `created_at` datetime; `revoked_at` datetime, nullable
- `RefreshToken` fields: `person_id` FK → Person; `device_id` FK → Device; `token_hash` string, unique; `expires_at` datetime; `created_at` datetime; `rotated_at` datetime, nullable; `revoked_at` datetime, nullable; `revoked_reason` enum [LOGOUT / DEVICE_REMOVED / LOGOUT_ALL / REUSE_DETECTED / PASSWORD_RESET / ACCOUNT_SUSPENDED], nullable
- `Device:required`: NOT NULL: `person_id`, `platform`, `app_version`, `scope_version_seen`, `created_at`
- `Device:fk`: references person_id → Person
- `Device.platform:enum`: one of ANDROID, IOS
- `RefreshToken:required`: NOT NULL: `person_id`, `device_id`, `token_hash`, `expires_at`, `created_at`
- `RefreshToken:fk`: references person_id → Person; device_id → Device
- `RefreshToken.revoked_reason:enum`: one of LOGOUT, DEVICE_REMOVED, LOGOUT_ALL, REUSE_DETECTED, PASSWORD_RESET, ACCOUNT_SUSPENDED
- `RefreshToken.token_hash:unique`: unique
- `C-34`: `Device.last_synced_at` and `Device.scope_version_seen` are set by the server only; `RefreshToken.token_hash` is unique; `revoked_reason` is set if and only if `revoked_at` is set.
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Device row
  When a device is inserted for a registered person with platform ANDROID and app_version "1.0.0"
  Then `scope_version_seen` is 0, `last_synced_at` and `revoked_at` are empty and `created_at` is set
Scenario Outline: AC-2 Refresh token rules
  When a token row has <values>
  Then the insert <result>
  Examples:
    | values                                       | result          |
    | revoked_at set, revoked_reason LOGOUT        | accepts         |
    | revoked_at set, revoked_reason empty         | rejects (23514) |
    | revoked_at empty, revoked_reason LOGOUT      | rejects (23514) |
    | token_hash equal to an existing one          | rejects (23505) |
    | revoked_reason "EXPIRED"                     | rejects         |
Scenario: AC-3 Enums and keys
  When platform is "WINDOWS", or a foreign key is unknown
  Then the insert fails
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `prisma/migrations/<timestamp>_auth_007_devices_refresh_tokens/migration.sql`, `tests/integration/auth/session-tables.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/auth/otp-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-7.2.2: only a hash of the refresh token is stored, in a unique column.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| device defaults | integration | AC-1, Device:required, C-01 | insert → defaults; column types |
| token rules | integration | AC-2, C-34, RefreshToken:required, RefreshToken.token_hash:unique | each Examples row → accepted or SQLSTATE |
| enums and keys | integration | AC-3, Device.platform:enum, RefreshToken.revoked_reason:enum, Device:fk, RefreshToken:fk | bad values → rejected |

Command: `npx vitest run tests/integration/auth/session-tables.test.ts`

## Out of scope
- Issuing and revoking sessions (AUTH-008).
