# Execution report: privacy

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

### Run 2026-10-26 10:39 UTC: `/implement-stories next:10`

| story | status | commit | note |
|---|---|---|---|
| PRIV-004 Account deletion also clears and removes the profile photo | done | 358d91d | Avatar key cleared in the anonymization transaction, file deleted after commit |
| PRIV-005 The purge deletes failed and expired payment requests after 90 days | done | f57d104 | purge deletes FAILED/EXPIRED payments after 90 days, cited rows kept |

Also in this run: sync, catalog, order.

- Run completed: all 7 stories done, none skipped, no stash, baseline 0 failing.
- CAT-041: the subagent hit its 40-turn limit with partial changes; resumed with SendMessage (same agent), then it ended done. Figures filed are the cumulative ones from the second notification.
- SYNC-044: contested_at sent as epoch ms, not the "ISO timestamp" the story says (SYNC-003 / toEpoch); story wording may need amending.
- ORD-034, CAT-043: tests not listed under "Tests to update" were edited because the Prisma client rejects the dropped columns; listed in their reports.
- Flaky test seen once: tests/integration/images/image-copy.test.ts "shared file" (random UUID key vs /20\d{2}/); green on rerun.
- Next command: node .claude/skills/implement-stories/scripts/select.mjs next:10 (then /implement-stories next:10).

### Run 2026-10-05 05:56 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| PRIV-003 Daily purge of expired data | done | 77135a0 | purge service, job and tests; archives pointed to by a journal entry are kept |

Also in this run: sync.

- Run completed: all 4 PLAN stories done; none skipped, no stash.
- SYNC-019: the subagent hit its 40-turn limit while its own background work ran; the first notification was interim, the hand-back came later; figures filed from the final notification.
- PRIV-003 open question for a human: archives referenced by a REPLAY_SYNC journal entry are kept past 90 days (foreign key forbids deleting them); confirm the rule.
- Next: `select.mjs next:100` gives PLAN none; no todo story is ready.

### Run 2026-10-04 18:01 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| PRIV-001 Person checks whether they can delete their account | done | f9f27e6 | GET /users/me/deletion-check implemented; suite 2207 green |
| PRIV-002 Person deletes their account by anonymization | done | 34fb40a | DELETE /users/me anonymizes in one transaction; Task table column mismatch worked around with raw SQL |

Not run: PRIV-003.
Also in this run: relationship, catalog, order, finance, delivery, sync.

- Completed: every PLAN line was run or skipped; the run did not stop.
- Skipped, a dependency not done (via ORD-006): ORD-009 to ORD-017, ORD-019 to ORD-021, FIN-002 to FIN-020, SYNC-007.
- Skipped, a dependency not done (via DLV-002): DLV-003 to DLV-012.
- Skipped, a dependency not done (via SYNC-002, or the chains above): SYNC-009 to SYNC-023, PRIV-003.
- Stashes: "ORD-006 blocked: partial changes", "DLV-002 blocked: partial changes", "SYNC-002 blocked: partial changes".
- All three blocks have one cause: the story's new database rule breaks existing tests (ORD-006: 48 in 6 files; DLV-002: 4 in delivery-table; SYNC-002: 1 in admin-action-table), and none lists them under "Tests to update".
- Unexpected: REL-012, ORD-003 and SYNC-006 hand-backs lacked the final `<ID> <status>` line; STATUS.md said done, as their text did. No missing report file, every figure came from its notification.
- Next: add "Tests to update" to ORD-006, DLV-002 and SYNC-002, then `/implement-stories ORD-006,DLV-002,SYNC-002`, then `/implement-stories next:100`.

<!-- begin PRIV-001 -->
## PRIV-001 — Person checks whether they can delete their account

- Filed: 2026-10-04 17:48 UTC
- Status: **done**: GET /users/me/deletion-check implemented; suite 2207 green
- Risk: medium · story: [PRIV-001-person-checks-whether-they-can-delete-their.md](../modules/privacy/PRIV-001-person-checks-whether-they-can-delete-their.md)
- Agent: 47,505 tokens, 20 tool uses, 6 min 44 s

### Agent report

**Summary:** Added GET /api/v1/users/me/deletion-check (privacy module) returning can_delete and blockers.

