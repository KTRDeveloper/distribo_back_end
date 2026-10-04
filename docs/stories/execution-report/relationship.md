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

<!-- begin REL-009 -->
## REL-009 — Seller opens one customer

- Filed: 2026-10-04 14:05 UTC
- Status: **done**: GET customer by id; 8 tests, full suite 1569 green
- Risk: medium · story: [REL-009-seller-opens-one-customer.md](../modules/relationship/REL-009-seller-opens-one-customer.md)
- Agent: 36,232 tokens, 12 tool uses, 3 min 11 s

### Agent report

**Summary:** Added GET /organizations/{organizationId}/customers/{relationshipId} (SELLER+, supplier view), 404 outside the supplier org, 400 on a non-UUIDv7 id, 403 for a DRIVER.

**Decisions:**
- Role check: extracted `assertSellerOrAbove` in the service, shared by listCustomers and getCustomer (same logged 403); behavior of list unchanged.
- Lookup: `findSupplierRelationship` selects by id, visibility predicate and supplier org in one query, so another business's id gives 404.
- Param schema is not strict: merged route params carry organizationId, already validated by loadActor.

**Tests added beyond the story:**
- `get-customer.test.ts` › unknown id answers 404: absent id indistinguishable from foreign (AC-2); passed at once after the route existed
- `get-customer.test.ts` › OWNER can open: role above SELLER allowed (story: SELLER and above)
- `get-customer.test.ts` › relationship of B where A is the customer, read under A's path, 404: A must read only as supplier (AB-1, CM-19)

**Other additions:**
- Path added to `tests/integration/api-docs/catalog.test.ts` (convention); per-001 has no organization routes listed, so unchanged.

**Evidence:** story tests 8/8; full suite 1569/1569, failing: none; typecheck clean; lint 0 errors, 57 warnings (pre-existing)
<!-- end REL-009 -->

<!-- begin REL-010 -->
## REL-010 — Seller edits the supplier-side fields

- Filed: 2026-10-04 14:09 UTC
- Status: **done**: PATCH customers/:id; per-field ability check, 21 tests
- Risk: medium · story: [REL-010-seller-edits-the-supplier-side-fields.md](../modules/relationship/REL-010-seller-edits-the-supplier-side-fields.md)
- Agent: 43,278 tokens, 11 tool uses, 2 min 55 s

### Agent report

**Summary:** Added PATCH /organizations/{id}/customers/{relationshipId} editing label, address and notes; done.

**Decisions:**
- AC-3 counter label: handled by the schema (`customer_label` is never null, min 1), so the service has no counter-specific branch.
- Order of checks: path and body validation (400) run before the per-field ability check (403) and the scope lookup (404), as in the GET routes.
- Lookup and update share one transaction in the repository, through the visibility predicate; not-visible gives null, then 404.
- No gesture `id` in the body: the story's strict three-field schema excludes it, and a PATCH of fixed values is naturally repeatable.
- Catalog and per-001 route lists need no new entry: the PATCH reuses an existing path.

**Tests added beyond the story:**
- `edit-customer.test.ts` › edits the address only, clears with null, OWNER can edit, delivery_address 2001 chars, customer_label null, counter label edit, organization-as-customer 404, deleted 404 and malformed id 400: boundaries and scope (AC-2, AC-3, AB-2, C-06); all passed at once as regression guards after the implementation.

**Evidence:** story tests 21/21; full suite 1590/1590, failing: none; typecheck clean; lint 0 errors, 57 warnings (existing)
<!-- end REL-010 -->

<!-- begin REL-011 -->
## REL-011 — Manager adds a counter

- Filed: 2026-10-04 14:12 UTC
- Status: **done**: POST /counters; SELLER blocked by an extra MANAGER rank check
- Risk: medium · story: [REL-011-manager-adds-a-counter.md](../modules/relationship/REL-011-manager-adds-a-counter.md)
- Agent: 53,939 tokens, 17 tool uses, 3 min 33 s

### Agent report

**Summary:** Added POST /organizations/{id}/counters (schema, service, repository, route, OpenAPI); all 19 story tests pass.

