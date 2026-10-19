# Execution report: foundation

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

### Run 2026-10-19 09:10 UTC: `/implement-stories FND-013..FND-014`

| story | status | commit | note |
|---|---|---|---|
| FND-013 Image keys and public image addresses | done | 28b87df | 23 story tests pass; full suite 7 pre-existing failures (person-table, privacy/anonymize), same without this change |
| FND-014 Plan grid and business payment codes | done | 10a9918 | 29 story tests pass; 7 unrelated DB-state failures in person-table and anonymize tests (tasks table absent in test DB) |

- Run completed: both stories done, no skips, no stash.
- Full suite shows 7 failures (person-table 1, privacy/anonymize 6) on both stories, also on the baseline without the changes. FND-014's agent says the test DB lacks the `tasks` table (stale vs migrations): reset it with `npm run test:db:up` and rerun those two files.
- The IDE diagnostics on FND-013 files were stale; `npm run typecheck` was clean.
- Next command: `/implement-stories next:5`, after resetting the test database.

<!-- begin FND-013 -->
## FND-013 — Image keys and public image addresses

- Filed: 2026-10-19 09:02 UTC
- Status: **done**: 23 story tests pass; full suite 7 pre-existing failures (person-table, privacy/anonymize), same without this change
- Risk: medium · story: [FND-013-image-keys-and-public-image-addresses.md](../modules/foundation/FND-013-image-keys-and-public-image-addresses.md)
- Agent: 35,046 tokens, 23 tool uses, 15 min 12 s

### Agent report

**Summary:** Added `src/lib/image-keys.ts`, the required `IMAGE_PUBLIC_BASE_URL` variable (env.ts, .env.example, tests/setup.ts); story tests green.

**Decisions:**
- Base-address rule: zod `url()` plus refinements (http/https prefix, no trailing `/`, no `?` or `#`, max 2048): the story gives the rules, not the mechanism.
- AC-5 test mocks `dotenv` so a developer's `.env` cannot fill in the "missing" case.
- `buildImageUrl` also validates the key (RangeError), so AB-1 holds for both helpers.

**Tests added beyond the story:**
- `tests/unit/lib/image-keys.test.ts` › rejects a trailing newline: a non-canonical key must not pass the schema (AC-3 "only canonical keys"); passed at once
- `tests/unit/lib/image-keys.test.ts` › rejects a fragment, and accepts a valid base address (AC-5 rule "no fragment"); the valid case passed at once

**Other additions:**
- Started the test DB with `npm run test:db:up`: it was down.

**Evidence:** story tests 23/23; full suite 3121/3128, failing: person-table (1), privacy/anonymize (6), also failing on the stashed baseline; typecheck clean; lint 0 errors, 130 warnings (existing)

**Follow-ups:**
- The 7 failing tests predate this story (likely the data-model v16 update); a human should look at them.
- One earlier full run showed 9 failures in 4 files; two later runs showed only the 7 above (flaky cause not identified).
<!-- end FND-013 -->

<!-- begin FND-014 -->
## FND-014 — Plan grid and business payment codes

- Filed: 2026-10-19 09:10 UTC
- Status: **done**: 29 story tests pass; 7 unrelated DB-state failures in person-table and anonymize tests (tasks table absent in test DB)
- Risk: medium · story: [FND-014-plan-grid-and-business-payment-codes.md](../modules/foundation/FND-014-plan-grid-and-business-payment-codes.md)
- Agent: 26,271 tokens, 14 tool uses, 8 min 25 s

### Agent report

**Summary:** Added the plan table, price grid and payment code generator with their unit tests; story tests green.

**Decisions:**
- Price grid stored as nested `Map`s: avoids object-injection lint warnings and makes "constructor"/"__proto__" plans miss, with no lint rule disabled.

**Tests added beyond the story:**
- `tests/unit/shared/plans.test.ts` › no price outside the grid: also covers -1, 1.5, NaN, "constructor", "__proto__", string "3" (AB-1, AC-3); passed at once
- `tests/unit/shared/plans.test.ts` › lists the four pack lengths: guards `PACK_MONTHS` (Implementation types); passed at once

**Evidence:** story tests 29/29; full suite 3150/3157, failing: person-table "uses uuid..." (1) and privacy/anonymize AC-1,2,3,5,6,AB-2 (6), all DB-state failures unrelated to this story (the test DB has no `tasks` table; they fail alone too); typecheck clean; lint 0 errors, 133 warnings (none from the new files)

**Follow-ups:**
- Test database looks stale versus migrations (missing `tasks."accountId"`): reset it (`npm run test:db:up`) and rerun those two files.
<!-- end FND-014 -->
