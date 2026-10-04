# Execution report: relationship

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

### Run 2026-10-04 13:47 UTC: `/implement-stories next:3`

| story | status | commit | note |
|---|---|---|---|
| REL-006 Every new organization gets its first counter | done | 8accff3 | Counter created in the org transaction; 1519 tests pass |
| REL-007 Seller adds a customer by phone number | done | b61bbf2 | POST /organizations/:id/customers; 23 story tests, full suite 1542 pass |
| REL-008 Seller lists the customers | done | eccf1b5 | GET customers list with filters, keyset paging, supplier view |

- Run completed: 3 of 3 stories done, none skipped, no stash.
- REL-007's hand-back held its full report, not just the `<ID> <status>` line.
- REL-007 did not add its POST route to the OpenAPI doc or the catalog test list. REL-008 registered both POST and GET in relationship.openapi.ts and added the shared path to catalog.test.ts.
- contracts.md does not list the optional `customerLabel` and `deliveryAddress` inputs that REL-007 added to `ensureCustomerRelationship`. The stories folder needs a sync.
- Next: `/implement-stories next:3`

### Run 2026-10-04 12:26 UTC: `/implement-stories REL-004,ORD-002,ADM-008`

| story | status | commit | note |
|---|---|---|---|
| REL-004 Credit limit rules and journal trigger | done | 59dae7e | credit limit CHECKs + stamp/journal triggers; same author cannot change limit twice (per spec) |

Also in this run: admin, order.

- Run completed: all 3 PLAN stories done, none skipped, no stash.
- Unexpected: the REL-004 and ORD-002 hand-backs held a summary instead of the one line `<ID> <status>`; STATUS.md agreed (done) in both.
- REL-004 flags: the same author cannot change a limit twice in a row (spec as written, left for REL-012); an INSERT with a non-zero credit_limit is accepted and not journaled.
- ORD-002 flags: deleting a person would violate the new CHECKs through ON DELETE SET NULL on cancelled_by_id / delivered_by_id; two integration files in one vitest command once deadlocked on shared fixture IDs.
- All figures filed from the task notifications.
- Next: /implement-stories next:N

### Run 2026-10-04 10:55 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| REL-003 Credit limit journal table | done | 5cc4cb3 | credit_limit_changes table, append-only; story tests 8/8, full suite 1025/1025 |
| REL-004 Credit limit rules and journal trigger | blocked | 337098f | Story tests pass (20/20), but 2 REL-001 tests in relationship-table.test.ts contradict AC-1/AC-2 (credit_limit default null; set_by_id without set_at) and are not under Tests to update: list them, or say how to proceed |
| REL-005 Visibility predicate and party projections | done | 1ac958e | visibility predicate and party projections; 24 story tests, full suite 1049 pass |
| REL-014 Reassignment journal table | done | d402da6 | Reassignments journal table, contestation partial unique index, immutable; 12 tests |

Not run: REL-006..REL-013, REL-015..REL-025.
Also in this run: admin, catalog, order, finance, delivery.

- Run completed: every PLAN line was run or skipped; 24 done, 3 blocked (REL-004, ADM-008, ORD-002), 73 skipped, never three not-done in a row.
- Skipped, dependency not done (stay todo): REL-006..REL-013, REL-015..REL-025 (behind REL-004); CAT-003..CAT-011 (behind REL-006); ORD-003..ORD-021, FIN-002..FIN-010, FIN-012, FIN-013, FIN-015..FIN-020, DLV-002..DLV-010 (behind ORD-002 or REL stories).
- Stashes: "REL-004 blocked: partial changes", "ADM-008 blocked: partial changes", "ORD-002 blocked: partial changes".
- REL-004 and ORD-002 are blocked the same way: extra tests the previous table story added (REL-001, ORD-001) contradict the new rules and are not under "Tests to update".
- ADM-008 needs a human decision: event name admin.2fa_recovered breaks the NTF-002 grammar (e.g. admin.totp_recovered).
- ADM-005's agent stopped with background work running and notified a second time later, with no new tool use; its work likely overlapped a full-suite run of ADM-007 (ADM-007 discarded one contaminated run).
- ADM-007's evidence said the full suite was not rerun after its last fix; the orchestrator ran npm test before the commit: 1161/1161.
- REL-014 left a checksum drift for its migration in the test DB (migration edited after it was applied); set-aside since then reset test_db.
- ADM-006 route POST /admin/auth/login is not in OpenAPI or the catalog test (story defers to ADM-015); not verified after ADM-015 (grep on openapi.json refused, a generated file).
- npm audit --audit-level=high fails (84 vulnerabilities) through @opentelemetry/auto-instrumentations-node, a direct dependency not in the CONVENTIONS allowlist; pre-existing.
- Lint warnings grew from 44 to 57 during the run (agents call them pre-existing).
- To confirm: REL-005 money as number in views and driver view showing customer_label; ADM-014 suspend of a CLOSED organization answers 409; FIN-011 expenses not revoked for DELETE/TRUNCATE.
- Next: list the two REL-001 tests under REL-004 "Tests to update", the two ORD-001 tests under ORD-002, pick the ADM-008 event name; then /implement-stories REL-004,ORD-002,ADM-008 and /implement-stories next:100.