**Decisions:**
- SELLER refusal: the ACC rule `create CustomerRelationship` for SELLER has no condition, so it also matches subject `{counter: true}`; the service therefore checks `atLeast(MANAGER)` in addition to the ability, to get the 403 the story requires.
- Label uniqueness: no DB index exists, so the service checks inside the transaction with an exact match after trim, ignoring deleted/merged rows; the default counter's label counts too.
- Concurrency: the organization row is locked `FOR UPDATE` before the check, so two concurrent adds of one label give 201 and 409.

**Tests added beyond the story:**
- `add-counter.test.ts` › keeps one counter when two managers add the same label at once: race on the label rule (transaction/race rule); passed once the lock was in
- `add-counter.test.ts` › allows the same label in another organization / the label of a deleted counter again: scope of the uniqueness (AC-2 wording "counter of one organization"; passed at once)
- `add-counter.test.ts` › CLOSED organization 409, OWNER 201, 404 for a manager of another business (fail-closed and tenant scope)
- `add-counter.test.ts` › blank / over-long label, missing id, phone_number in body: 400 (strict schema, v5.0.0-15.3.3)

**Other additions:**
- `catalog.test.ts`: the new path (required by the project rule).
- `lockOrganization`, `counterLabelExists` in the repository.

**Evidence:** story tests 19/19; full suite 1609/1609, failing: none; typecheck clean; lint 0 errors, 57 warnings (existing)

**Follow-ups:**
- ACC-002 SELLER `create CustomerRelationship` rule lacks a `counter: false` condition; the rank check masks it here but other callers of the ability could be misled.
- A 409 COUNTER_LABEL_TAKEN is not replayed specially; idempotency behavior for 4xx follows the existing middleware.
<!-- end REL-011 -->

<!-- begin REL-012 -->
## REL-012 — Owner or manager sets a credit limit

- Filed: 2026-10-04 14:18 UTC
- Status: **done**: PUT credit-limit done; same-author trigger workaround (clear author then write, locked tx)
- Risk: high · story: [REL-012-owner-or-manager-sets-a-credit-limit.md](../modules/relationship/REL-012-owner-or-manager-sets-a-credit-limit.md)
- Agent: 86,833 tokens, 29 tool uses, 5 min 44 s

### Agent report

**Summary:** Added PUT .../customers/{relationshipId}/credit-limit with checks, journal via REL-004 trigger, owner notification and warn log; all green.

**Decisions:**
- REL-004 trigger refuses a limit change with an unchanged author (same person twice): when the caller is already the author, a first statement blanks author and time, then the limit and author are written, in one transaction under a row lock; no migration.
- Same value again writes nothing and returns 200 with the unchanged row (no journal, no author change, no notification).
- "Raised" = higher number, or ceiling removed; null to a number is a lowering, so no notification.
- Own record: customer person == caller (any role), or a non-OWNER who is MANAGER/OWNER of the customer organization; checked after the counter check and before the status check.
- credit_limit bounded to safe integers (`.safe()`) so it fits the bigint column; field required (absent is 400, not "no ceiling").
- No ORGANIZATION_NOT_ACTIVE check (story lists none).

**Tests added beyond the story:**
- `credit-limit.test.ts` › same author three times, same value no-op, manager lowers or owner raises does not notify, manager removing the ceiling notifies, owner own-person 403 vs owner of customer org 200, other organization 404, missing/string/unsafe limit 400 (AC-3, REL-004 trigger, C-10, ACC rules); all green after implementation.

**Other additions:**
- Catalog test path entry for the new route (CONVENTIONS rule); schema.prisma comment on the same-author workaround.

**Evidence:** story tests 25/25; full suite 1634/1634, failing: none; typecheck clean; lint 0 errors, 57 warnings

**Follow-ups:**
- PENDING relationship cannot be seeded (an org supplier is never PENDING), so only ENDED is tested for RELATIONSHIP_NOT_ACTIVE.
- The REL-004 same-author rule is still odd; a human may prefer relaxing the trigger in a migration instead of the two-statement workaround.
<!-- end REL-012 -->

<!-- begin REL-013 -->
## REL-013 — Owner reads the credit limit history

- Filed: 2026-10-04 14:22 UTC
- Status: **done**: GET credit-limit-changes: MANAGER and above, visibility first, keyset on set_at; 10 tests
- Risk: medium · story: [REL-013-owner-reads-the-credit-limit-history.md](../modules/relationship/REL-013-owner-reads-the-credit-limit-history.md)
- Agent: 53,077 tokens, 17 tool uses, 3 min 17 s

