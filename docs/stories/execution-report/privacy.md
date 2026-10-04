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