**Decisions:**
- Blocker label for OWNS_ORGANIZATION: the organization name only (story: "label: its name"); the "Transférez ou fermez d'abord" message is not in the response shape, so it is not returned.
- Supplier label for POSITIVE_BALANCE: supplier organization name, else supplier person full name, else supplier_label, else empty string (supplier can be a person).
- Ignored soft-deleted relationships, collaborations and organizations (deleted_at set); only an ACTIVE OWNER membership counts.
- Route mounted as /users/me/deletion-check before /users in app.ts; privacy.openapi.ts added.

**Tests added beyond the story:**
- `tests/integration/privacy/deletion-check.test.ts` › owning a SUSPENDED organization blocks: CM-02 and the story's Context (ACTIVE or SUSPENDED block); written before the code, failed first

**Other additions:**
- `src/modules/privacy/privacy.openapi.ts`, import in `src/app.ts` and `scripts/generate-openapi.ts`, path in `tests/integration/api-docs/catalog.test.ts`: a route must be registered, and the generate-script test compares the live and generated path sets.
- `openapi/openapi.json` regenerated (git-ignored).

**Evidence:** story tests 9/9; full suite 2207/2207, failing: none; typecheck clean; lint 0 errors, 62 warnings (existing)

**Follow-ups:**
- per-001.test.ts has no per-route list to extend, so it was not touched.
<!-- end PRIV-001 -->

<!-- begin PRIV-002 -->
## PRIV-002 — Person deletes their account by anonymization

- Filed: 2026-10-04 18:01 UTC
- Status: **done**: DELETE /users/me anonymizes in one transaction; Task table column mismatch worked around with raw SQL
- Risk: high · story: [PRIV-002-person-deletes-their-account-by-anonymization.md](../modules/privacy/PRIV-002-person-deletes-their-account-by-anonymization.md)
- Agent: 82,461 tokens, 33 tool uses, 12 min 34 s

### Agent report

**Summary:** Added DELETE /api/v1/users/me (password, 204) and anonymizePerson/deleteAccount; all story tests pass.