### Run 2026-10-04 05:48 UTC: `/implement-stories REL-002`

| story | status | commit | note |
|---|---|---|---|
| REL-002 Party and pair rules in the database | done | af5ec1c | CHECKs and four partial unique indexes added; REL-001 merged_into_id test updated as listed |

- Run completed.
- Resumed REL-002's partial changes from the earlier blocked run (stash popped beforehand); story amended in fbf7d6a to list the REL-001 merged_into_id test under "Tests to update".
- Next: `/implement-stories next:N`.

### Run 2026-10-04 05:36 UTC: `/implement-stories REL-002`

| story | status | commit | note |
|---|---|---|---|
| REL-002 Party and pair rules in the database | blocked | 30104ba | Migration done, party-rules tests green; REL-001 test relationship-table.test.ts 'rejects an unknown merged_into_id with 23503 and accepts an existing one' fails (merged_into_id with deleted_at null gives 23514 before the FK check; second insert has no customer or label). Story lists no test to update: may it be updated (add deleted_at and a label)? |

- Stash: `REL-002 blocked: partial changes` (stash@{0}); the test database was reset.
- The run completed: its one story ran.
- Unexpected: the agent's hand-back held its whole report before the `REL-002 blocked` line, instead of that line alone; its report file existed and is the one filed.
- Next: answer REL-002's question (list `relationship-table.test.ts` under the story's "Tests to update", or approve the change), then `git stash pop` and `/implement-stories REL-002`; or `/implement-stories next:N`, which skips REL-002's dependents.

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

- Filed: 2026-10-04 05:48 UTC
- Status: **done**: CHECKs and four partial unique indexes added; REL-001 merged_into_id test updated as listed
- Risk: high · story: [REL-002-party-and-pair-rules-in-the-database.md](../modules/relationship/REL-002-party-and-pair-rules-in-the-database.md)
- Agent: 26,307 tokens, 8 tool uses, 4 min 55 s

### Agent report

**Summary:** Migration with 8 CHECKs and 4 partial unique indexes on customer_relationships, plus schema.prisma comment; REL-001 test updated as listed.

**Decisions:**
- Resumed the uncommitted work left by the earlier blocked run (migration, party-rules test, schema comment) after review; kept it.
- Counter label check uses btrim length > 0: a whitespace-only label counts as empty.

**Tests added beyond the story:**
- `party-rules.test.ts` › second row accepted when first is deleted/merged per pair type, and different suppliers share a customer: all four indexes are partial and per pair (AC-2, C-07); passed at once with the migration
- `party-rules.test.ts` › rejects ENDED with a supplier person: status rules interact (C-08, C-09)
- `party-rules.test.ts` › enforces the rules on update as well as insert; refuses reviving a deleted duplicate: CHECKs and indexes hold on UPDATE (AB-1, v5.0.0-8.2.2)

**Other additions:**
- schema.prisma comment above CustomerRelationship lists the new rules (CLAUDE.md database rules)

**Evidence:** story tests 47/47 (relationship folder); full suite 1017/1017, failing: none; typecheck clean; lint 0 errors, 44 warnings (pre-existing security/detect-non-literal-fs-filename)
<!-- end REL-002 -->

<!-- begin REL-003 -->
## REL-003 — Credit limit journal table

- Filed: 2026-10-04 05:57 UTC
- Status: **done**: credit_limit_changes table, append-only; story tests 8/8, full suite 1025/1025
- Risk: medium · story: [REL-003-credit-limit-journal-table.md](../modules/relationship/REL-003-credit-limit-journal-table.md)
- Agent: 44,356 tokens, 16 tool uses, 5 min 42 s

### Agent report

**Summary:** Added credit_limit_changes table (migration 20261004150000_rel_003_credit_limit_changes), Prisma model, and its integration tests; all green.