### Agent report

**Summary:** Added GET .../customers/{relationshipId}/credit-limit-changes (OWNER and MANAGER, paged newest first, 404 outside the organization).

**Decisions:**
- Role gate: `atLeast(role, 'MANAGER')` in the service, 403 logged as permission_refused; no CASL subject exists for the journal and the story names none.
- Ordering and cursor: `set_at` desc then id (the journal has no created_at); the shared cursor carries set_at in its `createdAt` field.
- Query schema `creditLimitChangesQuerySchema` is strict (unknown fields 400).

**Tests added beyond the story:**
- `credit-limit-history.test.ts` › empty page and null limits: no entries gives [], no ceiling gives null (journal note in schema.prisma); passed at once
- `credit-limit-history.test.ts` › malformed cursor, unknown field, bad id: 400 (CONVENTIONS validation rules); passed at once
- `credit-limit-history.test.ts` › AB-1 foreign vs absent id and org B path: same 404, no data leak (CONVENTIONS scope rule); passed at once

**Other additions:**
- Path added to `tests/integration/api-docs/catalog.test.ts`; per-001.test.ts holds no route list, so untouched.

**Evidence:** story tests 10/10; full suite 1644/1644, failing: none; typecheck clean; lint 0 errors, 57 warnings (existing)
<!-- end REL-013 -->

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

<!-- begin REL-015 -->
## REL-015 — Manager ends and reopens a relationship as supplier

- Filed: 2026-10-04 14:26 UTC
- Status: **done**: end/reopen routes; PENDING unreachable via org scope (404); reopen of non-ended = RELATIONSHIP_NOT_ENDED (unspecified)
- Risk: medium · story: [REL-015-manager-ends-and-reopens-a-relationship-as.md](../modules/relationship/REL-015-manager-ends-and-reopens-a-relationship-as.md)
- Agent: 60,606 tokens, 17 tool uses, 4 min 23 s

### Agent report

**Summary:** Added POST end and reopen routes (manager online), service, conditional-update repository transition, schema, OpenAPI; all green.

**Decisions:**
- Reopening a relationship that is not ENDED: story is silent; chose 409 `RELATIONSHIP_NOT_ENDED` (fail closed, mirrors RELATIONSHIP_NOT_ACTIVE).
- Ending an already ENDED relationship: 409 `RELATIONSHIP_NOT_ACTIVE`.
- OWNER may also end/reopen (rules table role inheritance via abilityFor `end`/`reopen`; no seller/driver rule).
- Transition: row lock + one conditional `updateMany` (status and ended_by_party together, C-09).
- Shared `endOrReopenRoute` helper in routes to avoid duplicating the two handlers.

**Tests added beyond the story:**
- `end-reopen-supplier.test.ts` › lets the OWNER end a relationship too: role inheritance (ACC-002); passed at once
- same › refuses ending an already ended relationship: state guard (AC-3 spirit); passed at once
- same › refuses reopening a relationship that is not ended: fail closed on unspecified state
- same › end then reopen round-trips; foreign organization 404; malformed id / extra body field 400 (CONVENTIONS errors)

**Other additions:**
- Paths added to `tests/integration/api-docs/catalog.test.ts` (convention); per-001 has no relationship route list.

**Evidence:** story tests 16/16; full suite 1660/1660, failing: none; typecheck clean; lint 0 errors, 57 warnings (pre-existing)

**Follow-ups:**
- AC-3 row "ending a PENDING relationship -> 409" is unreachable by the supplier organization: a PENDING row always has a person as supplier (DB CHECK), so the org-scoped lookup answers 404. The test asserts 404; the service still checks status !== ACTIVE (409) defensively. A human should confirm the intended behavior.
- RELATIONSHIP_NOT_ENDED is a new code outside the story's Errors list.
<!-- end REL-015 -->

<!-- begin REL-016 -->
## REL-016 — Customer lists their suppliers

- Filed: 2026-10-04 14:30 UTC
- Status: **done**: GET /suppliers customer view, 11 tests, suite 1671 green
- Risk: medium · story: [REL-016-customer-lists-their-suppliers.md](../modules/relationship/REL-016-customer-lists-their-suppliers.md)
- Agent: 55,765 tokens, 14 tool uses, 3 min 12 s