**Decisions:**
- Session revocation reason: reused `LOGOUT_ALL` (no ACCOUNT_DELETED value; a new enum value would need a migration).
- 409 blockers: the global handler drops extra fields, so the route builds the 409 body itself (standard shape plus `blockers`).
- Password attempts: used `checkAndConsume` on the same key `login:fail:<phone>` as login (auth's takeAttempt is not exported); reset on success; 429 LOGIN_LOCKED when locked.
- Order: password is checked before blockers, so a wrong password never reveals blockers (AB-1).
- One-time codes: deleted by person id and by target (old phone, email), so codes issued with a null person id also go.
- Also bumped `scope_version` (CM-03, as releasing a number does elsewhere) and set revoked sessions' devices' push_token null.
- SUSPENDED persons may delete their account (story is silent; only ANONYMIZED is refused).

**Tests added beyond the story:**
- `tests/integration/privacy/anonymize.test.ts` › wrong passwords count with the login counter...: 5 failures then 429 LOGIN_LOCKED, nothing changes (Context: login counter; v5.0.0-6.3.1)
- `tests/integration/privacy/anonymize.test.ts` › requires authentication: no token gives 401 (deny by default)

**Other additions:**
- `deleteAccountBodySchema`, `deletionBlockedResponseSchema` and the OpenAPI entry for DELETE /users/me; `accountRoutes` mounted at /users/me with auth per route (does not touch other /users/me paths).
- Tasks are deleted with raw parameterized SQL: schema.prisma maps Task.accountId to `account_id` but the table column is `"accountId"` (gap since PER-002), so `prisma.task` fails.

**Evidence:** story tests 13/13; full suite 2220/2220, failing: none; typecheck clean; lint 0 errors, 62 warnings (all pre-existing security/detect-non-literal-fs-filename)

**Follow-ups:**
- Task model/DB column mismatch (`account_id` vs `"accountId"`) breaks the whole tasks module; needs its own fix.
- An OWNER of a CLOSED organization: revoking their ACTIVE OWNER collaboration violates the "exactly one ACTIVE OWNER" deferred trigger, so that deletion fails with 500 and rolls back (AC-6 holds). The story says revoke every collaboration; needs a decision (e.g. skip owners of closed organizations).
- Blockers are checked before the transaction, not inside it: a balance changing in between is not locked.
<!-- end PRIV-002 -->

<!-- begin PRIV-003 -->
## PRIV-003 — Daily purge of expired data

- Filed: 2026-10-05 05:56 UTC
- Status: **done**: purge service, job and tests; archives pointed to by a journal entry are kept
- Risk: high · story: [PRIV-003-daily-purge-of-expired-data.md](../modules/privacy/PRIV-003-daily-purge-of-expired-data.md)
- Agent: 59,217 tokens, 24 tool uses, 10 min 24 s

### Agent report

**Summary:** Added `purge(now)`, the `job:purge` script and tests; all five tables purged in batches of 1000 under the migration account.

**Decisions:**
- Archives referenced by an admin_actions row (REPLAY_SYNC): kept, not deleted, because the foreign key is RESTRICT and the journal is immutable; deleting would make the whole purge fail every day.
- `purge()` builds its own Prisma client from `MIGRATION_DATABASE_URL` and throws without it (no fallback to `DATABASE_URL`); the job maps any error to exit 1.
- Cutoffs computed in SQL (`interval '24 months'`) so months follow the calendar; deletes use `ctid` batches so the composite-key idempotency table works.
- Log is `purge_done` with `counts` (per table) and `total`, nothing else.

**Tests added beyond the story:**
- `tests/integration/privacy/purge.test.ts` › purge() refuses to run without MIGRATION_DATABASE_URL (AC-3, fail closed)
- same file › job exits 0 and deletes when the variable is set (AC-3 positive path)
- same file › archive pointed to by a journal entry is kept and the rest is purged (immutable journal, FK; my decision above)
- All passed at once only because the implementation was written in the same step; none was watched failing separately.

**Evidence:** story tests 9/9; full suite 3105/3105, failing: none; typecheck clean; lint 0 errors, 130 existing warnings

**Follow-ups:**
- Confirm the "keep archives referenced by a REPLAY_SYNC journal entry" rule; those archives then outlive 90 days.
- Scheduling stays out of scope (Q-010).
<!-- end PRIV-003 -->

<!-- begin PRIV-004 -->
## PRIV-004 — Account deletion also clears and removes the profile photo

- Filed: 2026-10-26 10:36 UTC
- Status: **done**: Avatar key cleared in the anonymization transaction, file deleted after commit
- Risk: high · story: [PRIV-004-account-deletion-also-clears-and-removes-the.md](../modules/privacy/PRIV-004-account-deletion-also-clears-and-removes-the.md)
- Agent: 40,938 tokens, 13 tool uses, 2 min 25 s

### Agent report

**Summary:** `anonymizePerson` now clears the avatar key in its transaction and deletes the file after commit.

**Decisions:**
- Calls `setAvatarKey(personId, null, tx)` before `anonymizeRows`: the PER-010 CHECK would refuse the anonymized row otherwise. An absent person gives 404 from `setAvatarKey`, the same code as before.

**Evidence:** story tests 19/19 (6 new + 13 existing anonymize); full suite 5397/5397, failing: none, 0 known; typecheck clean; lint 0 errors, 260 warnings (existing)
<!-- end PRIV-004 -->

<!-- begin PRIV-005 -->
## PRIV-005 — The purge deletes failed and expired payment requests after 90 days

- Filed: 2026-10-26 10:39 UTC
- Status: **done**: purge deletes FAILED/EXPIRED payments after 90 days, cited rows kept
- Risk: high · story: [PRIV-005-the-purge-deletes-failed-and-expired-payment.md](../modules/privacy/PRIV-005-the-purge-deletes-failed-and-expired-payment.md)
- Agent: 39,778 tokens, 14 tool uses, 2 min 43 s

### Agent report

**Summary:** Added the `subscription_payments` deleter to the purge (FAILED/EXPIRED, older than 90 days, not cited by a receipt, period or event) and the count key.

**Tests added beyond the story:**
- `tests/integration/privacy/purge-payments.test.ts` › AC-2 receipt cites: a FAILED payment cited by a receipt stays (AC-2, CM-44); passed at once after the deleter existed (it was covered by the same NOT EXISTS clause)

**Evidence:** story tests 14/14 (purge-payments + purge); full suite 5402/5402, failing: none, 0 known; typecheck clean; lint 0 errors, 260 warnings
<!-- end PRIV-005 -->