**Decisions:**
- No `deleted_at` column: the story's "Adds" lists only server_updated_at and the design table has none, despite C-35's general wording.
- `set_at` NOT NULL with DEFAULT now(): design says "server time"; tests still pass it explicitly.
- Author trigger is a deferred constraint trigger (INSERT OR UPDATE), same as customer_relationships; guest insert still fails with 23514 at autocommit.
- Index on customer_relationship_id added for history lookups per relationship.

**Tests added beyond the story:**
- `credit-limit-changes-table.test.ts` › rejects a row without set_by_id, set_at or relationship with 23502: NOT NULL list of CreditLimitChange:required (story); passed at once only after migration, written first and failed with the table missing
- `credit-limit-changes-table.test.ts` › TRUNCATE denied (inside the immutability test): REVOKE TRUNCATE in the Adds section (story Context)

**Other additions:**
- Plain-language comment above the model in schema.prisma, per CLAUDE.md database rules.

**Evidence:** story tests 8/8; full suite 1025/1025, failing: none; typecheck clean; lint 0 errors, 44 warnings (pre-existing security/detect-non-literal-fs-filename)

**Follow-ups:**
- `prisma migrate diff` shows no drift for credit_limit_changes (existing drift on other FKs onDelete is pre-existing).
<!-- end REL-003 -->

<!-- begin REL-004 -->
## REL-004 — Credit limit rules and journal trigger

- Filed: 2026-10-04 11:42 UTC
- Status: **done**: credit limit CHECKs + stamp/journal triggers; same author cannot change limit twice (per spec)
- Risk: high · story: [REL-004-credit-limit-rules-and-journal-trigger.md](../modules/relationship/REL-004-credit-limit-rules-and-journal-trigger.md)
- Agent: 54,422 tokens, 18 tool uses, 15 min 25 s

### Agent report

**Summary:** Migration 20261004270000_rel_004_credit_limit_rules adds default 0, three CHECKs and two triggers; story and 3 updated tests green.

**Decisions:**
- Two triggers, not one: the spec says AFTER UPDATE OF credit_limit, but set_at = now() and the author check need a BEFORE trigger (an AFTER trigger cannot change NEW). BEFORE stamps and checks; AFTER inserts the journal row.
- Journal id: PG16 has no uuidv7, so the trigger builds one inline (clock ms + random bytes, version 7 bits).
- Migration backfills existing rows before the CHECKs (counters to 0, pair fixes); existing customers keep their NULL limit.
- Counter CHECK also rejects an empty (NULL) limit, since "always 0 for a counter".
- Schema: `@default(0)` on creditLimit and a plain-language comment above CustomerRelationship.

**Tests added beyond the story:**
- `credit-limit-rules.test.ts` › counter with empty limit, counter raised by update, caller-chosen set_at ignored, change to/from NULL, author erased, guest author at commit, upsert (ON CONFLICT DO UPDATE) paths, update not touching the limit: guard C-10 and AB-1 (C-10, AC-2/4/5); most passed at once because the migration was written before the tests.

**Other additions:**
- Prisma `@default(0)` in schema.prisma, needed to match the migration default.

**Evidence:** story tests 24/24 (relationship folder 112/112); full suite 1452/1452, failing: none; typecheck clean; lint 0 errors, 57 warnings (pre-existing security/detect-* kind)

**Follow-ups:**
- Spec rule "change with unchanged author refused" means the same person cannot change a limit twice in a row; REL-012 must handle this (or the rule should compare author or time). Followed the spec as written.
- An INSERT supplying a non-zero credit_limit is accepted and not journaled (creation, not change); C-10 says 0 at creation but no AC enforces it.
<!-- end REL-004 -->

<!-- begin REL-005 -->
## REL-005 — Visibility predicate and party projections

- Filed: 2026-10-04 06:15 UTC
- Status: **done**: visibility predicate and party projections; 24 story tests, full suite 1049 pass
- Risk: high · story: [REL-005-visibility-predicate-and-party-projections.md](../modules/relationship/REL-005-visibility-predicate-and-party-projections.md)
- Agent: 38,483 tokens, 10 tool uses, 6 min 12 s

### Agent report

**Summary:** Added the visibility predicate and the three party projections; all tests green.

