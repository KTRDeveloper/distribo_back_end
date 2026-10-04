# Execution report: privacy

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

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
