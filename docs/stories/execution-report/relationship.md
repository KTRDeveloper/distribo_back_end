# Execution report: relationship

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

### Run 2026-10-04 04:48 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| REL-002 Party and pair rules in the database | blocked | - | Migration done, party-rules tests green; REL-001 test relationship-table.test.ts 'rejects an unknown merged_into_id with 23503 and accepts an existing one' now fails (merged_into_id set with deleted_at null gives 23514 before the FK check; its second insert also has no customer and no customer_label). Story lists no test to update: may that test be updated (add deleted_at and a label)? |
| REL-003 Credit limit journal table | todo | - |  |
| REL-004 Credit limit rules and journal trigger | todo | - |  |
| REL-005 Visibility predicate and party projections | todo | - |  |
| REL-006 Every new organization gets its first counter | todo | - |  |
| REL-007 Seller adds a customer by phone number | todo | - |  |
| REL-008 Seller lists the customers | todo | - |  |
| REL-009 Seller opens one customer | todo | - |  |
| REL-010 Seller edits the supplier-side fields | todo | - |  |
| REL-011 Manager adds a counter | todo | - |  |
| REL-012 Owner or manager sets a credit limit | todo | - |  |
| REL-013 Owner reads the credit limit history | todo | - |  |
| REL-014 Reassignment journal table | todo | - |  |
| REL-015 Manager ends and reopens a relationship as supplier | todo | - |  |
| REL-016 Customer lists their suppliers | todo | - |  |
| REL-017 Customer names, ends and reopens a supplier | todo | - |  |
| REL-018 Organization lists and names its suppliers | todo | - |  |
| REL-019 Organization ends and reopens a supplier | todo | - |  |
| REL-020 Customer invites a supplier by phone number | todo | - |  |
| REL-021 Invited supplier accepts or declines | todo | - |  |
| REL-022 Newly registered person sees what is attached to their number | todo | - |  |
| REL-023 Customer contests a relationship ("this is not me") | todo | - |  |
| REL-024 Owner or manager corrects a customer's number | todo | - |  |
| REL-025 Merge a duplicate customer record | todo | - |  |

Also in this run: admin, catalog, order, finance, delivery.