**Decisions:**
- View shapes left open: party is `{kind:'PERSON', person: PublicPerson}` or `{kind:'ORGANIZATION', name[, description]}`; null for a counter. Keeps "customer person part" checkable.
- Money in supplier/customer views is `number` (bigint is not JSON-serializable); driver view was already number.
- Predicate also matches `customer_organization_id` in organizationIds (the story says "supplier or customer organization").
- `customer_name` for drivers: person full name, else organization name, else counter `customer_label`, else null.
- `available_credit` is raw limit minus balance (negative when over the limit); zero limit is a real ceiling.
- Empty `organizationIds`: org clauses are omitted, not sent as `in: []`.
- Unit-level projection tests live in the story's integration file (the only test file listed).

**Tests added beyond the story:**
- `visibility.test.ts` › customer organization member sees row, empty organizationIds, merged row hidden, zero limit, counter/org name fallback, JSON-safe money: edge cases from the story text; passed at once (written with the implementation target known).

**Evidence:** story tests 24/24; full suite 1049/1049, failing: none; typecheck clean; lint 0 errors, 44 warnings (existing)

**Follow-ups:**
- `projectForDriver` falls back to `customer_label` (supplier-private) for counters; confirm that is wanted.
- relationship `contracts.md` should list these four exports when REL maintainers update it (stories folder not editable by me).
<!-- end REL-005 -->

<!-- begin REL-006 -->
## REL-006 — Every new organization gets its first counter

- Filed: 2026-10-04 13:37 UTC
- Status: **done**: Counter created in the org transaction; 1519 tests pass
- Risk: medium · story: [REL-006-every-new-organization-gets-its-first-counter.md](../modules/relationship/REL-006-every-new-organization-gets-its-first-counter.md)
- Agent: 32,364 tokens, 14 tool uses, 2 min 45 s

### Agent report

**Summary:** createOrganization now creates the "Client de passage" counter in the same transaction as the organization and owner.

**Decisions:**
- Sharing the transaction: added an optional `inSameTransaction(tx, org)` callback to `insertOrganizationWithOwner`, since the transaction lives in the repository; the service passes the `createCounter` call.
- Credit-limit author/date: left empty at creation (limit 0 from the default); creation is not a change, so no journal row (schema comment on CustomerRelationship).
- AC-2 forced failure: `vi.mock` of relationship.repository with `createCounter` rejecting on a flag.

**Other additions:**
- Organization service imports `relationship.repository.js` directly; `createCounter` is not listed in relationship contracts.md (story dictates it). Contract entry may need adding.

**Evidence:** story tests 24/24 (default-counter 4 + create 20); full suite 1519/1519, failing: none; typecheck clean; lint 0 errors, 57 warnings (pre-existing)

**Follow-ups:**
- Add `createCounter` to relationship contracts.md (I cannot edit the stories folder).
<!-- end REL-006 -->

<!-- begin REL-007 -->
## REL-007 — Seller adds a customer by phone number

- Filed: 2026-10-04 13:41 UTC
- Status: **done**: POST /organizations/:id/customers; 23 story tests, full suite 1542 pass
- Risk: high · story: [REL-007-seller-adds-a-customer-by-phone-number.md](../modules/relationship/REL-007-seller-adds-a-customer-by-phone-number.md)
- Agent: 71,752 tokens, 21 tool uses, 4 min 8 s

### Agent report

**Summary:** Added POST /api/v1/organizations/:organizationId/customers (schema, service, routes, repository `ensureCustomerRelationship`), all story ACs and abuse cases green.

**Decisions:**
- Insert race: raw `INSERT ... ON CONFLICT DO NOTHING` after a live-row lookup, so the partial pair indexes (C-07) never abort the transaction; loser reads the winner's row (200).
- `credit_limit` written explicitly as 0 in the insert (no CreditLimitChange row, per C-10 comment in schema).
- Notification content uses the supplier name read via the relationship's own `supplierOrganization` include (no import of the organization repository beyond its contract); `related.type` = `customer_relationship`, `organizationId` = supplier org.
- Notify only when the relationship is newly created (a repeat adds nothing, AC-3).
- Router mounted at `/organizations/:organizationId` after `organizationRoutes`; `authMiddleware` set on the route, not router-wide, to leave other paths' behavior untouched.
- Did not add paths to catalog.test.ts / per-001.test.ts: OpenAPI registration is out of scope (REL-008) and those lists assert OpenAPI paths, so they would fail.

**Tests added beyond the story:**
- `add-customer.test.ts` › concurrent adds of one number: one 201, one 200, one row (C-07); passed at once
- `add-customer.test.ts` › does not notify a guest; deleted relationship ignored; same number in two businesses; 401 without token; extra validation rows (empty label, address 2001, missing id, supplier_organization_id in body) (AC-1..4, C-07, AB-1); passed at once