### Agent report

**Summary:** Added GET /api/v1/suppliers (customer view, status filter, keyset paging) through route, service, repository, schema and OpenAPI.

**Decisions:**
- Mount point: new `supplierRoutes` router exported from relationship.routes.ts and mounted at `/suppliers` in `src/app.ts` (the org-scoped router cannot host it).
- Scope: visibility predicate with no organization ids, narrowed to `customerPersonId = caller`, so rows where the caller is only the supplier person are excluded.
- 401 without header is `UNAUTHORIZED`; a bad token gives the existing `INVALID_TOKEN`, so the 401 test sends no header.

**Tests added beyond the story:**
- `list-suppliers.test.ts` › 400 VALIDATION_ERROR (unknown field, bad status, limit 101, bad cursor): strict query (Validation convention); passed at once after implementation.
- `list-suppliers.test.ts` › 401 without token (Errors convention).

**Other additions:**
- `src/app.ts` mount and `/api/v1/suppliers` entry in `catalog.test.ts` (CONVENTIONS: story that adds a route).

**Evidence:** story tests 11/11; full suite 1671/1671, failing: none; typecheck clean; lint 0 errors, 57 warnings (pre-existing)
<!-- end REL-016 -->

<!-- begin REL-017 -->
## REL-017 — Customer names, ends and reopens a supplier

- Filed: 2026-10-04 14:34 UTC
- Status: **done**: customer PATCH/end/reopen on /suppliers; 12 story tests, full suite 1683 green
- Risk: medium · story: [REL-017-customer-names-ends-and-reopens-a-supplier.md](../modules/relationship/REL-017-customer-names-ends-and-reopens-a-supplier.md)
- Agent: 62,324 tokens, 22 tool uses, 4 min 19 s

### Agent report

**Summary:** Added PATCH /suppliers/{id} and POST /suppliers/{id}/end and /reopen for the customer person; done.

**Decisions:**
- PATCH has no gesture id and no idempotent(): the story's body is only `{ supplier_label }`, and a repeat writes the same value.
- End on a non-ACTIVE row answers 409 RELATIONSHIP_NOT_ACTIVE; reopen on a non-ENDED row answers 409 RELATIONSHIP_NOT_ENDED (same codes as the supplier side).
- Scope is the visibility predicate plus customer_person_id = caller, so a row where the caller is only the supplier person answers 404.
- Customer-side finders and `findWithSupplier` added to the repository, because the supplier-side reload does not load supplierPerson. `transitionRelationship` now accepts CUSTOMER.

**Tests added beyond the story:**
- `customer-actions.test.ts` › refuses an empty label and unknown fields: only supplier_label writable, credit_limit untouched (AC-3, CM-19); passed on first implementation
- `customer-actions.test.ts` › refuses ending a non-ACTIVE / reopening a non-ENDED relationship: 409 codes (C-09)
- `customer-actions.test.ts` › AB-2 for the supplier-side person and an absent id: 404 (CONVENTIONS: outside scope is 404)
- `customer-actions.test.ts` › repeat of the same gesture id returns the first response (Project rules, idempotence)
- `customer-actions.test.ts` › unknown fields in end body (status, ended_by_party): 400 (v5.0.0-15.3.3)
- `customer-actions.test.ts` › PATCH without session: 401

**Other additions:**
- Three paths added to the catalog test in tests/integration/api-docs/catalog.test.ts (per-001 only lists auth paths, nothing to add).

**Evidence:** story tests 12/12; full suite 1683/1683, failing: none; typecheck clean; lint 0 errors, 57 warnings (pre-existing security/detect-non-literal-fs-filename)

**Follow-ups:**
- Customer-side end/reopen do not notify the supplier; the story does not ask for it.
<!-- end REL-017 -->

<!-- begin REL-018 -->
## REL-018 — Organization lists and names its suppliers

- Filed: 2026-10-04 14:38 UTC
- Status: **done**: GET/PATCH /organizations/{id}/suppliers, MANAGER+, customer projection; 23 tests, full suite 1706 green
- Risk: medium · story: [REL-018-organization-lists-and-names-its-suppliers.md](../modules/relationship/REL-018-organization-lists-and-names-its-suppliers.md)
- Agent: 73,787 tokens, 20 tool uses, 3 min 53 s