- Stopped after REL-002: blocked, a REL-001 test (`relationship-table.test.ts` › "rejects an unknown merged_into_id with 23503 and accepts an existing one") conflicts with the new CHECKs and the story does not list it under "Tests to update".
- Not reached: REL-003 to DLV-009 (98 stories), because the run stopped on the block; no `--keep-going`.
- Nothing unexpected: the agent report and the notification figures both came in.
- REL-002's migration, test file and schema.prisma comment are left uncommitted in the working tree, waiting for the human decision.
- Next: decide whether that REL-001 test may be updated (amend REL-002's "Tests to update"), then `/implement-stories REL-002` and `/implement-stories next:100`.

### Run 2026-10-04 04:23 UTC: `/implement-stories next:1`

| story | status | commit | note |
|---|---|---|---|
| REL-001 Relationships table | done | 09564ab | customer_relationships table, migration, 14 tests green |

- Completed: the plan held only REL-001; no story was skipped.
- Next: `/implement-stories next:1`, which selects REL-002 (risk: high, Party and pair rules in the database).

<!-- begin REL-001 -->
## REL-001 — Relationships table

- Filed: 2026-10-04 04:22 UTC
- Status: **done**: customer_relationships table, migration, 14 tests green
- Risk: medium · story: [REL-001-relationships-table.md](../modules/relationship/REL-001-relationships-table.md)
- Agent: 51,491 tokens, 14 tool uses, 5 min 43 s

### Agent report

**Summary:** Added the `customer_relationships` table with a migration, the Prisma model and enums, and an integration test file. REL-001 is set to done.

**Decisions:**
- Author trigger: I made it a deferred `CONSTRAINT TRIGGER` on INSERT/UPDATE calling `require_registered_person('created_by_id','credit_limit_set_by_id')`. This matches the `notifications` precedent, and the 23514 still surfaces on an autocommit insert.
- Foreign keys: all are `ON DELETE RESTRICT ON UPDATE CASCADE`, as in `collaborations`.
- Indexes: one plain index per party column (`supplier_organization_id`, `supplier_person_id`, `customer_person_id`, `customer_organization_id`). They are not partial, because the pair and uniqueness rules belong to REL-002.
- Prisma enum names: `RelationshipStatus` and `RelationshipParty`. I avoided `CustomerRelationshipStatus` for brevity.
- Extra columns: `server_updated_at` and `deleted_at` are on the table as C-35 requires, although the story's field list omits them.
- Prisma relations: I named each relation (for example `RelationshipCreatedBy`) and added back-relation fields on `Person` and `Organization`. Several FKs point at the same models, so Prisma needs the names.
- Schema comment: I wrote the comment above the model, as CLAUDE.md requires. It covers the registered-author rule and `server_updated_at`.

**Tests added beyond the story:**
- `tests/integration/relationship/relationship-table.test.ts` › "moves server_updated_at forward on update": it guards C-35, "set by the server on every write". Red, then green with the file.
- `tests/integration/relationship/relationship-table.test.ts` › "has an index on each party column": it guards the Context requirement of an index per party column. Red, then green with the file.
- `tests/integration/relationship/relationship-table.test.ts` › "rejects credit_limit_set_by_id of a guest with 23514" and "accepts credit_limit_set_by_id of a registered person": they guard the second trigger argument, from the Context. Red, then green.
- `tests/integration/relationship/relationship-table.test.ts` › "rejects an unknown merged_into_id with 23503 and accepts an existing one": it guards the self-referencing FK in `CustomerRelationship:fk`. Red, then green.
- `tests/integration/relationship/relationship-table.test.ts` › "rejects a null status and a null balance with 23502": it guards `CustomerRelationship:required`. Red, then green.
- `tests/integration/relationship/relationship-table.test.ts` › "rejects an unknown customer person with 23503": it guards the FK on `customer_person_id`. Red, then green.
- All 14 tests in the file failed before the migration existed. I moved the migration aside to watch them fail, then restored it and all passed.

**Other additions not in the story:**
- None.

**Files changed:**
- `/home/rkonan/Bureau/RodrigueKONAN/SAAS/Distribo/back_end/prisma/schema.prisma`
- `/home/rkonan/Bureau/RodrigueKONAN/SAAS/Distribo/back_end/prisma/migrations/20261004130000_rel_001_relationships/migration.sql`
- `/home/rkonan/Bureau/RodrigueKONAN/SAAS/Distribo/back_end/tests/integration/relationship/relationship-table.test.ts`

**Evidence:**
- Story test file: Test Files 1 passed (1), Tests 14 passed (14).
- Full suite: Test Files 93 passed (93), Tests 980 passed (980).
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors, 40 warnings (`security/detect-non-literal-fs-filename`).
- `prisma migrate diff` against the test DB showed only the existing `tasks` `accountId` drift, nothing for `customer_relationships`.

**Follow-ups:**
- `tasks.account_id` drift: the schema and migrations disagree on that column, which is outside this story. I did not investigate it.
- Prisma enum names: `RelationshipStatus` and `RelationshipParty` are my choice; REL-002 and REL-004 should reuse them.
<!-- end REL-001 -->

<!-- begin REL-002 -->
## REL-002 — Party and pair rules in the database

- Filed: 2026-10-04 04:48 UTC
- Status: **blocked**: Migration done, party-rules tests green; REL-001 test relationship-table.test.ts 'rejects an unknown merged_into_id with 23503 and accepts an existing one' now fails (merged_into_id set with deleted_at null gives 23514 before the FK check; its second insert also has no customer and no customer_label). Story lists no test to update: may that test be updated (add deleted_at and a label)?
- Risk: high · story: [REL-002-party-and-pair-rules-in-the-database.md](../modules/relationship/REL-002-party-and-pair-rules-in-the-database.md)
- Agent: 57,504 tokens, 16 tool uses, 6 min 42 s

### Agent report

**Summary:** The REL-002 migration and `party-rules.test.ts` are done and green, but I set the story to blocked. The new `merged_into_id` CHECK breaks one REL-001 test that the story does not list under "Tests to update". I did not touch that test.

**Question for a human:** may `tests/integration/relationship/relationship-table.test.ts` › "rejects an unknown merged_into_id with 23503 and accepts an existing one" be updated? It has two conflicts with the new rules:
1. It inserts `merged_into_id = UNKNOWN_ID` with `deleted_at` null. The CHECK "merged requires deleted" raises 23514, because PostgreSQL runs CHECKs before the FK, so the test never sees 23503.
2. Its second insert (`customerPersonId: null`, merged into REL_ID) has no `customer_label` and no `deleted_at`, so it fails the counter-label rule and the merge rule.
The fix would be to add `deleted_at` and a `customer_label` to those inserts. The AC-4 requirement (23514 for merged without deleted) cannot hold together with that test as written.

**Decisions:**
- "Empty" `customer_label` rejects NULL, '' and whitespace-only: `COALESCE(length(btrim(customer_label)),0) > 0`. AC-1 says "empty" and a bare `length()` CHECK would pass on NULL.
- A counter means no customer person and no customer organization. The label is required only then.
- The organization-differs rule is NULL-safe (`a IS NULL OR b IS NULL OR a <> b`), so a person-to-person row is not rejected.
- The four unique indexes are partial `WHERE deleted_at IS NULL AND merged_into_id IS NULL`. NULL customer ids never collide, which is why two counters are accepted (AC-3).
- I extended the `schema.prisma` comment above `CustomerRelationship` in plain language, as CLAUDE.md requires. It now lists the party, pair, merged, PENDING and ENDED rules and says to catch 23505, since Prisma cannot express the partial indexes.

**Tests added beyond the story:**
- `tests/integration/relationship/party-rules.test.ts` › "enforces the rules on update as well as insert": setting `status = 'ENDED'` without `ended_by_party` gives 23514. The expected result comes from AC-4 and C-09; passed at once once the migration existed.
- `tests/integration/relationship/party-rules.test.ts` › "refuses reviving a deleted duplicate while a live row exists with 23505": setting `deleted_at` back to NULL on a duplicate cannot create a second live row. It comes from C-07 and AB-1. It was red before the migration and green after.
- `tests/integration/relationship/party-rules.test.ts` › "lets the same customer have a live row with two different suppliers": the pair rule is not too broad. It comes from C-07; it was red before the migration (the whole file was red because the story's insert tests failed).
- `tests/integration/relationship/party-rules.test.ts` › "rejects ENDED with a supplier person with 23514": PENDING-if-and-only-if-supplier-person also forbids ENDED for a supplier person. It comes from C-08.
- `tests/integration/relationship/party-rules.test.ts` › the pair rule runs for each of the 4 column combinations (live, deleted, merged), going beyond the AC-2 examples, which name only one combination. It comes from C-07.

**Other additions not in the story:**
- Fixture UUID prefix `0199c005-` and phones `+22507000050xx` in the new test file, so they do not collide with REL-001's fixtures.
- Recovery on the local test DB (docker `distribo-node-ts-test-db`, port 5434): my first red run left rows in `customer_relationships`. Those rows made the unique-index step fail, and Prisma does not run the migration in one transaction, so the CHECKs were applied but the migration was recorded as failed. I truncated the table, dropped the CHECK constraints and ran `prisma migrate resolve --rolled-back`. `prisma migrate reset` was refused by Prisma in an agent context, and I did not override that.

**Files changed:**
- `/home/rkonan/Bureau/RodrigueKONAN/SAAS/Distribo/back_end/prisma/migrations/20261004140000_rel_002_party_rules/migration.sql`
- `/home/rkonan/Bureau/RodrigueKONAN/SAAS/Distribo/back_end/tests/integration/relationship/party-rules.test.ts`
- `/home/rkonan/Bureau/RodrigueKONAN/SAAS/Distribo/back_end/prisma/schema.prisma` (comment only)

**Evidence:**
- `npx vitest run tests/integration/relationship/party-rules.test.ts`: Test Files 1 passed (1), Tests 33 passed (33).
- Full suite `npm test`: Test Files 1 failed | 93 passed (94); Tests 1 failed | 1012 passed (1013). The one failure is `relationship-table.test.ts` > "rejects an unknown merged_into_id with 23503 and accepts an existing one" (received 23514, expected 23503).
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors, 41 warnings. The one I read was a `security/detect-non-literal-fs-filename` warning; I did not check whether the others were present before my change.
- `npx prisma validate`: valid.

**Follow-ups:**
- A human should decide the question above. Once the REL-001 test is updated, REL-002 can be set to done. No other code change is expected.
- Later stories that insert relationships must give a counter a `customer_label`, give a merged row a `deleted_at`, and map 23505 to a 409 conflict.
<!-- end REL-002 -->