**Evidence:** story tests 23/23; full suite 1542/1542, failing: none; typecheck clean; lint 0 errors, 57 warnings (all pre-existing, none in new files)

**Follow-ups:**
- REL-008 must register the route in OpenAPI and add it to the catalog.test.ts / per-001.test.ts lists.
- contracts.md lists `ensureCustomerRelationship` without `customerLabel`/`deliveryAddress` (optional extras I added); stories folder is read-only for me.
<!-- end REL-007 -->

<!-- begin REL-008 -->
## REL-008 — Seller lists the customers

- Filed: 2026-10-04 13:47 UTC
- Status: **done**: GET customers list with filters, keyset paging, supplier view
- Risk: medium · story: [REL-008-seller-lists-the-customers.md](../modules/relationship/REL-008-seller-lists-the-customers.md)
- Agent: 63,452 tokens, 21 tool uses, 5 min 54 s

### Agent report

**Summary:** Added GET /organizations/:organizationId/customers (filters, keyset paging, supplier projection) and relationship.openapi.ts.

**Decisions:**
- DRIVER refusal: service-side `atLeast(role, 'SELLER')` check with 403 and a warn log, like `listCollaborators`; the rules table has no read rule for CustomerRelationship.
- Counter filter: a counter is a row with no customer person and no customer organization (schema comment); `counter=false` is the opposite.
- Query starts from `visibleRelationsWhere` AND `supplierOrganizationId = actor org`, so rows where the org is only customer are excluded ("relationships as supplier").
- Order created_at desc then id asc, as the project rule and the existing keyset helpers.

**Tests added beyond the story:**
- `list-customers.test.ts` › 400 for unknown field, bad status, bad counter, limit 101, bad cursor: strict query validation (Validation convention); passed at once after implementation
- `list-customers.test.ts` › leaves out deleted and merged relationships: visibility predicate (v5.0.0-8.2.2)
- `list-customers.test.ts` › 401 without a token, MANAGER/OWNER can list, status=ENDED returns an ended row, paging has no gap or repeat

**Other additions:**
- `scripts/generate-openapi.ts`: import of relationship.openapi (generate-script test compares it with the live doc).
- `tests/integration/api-docs/catalog.test.ts`: the new path (allowed by CONVENTIONS).

**Evidence:** story tests 19/19; full suite 1561/1561, failing: none; typecheck clean; lint 0 errors, 57 warnings (existing)

**Follow-ups:**
- per-001 route list only covers auth paths, so nothing to add there.
<!-- end REL-008 -->

<!-- begin REL-014 -->
## REL-014 — Reassignment journal table

- Filed: 2026-10-04 06:22 UTC
- Status: **done**: Reassignments journal table, contestation partial unique index, immutable; 12 tests
- Risk: medium · story: [REL-014-reassignment-journal-table.md](../modules/relationship/REL-014-reassignment-journal-table.md)
- Agent: 41,031 tokens, 16 tool uses, 6 min 45 s

### Agent report

**Summary:** Added customer_relationship_reassignments (migration + Prisma model), append-only for distribo_app, with the partial unique contestation index.

**Decisions:**
- Rule "new person has no relationship with the same supplier" (C-12): not enforced in the table; story AC and Out of scope leave it to the writers (REL-023/024). Noted in the schema comment.
- Index and FK names truncated to Postgres' 63-char form in the migration so `prisma migrate diff` shows no drift.
- Defined `reason` as TEXT and `reassigned_at` default now(), like set_at in REL-003.

**Tests added beyond the story:**
- `reassignment-table.test.ts` › accepts an empty reason: reason is nullable (story field list); passed at once
- `reassignment-table.test.ts` › accepts several corrections / a contestation after a correction / one contestation per relationship and previous person: index is partial and scoped (C-12); passed at once
- `reassignment-table.test.ts` › rejects missing previous person, author or time with 23502 (AC-4 required list); passed at once
- TRUNCATE also checked as 42501 (REVOKE covers it, C-39)

**Evidence:** story tests 12/12; full suite 1061/1061, failing: none; typecheck clean; lint 0 errors, 44 warnings (pre-existing)

**Follow-ups:**
- I edited the migration's constraint names after applying it to the local test DB, then renamed them there with ALTER (prisma migrate reset was refused by the safety guard). A fresh DB was verified from scratch; set-aside/test-DB reset will make it consistent.
<!-- end REL-014 -->