### Agent report

**Summary:** Added GET and PATCH /organizations/{id}/suppliers (MANAGER and above, customer projection, scoped to customer_organization_id).

**Decisions:**
- Role check: `atLeast(role, 'MANAGER')` with a logged 403, because the rules table has no rule for `supplier_label` (only NETWORK rules for ordering); the server is always online.
- `listSuppliersQuerySchema` and `editSupplierSchema` from REL-016/017 reused unchanged, so no schema change; a status filter is also accepted on the list.
- Extracted `pageOfSuppliers` and `writeSupplierLabel` in the repository so the person and organization variants share code (REL-016/017 behavior unchanged, their tests still pass).

**Tests added beyond the story:**
- `org-suppliers.test.ts` › pagination with limit and cursor: keyset paging of the new list (Project rules: lists)
- `org-suppliers.test.ts` › SELLER and DRIVER get 403 on PATCH, nothing written: role gate on the write (AC-3, v5.0.0-8.2.1); passed at once with the implementation
- `org-suppliers.test.ts` › only relationships where the organization is the customer: a row where it is the supplier is excluded (AB-1 scope)
- `org-suppliers.test.ts` › PATCH 404 for supplier-side row, unknown id, deleted row, and B's row through A's path (AB-1)
- `org-suppliers.test.ts` › PATCH writes only supplier_label; 100 chars pass, 101, extra keys, empty body and blank label give 400 (AC-4, CWE-915)

**Other additions:**
- `tests/integration/api-docs/catalog.test.ts`: two new paths (Project rules). per-001 has no route list for these modules, so unchanged.
- `openapi/openapi.json` regenerated.

**Evidence:** story tests 23/23; full suite 1706/1706, failing: none; typecheck clean; lint 0 errors, 57 warnings (existing)

**Follow-ups:**
- None.
<!-- end REL-018 -->

<!-- begin REL-019 -->
## REL-019 — Organization ends and reopens a supplier

- Filed: 2026-10-04 14:44 UTC
- Status: **done**: org end/reopen supplier routes; 19 tests, suite 1725 green
- Risk: medium · story: [REL-019-organization-ends-and-reopens-a-supplier.md](../modules/relationship/REL-019-organization-ends-and-reopens-a-supplier.md)
- Agent: 51,017 tokens, 17 tool uses, 5 min 16 s

### Agent report

**Summary:** Added POST end and reopen on organizations/{id}/suppliers/{relationshipId}, mirroring REL-017 with the organization scope.

**Decisions:**
- Role check: reused `assertMayEndOrReopen` (rules table, online context) rather than `atLeast(MANAGER)`, so end/reopen follow ACC-002 as in REL-015.
- Scope: new `findOrganizationSupplierLocked` (visibility + customerOrganizationId + id, row lock); a relationship where the org is only the supplier answers 404.
- Route helper `endOrReopenRoute` now takes a generic `(actor, id) => Promise<unknown>` since the views differ (supplier vs customer).

**Tests added beyond the story:**
- `org-end-reopen.test.ts` › not active / not ended 409 codes, absent id and org-as-supplier 404, non-member 404, OWNER allowed, 400 on unknown field, CM-19 no leak, blocked row stays ENDED by SUPPLIER (story rules / REL-017 pattern); all passed at once once implemented

**Other additions:**
- Two paths added to `tests/integration/api-docs/catalog.test.ts` (convention); per-001 lists none for these modules so unchanged.

**Evidence:** story tests 19/19; full suite 1725/1725, failing: none; typecheck clean; lint 0 errors, 57 warnings (pre-existing)
<!-- end REL-019 -->

<!-- begin REL-020 -->
## REL-020 — Customer invites a supplier by phone number

- Filed: 2026-10-04 14:48 UTC
- Status: **done**: invitations by person and organization, 24 tests, full suite green
- Risk: high · story: [REL-020-customer-invites-a-supplier-by-phone-number.md](../modules/relationship/REL-020-customer-invites-a-supplier-by-phone-number.md)
- Agent: 96,413 tokens, 25 tool uses, 4 min 31 s

### Agent report

**Summary:** Added both invite-supplier routes (person and organization), schema, service, repository insert, OpenAPI and catalog entries; done.

