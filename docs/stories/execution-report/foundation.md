# Execution report: foundation

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

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
