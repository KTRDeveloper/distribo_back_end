# Execution report: sync

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

<!-- begin SYNC-001 -->
## SYNC-001 — Sync types, adapter registry and viewer

- Filed: 2026-10-04 17:01 UTC
- Status: **done**: types, registry, viewer; 7 tests pass
- Risk: medium · story: [SYNC-001-sync-types-adapter-registry-and-viewer.md](../modules/sync/SYNC-001-sync-types-adapter-registry-and-viewer.md)
- Agent: 34,567 tokens, 18 tool uses, 6 min 25 s

### Agent report

**Summary:** Added sync types, adapter registry and viewer builder; all tests green.

**Decisions:**
- Viewer shape: followed the Context (memberships carry `status: 'ACTIVE'`, `isOnline: false`), a superset of the Implementation type; role typed as Prisma `CollaborationRole`.
- `Row`, `TableChange`, `PushContext`: the story names them without defining them; chose minimal shapes (`TableChange` = table + created/updated/deleted, `PushContext` = viewer + tx) for later SYNC stories to refine.
- getAdapter also throws SYNC_UNKNOWN_TABLE for a valid table with no adapter registered (fail closed).
- Registry and unknown-table tests ("unit" in the story) sit in the one integration file the story lists; they use `vi.resetModules` for a fresh registry.

**Tests added beyond the story:**
- `tests/integration/sync/registry-viewer.test.ts` › answers 404 for an unknown person: fail closed (CONVENTIONS Errors)
- same › returns no membership for a person with none: empty case
- same › known table with no adapter throws; registering a name outside the 14 tables throws; `__proto__` lookup rejected: registry fail closed

**Other additions:**
- `src/modules/sync/sync.repository.ts`: the only prisma caller, since CONVENTIONS reserve prisma calls to repositories.

**Evidence:** story tests 7/7; full suite 2139/2139 (first run had 1 failure, quality-gates lint, caused by 4 lint errors in my test, fixed and re-run green); typecheck clean; lint 0 errors, 60 warnings (pre-existing)

**Follow-ups:**
- buildViewer throws 404 NOT_FOUND for an unknown person; the story does not specify it.
<!-- end SYNC-001 -->

<!-- begin SYNC-002 -->
## SYNC-002 — Sync archive table

- Filed: 2026-10-04 17:05 UTC
- Status: **blocked**: FK admin_actions.sync_archive_id breaks existing admin-action-table.test.ts 'accepts REPLAY_SYNC...' (uses non-existent ARCHIVE_ID); story lists no Tests to update: allow inserting an archive row in that test's setup?
- Risk: high · story: [SYNC-002-sync-archive-table.md](../modules/sync/SYNC-002-sync-archive-table.md)
- Agent: 39,027 tokens, 13 tool uses, 3 min 24 s

### Agent report

**Summary:** Blocked: implementation done and story tests green, but the new FK breaks one existing test the story does not list under "Tests to update".

**Decisions:**
- Migration 20261004320000_sync_002_sync_archives: table, FKs (person, device, admin_actions.sync_archive_id), DESC index, set_server_updated_at trigger, REVOKE UPDATE/DELETE/TRUNCATE; schema.prisma updated with comments.
- Added indexes on sync_archives(device_id) and admin_actions(sync_archive_id) for FK lookups (pattern of ADM-003).

**Tests added beyond the story:**
- `tests/integration/sync/archive-table.test.ts` › accepts a REPLAY_SYNC row pointing to an existing archive: FK allows valid link (AC-4); passed at once
- same file › rejects a missing person or device with 23502, index (person_id, received_at DESC) exists (AC-3, Context)

**Evidence:** story tests 8/8; full suite 2146/2147, failing: admin-action-table.test.ts > "accepts REPLAY_SYNC by a SUPER_ADMIN with a sync_archive_id"; typecheck clean; lint 0 errors, 60 warnings (pre-existing kind)

**Follow-ups:**
- Question: that existing test inserts REPLAY_SYNC with a non-existent ARCHIVE_ID and expects success; AC-4 makes that impossible. Fix needs the test to insert a sync_archives row first (needs person+device). I did not touch it (rule: never modify tests not listed). Allow it, or add "Tests to update" to the story.
- Work left uncommitted in the working tree (migration, schema, new test).
<!-- end SYNC-002 -->

<!-- begin SYNC-003 -->
## SYNC-003 — Pull endpoint and identity tables

- Filed: 2026-10-04 17:14 UTC
- Status: **done**: GET /sync/pull and identity adapters; 19 tests pass; no OpenAPI (SYNC-006)
- Risk: high · story: [SYNC-003-pull-endpoint-and-identity-tables.md](../modules/sync/SYNC-003-pull-endpoint-and-identity-tables.md)
- Agent: 73,423 tokens, 29 tool uses, 8 min 40 s

### Agent report

**Summary:** Added GET /api/v1/sync/pull, the pull service and the organizations, collaborations and people adapters; done.

**Decisions:**
- OpenAPI and catalog.test/per-001 route lists: not touched; the story's Implementation and Out of scope leave them to SYNC-006 (its Adds creates sync.openapi.ts), though "Adds" here names the file.
- `amount_held`: key absent (not null) on rows the viewer may not see; a phone must not read a hidden value as 0.
- Collaborations has no `created_at`: `invited_at` decides created vs updated.
- Collaborations rows sent for every non-deleted status (REVOKED, INVITED too), so a phone sees a status change; literal reading of "rows of those organizations".
- Organization row sent without `deleted_at` (tombstones go in `deleted`), with `server_updated_at`.
- people: also sent when the collaboration or relationship that makes them visible was created after the last pull; no dates in the row. Relationship visibility uses `visibleRelationsWhere`.
- Identity adapters' `push` returns `forbidden` (`SYNC_TABLE_READ_ONLY`) for every line until a push story defines it (fail closed).
- Pull reads run in one REPEATABLE READ transaction (`withPullSnapshot` in sync.repository.ts); `timestamp` read before it.
- Empty or absent `last_pulled_at` = first pull; `0` is a real epoch; at most 15 digits; future time refused.
- New shared helper `sync.changes.ts` (classifyChanges) for the next adapters.

**Tests added beyond the story:**
- `pull-identity.test.ts` › deleted collaboration listed by id; person who just became visible is sent; OWNER sees all amount_held; no-membership person gets only themselves; revoked member loses the organization; unknown query param / repeated param / 1.5 / 1e3 / 16 digits refused; 401 without token (AC-2, AC-3, AC-5, v5.0.0-8.2.2, C-35); all passed at once except the people-link case, which drove the refinement.

**Other additions:**
- `withPullSnapshot` in `sync.repository.ts` and `sync.changes.ts`: keep prisma in the repository and share the created/updated/deleted split.

**Evidence:** story tests 19/19; full suite 2158/2158, failing: none; typecheck clean; lint 0 errors, 62 warnings (existing)

**Follow-ups:**
- Tests were written after the code (one red seen on the people case), not strictly red-first.
- A member who leaves an organization is not told by `deleted`: its rows just stop appearing (spec has no rule); SYNC-008 resync may need it.
- Revoked or invited team members' names and phones reach sellers; confirm this is wanted (online list is OWNER/MANAGER only).
<!-- end SYNC-003 -->