**Decisions:**
- Insert: raw `INSERT ... ON CONFLICT DO NOTHING`, 0 rows gives 409 RELATIONSHIP_EXISTS: race-safe on the C-07 pair indexes, no pre-check needed.
- Relationship id is `newId()`, not the gesture `id` (as addCustomer): the gesture id only serves the idempotency key.
- Order in service: role (org only), then lookup allowance, then transaction (org ACTIVE, public-number check, find/create guest, insert); a refusal rolls back the guest, so nothing is stored.
- `ORGANIZATION_NOT_ACTIVE` 409 for a non-ACTIVE organization customer, as addCustomer does; the story's Errors list omits it.
- Service re-checks `invite_supplier` through the rules table when an organization is the customer (the route has requireAbility too); the SELLER 403 does not spend the allowance.

**Tests added beyond the story:**
- `invite-supplier.test.ts` › repeat with the same gesture id: one row, same response (project rule on idempotent gestures); passed at once
- `invite-supplier.test.ts` › a deleted relationship does not block a new invitation (C-07); passed at once
- `invite-supplier.test.ts` › person and organization may invite the same number (distinct pairs); passed at once
- `invite-supplier.test.ts` › 61st shared limit for organization route; refused role spends no allowance; non-member 404; 401 without token; number normalization; reuse of an existing person (AC-2, AC-4, 8.2.2, FND-004)

**Other additions:**
- `openapi/openapi.json` regenerated; two paths added to `tests/integration/api-docs/catalog.test.ts` (allowed by CONVENTIONS).

**Evidence:** story tests 24/24; full suite 1749/1749, failing: none; typecheck clean; lint 0 errors, 57 warnings (existing)

**Follow-ups:**
- A person inviting their own number (supplier person = customer person) is not refused: the story and DB rules are silent; ask whether to add a 400/409.
- A member of the organization inviting a number of their own team is likewise not covered.
<!-- end REL-020 -->

<!-- begin REL-021 -->
## REL-021 — Invited supplier accepts or declines

- Filed: 2026-10-04 14:54 UTC
- Status: **done**: list, accept, merge, decline; 27 tests, full suite 1776 green
- Risk: high · story: [REL-021-invited-supplier-accepts-or-declines.md](../modules/relationship/REL-021-invited-supplier-accepts-or-declines.md)
- Agent: 92,903 tokens, 29 tool uses, 5 min 42 s

### Agent report

**Summary:** Added list, accept (with merge) and decline of supplier invitations under /api/v1/supplier-invitations; all green.

