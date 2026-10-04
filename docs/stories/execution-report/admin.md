# Execution report: admin

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

### Run 2026-10-04 04:48 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| ADM-001 Administrators table | todo | - |  |
| ADM-002 Administration journal table | todo | - |  |
| ADM-003 Reports table | todo | - |  |
| ADM-004 Two-factor codes for administrators | todo | - |  |
| ADM-005 Create the first super administrator from the command line | todo | - |  |
| ADM-006 Administrator signs in with password and authenticator code | todo | - |  |
| ADM-007 Administrator registers a recovery email | todo | - |  |
| ADM-008 Administrator reinstalls the authenticator through the recovery email | todo | - |  |
| ADM-009 Super administrator appoints an administrator | todo | - |  |
| ADM-010 Super administrator removes an administrator | todo | - |  |
| ADM-011 Person reports another person or a business | todo | - |  |
| ADM-012 Administrator lists and opens reports | todo | - |  |
| ADM-013 Administrator resolves a report | todo | - |  |
| ADM-014 Administrator suspends or reactivates without a report | todo | - |  |
| ADM-015 Administrators read the action journal | todo | - |  |

Also in this run: relationship, catalog, order, finance, delivery.

- Stopped after REL-002: blocked, a REL-001 test (`relationship-table.test.ts` › "rejects an unknown merged_into_id with 23503 and accepts an existing one") conflicts with the new CHECKs and the story does not list it under "Tests to update".
- Not reached: REL-003 to DLV-009 (98 stories), because the run stopped on the block; no `--keep-going`.
- Nothing unexpected: the agent report and the notification figures both came in.
- REL-002's migration, test file and schema.prisma comment are left uncommitted in the working tree, waiting for the human decision.
- Next: decide whether that REL-001 test may be updated (amend REL-002's "Tests to update"), then `/implement-stories REL-002` and `/implement-stories next:100`.

<!-- begin ADM-001 -->
## ADM-001 — Administrators table

- Filed: 2026-10-04 06:29 UTC
- Status: **done**: administrators table, 14 tests, full suite 1075 pass
- Risk: high · story: [ADM-001-administrators-table.md](../modules/admin/ADM-001-administrators-table.md)
- Agent: 39,224 tokens, 15 tool uses, 6 min 46 s

### Agent report

**Summary:** Added the administrators table (enum, partial unique index, deferred registered-person trigger, recovery-email trigger) and the Prisma model.

**Decisions:**
- Blank totp_secret: added CHECK btrim(totp_secret) <> '' (23514); NOT NULL alone does not refuse an empty string, and AB-1 requires refusal.
- Registered-person trigger is a deferred constraint trigger (as in REL-003/014), so an unknown person id fails with 23503 first (AC-2).
- Recovery-email trigger is BEFORE INSERT OR UPDATE on administrators only; it does not fire when the person's email changes later (noted in schema comment).
- Added index on person_id in the Prisma model (relation lookup); the live-row uniqueness is the partial index in SQL only.

**Tests added beyond the story:**
- `tests/integration/admin/administrator-table.test.ts` › blank secret ('' and spaces): AB-1 refusal with 23514 (AB-1); failed first, then passed with the CHECK
- same file › update of recovery_email to the person's email: rule applies on UPDATE too (C-29); passed once trigger existed
- same file › SUPER_ADMIN accepted, appointed_at/removed_at defaults (Context)

**Evidence:** story tests 14/14; full suite 1075/1075, failing: none; typecheck clean; lint 0 errors, 44 warnings (pre-existing)

**Follow-ups:**
- Guest test runs as an auto-committed statement: the driver does not expose the SQLSTATE of a deferred-trigger failure raised at interactive-transaction commit.
<!-- end ADM-001 -->

<!-- begin ADM-002 -->
## ADM-002 — Administration journal table

- Filed: 2026-10-04 06:36 UTC
- Status: **done**: admin_actions table, immutability, REPLAY_SYNC trigger, recordAdminAction
- Risk: high · story: [ADM-002-administration-journal-table.md](../modules/admin/ADM-002-administration-journal-table.md)
- Agent: 46,381 tokens, 14 tool uses, 7 min 13 s

### Agent report

**Summary:** Added admin_actions table (CHECKs, FKs, REPLAY_SYNC role trigger, append-only grants), Prisma model and recordAdminAction.

**Decisions:**
- Prisma enum AdminActionType plus a literal-union type of the same name in admin.repository.ts: matches the story's type signature without importing the Prisma enum.
- Blank reason (spaces only) also rejected, like the administrators totp_secret check: "reason not empty" read as not blank.
- REPLAY_SYNC role trigger fires on INSERT and UPDATE and checks only the administrator's role, not removed_at: the story says role only.
- Exactly-one-target applies to every action, so a REPLAY_SYNC row also needs a target.
- Wrote migration before the test file, so the tests passed at once: the TDD red step was skipped.

**Tests added beyond the story:**
- `tests/integration/admin/admin-action-table.test.ts` › organization target accepted, all other actions accepted, blank reason, missing required columns 23502, unknown FKs 23503: AC-1 and AdminAction:required/fk; passed at once
- same file › application account can still read rows (C-39); passed at once
- same file › recordAdminAction distinct ids, and rollback of the whole transaction on a violation (fail closed, CONVENTIONS); passed at once

**Evidence:** story tests 18/18; full suite 1093/1093, failing: none; typecheck clean; lint 0 errors, 44 warnings (existing)

**Follow-ups:**
- ADM-003 and SYNC-002 must add the FKs for report_id and sync_archive_id and update the schema.prisma comment.
<!-- end ADM-002 -->

<!-- begin ADM-003 -->
## ADM-003 — Reports table

- Filed: 2026-10-04 06:45 UTC
- Status: **done**: reports table, enums, FK admin_actions.report_id; 1109 tests pass
- Risk: medium · story: [ADM-003-reports-table.md](../modules/admin/ADM-003-reports-table.md)
- Agent: 40,111 tokens, 13 tool uses, 8 min 28 s

### Agent report

**Summary:** Added `reports` table (enums ReportStatus/ReportDecision, one-target CHECK, registered-reporter and server_updated_at triggers) and FK `admin_actions.report_id` -> reports; schema.prisma updated.

**Decisions:**
- Migration named `20261004190000_adm_003_reports`; FKs ON DELETE RESTRICT like sibling tables.
- Added indexes on every FK column of reports and on admin_actions.report_id (the other tables index their FKs).
- No CHECK tying status/decision/resolved_at/resolved_by_id together: the story does not ask for it; noted in the schema comment as code responsibility (ADM-013).

**Tests added beyond the story:**
- `tests/integration/admin/report-table.test.ts` › refuses an update that adds a second target: the one-target CHECK also holds on UPDATE (C-28); passed at once
- same file › rejects a missing reporter, reason, description or status with 23502: Report:required
- same file › accepts resolved_by_id only for an existing administrator (a non-admin person gives 23503): C-04 / Report:fk
- same file › refreshes server_updated_at on update: the trigger from the story's Context

**Evidence:** story tests 16/16; full suite 1109/1109, failing: none; typecheck clean; lint 0 errors, 45 warnings (pre-existing security/detect-non-literal-fs-filename)

**Follow-ups:**
- `prisma migrate diff` against the test DB still shows pre-existing drift on `tasks` (accountId vs account_id), unrelated to this story.
<!-- end ADM-003 -->

<!-- begin ADM-004 -->
## ADM-004 — Two-factor codes for administrators

- Filed: 2026-10-04 06:55 UTC
- Status: **done**: TOTP create/encrypt/verify with atomic replay guard; 13 tests green
- Risk: high · story: [ADM-004-two-factor-codes-for-administrators.md](../modules/admin/ADM-004-two-factor-codes-for-administrators.md)
- Agent: 34,749 tokens, 23 tool uses, 9 min 47 s

### Agent report

**Summary:** Added src/lib/totp.ts (create secret, encrypt/decrypt wrappers, verifyTotp with replay guard) and its unit tests; all green.

**Decisions:**
- otplib was not installed: added `otplib@13.5.0` exact (allowed list); package.json and lockfile changed.
- `verifyTotp` takes an optional 4th `client` param (default real redis): Redis is globally mocked in tests, so an in-memory fake is injected.
- Step claimed through `checkAndConsume(key, 1, 90)` only after the code matched: atomic via Lua, a wrong code burns nothing.
- Window via `epochTolerance: 30`; the matched `timeStep` from otplib names the used-step key.
- Code format checked (`^\d{6}$`) before any crypto or Redis call; Redis error rejects (fail closed).
- otpauth label is the fixed word "administrator", so the URI has no personal data.

**Tests added beyond the story:**
- `tests/unit/admin/totp.test.ts` › stores the used step per administrator for 90 seconds: key format and TTL (story Context)
- same › does not let one administrator use up the code of another: key scoped by administrator id (story Context); passed at once
- same › does not consume a step when the code is wrong: wrong guess burns nothing; passed at once
- same › accepts a code only once when presented in parallel: race on replay guard (AC-3, AB-1); passed at once (atomic path via fake eval)

**Evidence:** story tests 13/13; full suite 1122/1122, failing: none; typecheck clean; lint 0 errors, 45 warnings (existing)

**Follow-ups:**
- `npm audit --audit-level=high` reports 35 high / 3 critical, none from otplib (same count before my change); a human should triage the dependency audit.
<!-- end ADM-004 -->

<!-- begin ADM-005 -->
## ADM-005 — Create the first super administrator from the command line

- Filed: 2026-10-04 07:21 UTC
- Status: **done**: createFirstSuperAdmin script + admin:create-super; 9 tests; full suite 1131 pass
- Risk: high · story: [ADM-005-create-the-first-super-administrator-from-the.md](../modules/admin/ADM-005-create-the-first-super-administrator-from-the.md)
- Agent: 48,230 tokens, 29 tool uses, 25 min 51 s

### Agent report

**Summary:** Added scripts/create-super-admin.ts (createFirstSuperAdmin + CLI) and the admin:create-super npm script; all tests pass.

**Decisions:**
- DB access: the script calls new functions in admin.repository.ts (lock, live-SUPER_ADMIN check, registered-person lookup, insert), keeping "repository is the only file that calls prisma".
- Did not use findOrCreateByPhone: it would create a guest row for an unknown number, breaking "creates nothing" (AC-2); a lookup of registered people is used instead.
- Concurrency: one transaction with pg_advisory_xact_lock, so two simultaneous bootstraps cannot both succeed.
- Refusal messages never reveal whether a person exists; nothing is logged, URI goes to stdout only.
- CLI calls process.exit after main: the Redis client loaded through totp.ts otherwise keeps the process alive forever.

**Tests added beyond the story:**
- `create-super-admin.test.ts` › a removed SUPER_ADMIN does not count: "live" in the story means removed_at empty; passed at once
- `create-super-admin.test.ts` › concurrent runs: exactly one SUPER_ADMIN is created (race, AB-1 / CWE-269 / CWE-362)

**Other additions:**
- Four repository functions in src/modules/admin/admin.repository.ts (see Decisions).

**Evidence:** story tests 9/9; full suite 1131/1131, failing: none; typecheck clean; lint 0 errors, 45 warnings (pre-existing)

**Follow-ups:**
- tsconfig/lint cover only src and tests, so scripts/ is not type-checked by `npm run typecheck`; only vitest and tsx compile it.
- Running two `npm test` at once on the shared test DB makes spurious failures (I hit this by accident).
<!-- end ADM-005 -->

<!-- begin ADM-006 -->
## ADM-006 — Administrator signs in with password and authenticator code

- Filed: 2026-10-04 07:39 UTC
- Status: **done**: Admin login, admin JWT and adminAuthMiddleware; 19 tests; OpenAPI left to ADM-015
- Risk: high · story: [ADM-006-administrator-signs-in-with-password-and.md](../modules/admin/ADM-006-administrator-signs-in-with-password-and.md)
- Agent: 63,616 tokens, 24 tool uses, 18 min 9 s

### Agent report

**Summary:** Added POST /api/v1/admin/auth/login, admin JWT helpers, adminAuthMiddleware and requireAdminRole; all green.

**Decisions:**
- Lock key: `admin:<phone>`, taken before any check like AUTH-012, cleared on success; the story names the key, so I used it literally.
- Invalid phone format: 401 INVALID_CREDENTIALS after one dummy verification, no counter (an arbitrary string would make unbounded keys).
- Admin token helpers `signAdminToken`/`verifyAdminToken` added to `src/lib/jwt.ts` (fixed 900 s lifetime, not the config value); `req.admin` typed in `src/types/express.d.ts`.
- adminAuthMiddleware takes the role from the database row, not the token, and looks up (id, person) together; every failure is a 401 UNAUTHORIZED. requireAdminRole answers 403 for a lower role.
- No admin route exists yet, so AC-4/AC-5 tests mount the middleware on a probe express app; the "normal route" check uses GET /api/v1/auth/devices.
- Dummy hash is duplicated locally: it is private to auth.service, and a module imports another only through its contracts.

**Tests added beyond the story:**
- `admin-login.test.ts` › lock counter is `admin:` apart from ordinary login: no cross-lock between the two logins (AC-3 / story Context); passed at once
- `admin-login.test.ts` › success clears the counter (AUTH-012 pattern); passed at once
- `admin-login.test.ts` › unknown/missing field gives 400 (Validation convention: strict schemas)
- `admin-login.test.ts` › forged signature, HS512 and no header answer 401 (v5.0.0-9.1.1)
- `admin-login.test.ts` › MODERATOR on a SUPER_ADMIN route gets 403 (requireAdminRole contract)

**Other additions:**
- `findLiveAdministratorByPerson` and `findLiveAdministrator` in `admin.repository.ts` (the only prisma access).

**Evidence:** story tests 19/19; full suite 1150/1150, failing: none; typecheck clean; lint 0 errors, 46 warnings (existing)

**Follow-ups:**
- No `.openapi.ts` and no catalog/per-001 path entries: story puts OpenAPI in ADM-015. Per-IP limit relies on the global limiter only.
- Implementation was written before I watched the tests fail (one initial run had only a test-comparison bug).
- A suspended person's admin token still works until expiry (the middleware re-checks only the administrator, as specified).
<!-- end ADM-006 -->
