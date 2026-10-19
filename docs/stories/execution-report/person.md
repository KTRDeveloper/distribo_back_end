# Execution report: person

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

<!-- begin PER-010 -->
## PER-010 — Profile photo key on the person

- Filed: 2026-10-19 09:31 UTC
- Status: **done**: avatar_key column, unique index, 2 CHECKs; 6 pre-existing failures unrelated (tasks.accountId rename)
- Risk: high · story: [PER-010-profile-photo-key-on-the-person.md](../modules/person/PER-010-profile-photo-key-on-the-person.md)
- Agent: 37,017 tokens, 19 tool uses, 9 min 24 s

### Agent report

**Summary:** Added `people.avatar_key` (nullable, unique) with guest and anonymized CHECKs in one transaction migration, plus the schema field and comments.

**Decisions:**
- Migration timestamp 20261011010000 (after dev_migration_1); CHECK names people_guest_avatar_check and people_anonymized_avatar_check.
- Unique index named people_avatar_key_key, matching Prisma's default so no schema drift.

**Evidence:** story tests 6/6 (avatar file); person-table + person-checks run too; full suite 3155/3163, failing: person-table (tasks.accountId), privacy/anonymize x6 (column "accountId" does not exist); typecheck clean; lint 0 errors, 133 warnings (pre-existing kind)
- quality-gates test passed on rerun (it failed once only from a lint error I then fixed).

**Follow-ups:**
- The 7 failures above predate this story: migration 20261010034352_dev_migration_1 renamed tasks.accountId to account_id, but person-table.test.ts and the anonymize code/tests still use "accountId". Needs a human or its own story.
- Per the story, anonymizing a person with a photo now fails on the CHECK until the privacy change story ships.
<!-- end PER-010 -->