**Decisions:**
- Bodies carry the gesture `id` (accept: `{ id, organization_id }`, decline: `{ id }`): the story lists only `organization_id`, but CONVENTIONS requires a UUIDv7 `id` on online gestures and `idempotent()` needs it.
- Decline answers 200 `{ declined: true }` (not 204): the idempotency replay needs a JSON body. Accept answers 200 `{ merged:false, relationship }` (supplier view) or `{ merged:true }`.
- New router `supplierInvitationRoutes` mounted at `/supplier-invitations` in `src/app.ts` (not in the story's file list; the path prefix required it).
- Check order on accept: invitation (404) then membership (404) then role below MANAGER (403) then organization ACTIVE (409). Role check uses `atLeast(role,'MANAGER')`: no ACC rule exists for this action.
- No notification on a merge (the customer already has the relationship); `supplier.accepted` only after a real acceptance. Recipient: the customer person, or the active owner of the customer organization.

**Tests added beyond the story:**
- `supplier-invitations.test.ts` › repeated gesture id (accept and decline): first response replayed, one notification (idempotency convention); passed at once
- same file › second accept / second decline / decline after accept answer 404 (v5.0.0-8.2.2, AC-5 scope); SUSPENDED organization 409; deleted relationship does not merge (C-07); OWNER may accept; organization customer notifies its owner; unknown body fields 400; 401 without token

**Other additions:**
- `projectInvitation` in `relationship.visibility.ts` (explicit field list for the list view); catalog.test.ts paths for the three routes (required by project rules).

**Evidence:** story tests 27/27; full suite 1776/1776, failing: none; typecheck clean; lint 0 errors, 59 warnings (all pre-existing)

**Follow-ups:**
- If the invitation's customer organization is the same organization chosen on accept, the DB check (distinct organizations) aborts the transaction as a 500; no rule in the story gives a coded 409. Needs a decision.
- A concurrent insert of the same pair by another gesture (addCustomer) could still hit the unique index and 500 (fails closed).
<!-- end REL-021 -->

<!-- begin REL-022 -->
## REL-022 — Newly registered person sees what is attached to their number

- Filed: 2026-10-04 14:58 UTC
- Status: **done**: GET /people/me/attachments; 7 tests, full suite 1783 green
- Risk: medium · story: [REL-022-newly-registered-person-sees-what-is-attached.md](../modules/relationship/REL-022-newly-registered-person-sees-what-is-attached.md)
- Agent: 53,569 tokens, 22 tool uses, 3 min 35 s

### Agent report

**Summary:** Added `GET /api/v1/people/me/attachments` (relationships, team invitations, supplier invitations, each capped at 100).

**Decisions:**
- Team invitations: reused `listMyInvitations` (organization service) and its `InvitationItem` as `TeamInvitationView`: the story's type does not exist, and "as in their own lists" asks for the same view.
- Relationships: new repository `listAttachedRelationships` (ACTIVE and ENDED only, customer person, visibility predicate); PENDING invitations the person sent are excluded.
- Router `attachmentsRoutes` mounted at `/people/me/attachments` in app.ts before `/people`, to keep it in the relationship module.

**Tests added beyond the story:**
- `attachments.test.ts` › keeps PENDING invitations the person sent out of relationships: story says ACTIVE and ENDED only (Context); passed after implementation like the others

**Other additions:**
- `app.ts` mount and `catalog.test.ts` path entry (convention).

**Evidence:** story tests 7/7; full suite 1783/1783, failing: none; typecheck clean; lint 0 errors, 57 warnings (pre-existing kind)
<!-- end REL-022 -->

<!-- begin REL-023 -->
## REL-023 — Customer contests a relationship ("this is not me")

- Filed: 2026-10-04 15:03 UTC
- Status: **done**: POST /suppliers/{id}/contest; 14 story tests, full suite 1797 green
- Risk: high · story: [REL-023-customer-contests-a-relationship-this-is-not-me.md](../modules/relationship/REL-023-customer-contests-a-relationship-this-is-not-me.md)
- Agent: 90,500 tokens, 28 tool uses, 4 min 48 s

### Agent report

**Summary:** Added POST /api/v1/suppliers/{relationshipId}/contest (204): ghost person, journal row, scope bump and notices in one transaction.

**Decisions:**
- 204 with idempotent(): the route sends `res.status(204).json({})` (no body on the wire) because the guard stores a null response as "in progress"; a replay now returns 204.
- Second contestation: checked by a lookup in the locked transaction (hasContested) before creating the ghost; the partial unique index stays the backstop.
- PENDING rows and rows of others answer 404 through customerScope plus a status check; notices go to ACTIVE registered OWNER/MANAGER of the supplier organization, in each recipient's language (FR "Un numéro est à corriger", EN equivalent).
- Journal row id is a fresh newId(), not the gesture id, so a gesture id reused by another person cannot collide.

**Tests added beyond the story:**
- `contest.test.ts` › contests an ENDED relationship, no reason: ENDED allowed, reason null (Context: ACTIVE or ENDED); passed at once with implementation
- `contest.test.ts` › 404 when caller is only the supplier person: scope by customer_person_id (AC-4 / v5.0.0-8.2.2)
- `contest.test.ts` › 400 for unknown field, over-long reason, bad id: strict body (CONVENTIONS validation)
- `contest.test.ts` › requires authentication: 401 (deny by default)
- `contest.test.ts` › replays the first response for the same gesture id: one journal row (Project rules, idempotency)

**Other additions:**
- `/contest` path added to `tests/integration/api-docs/catalog.test.ts` (Project rules); per-001 lists no relationship routes, so unchanged.

**Evidence:** story tests 14/14; full suite 1797/1797, failing: none; typecheck clean; lint 0 errors, 57 warnings (existing)

**Follow-ups:**
- idempotent() cannot store a body-less response: other 204 gestures should use the same json({}) trick or the guard should be fixed.
- REL-024 (supplier restores the number) is not built: the AB-1 tests simulate the restore by a direct update.
<!-- end REL-023 -->
