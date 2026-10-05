# Execution report: sync

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

### Run 2026-10-05 02:43 UTC: `/implement-stories SYNC-010`

| story | status | commit | note |
|---|---|---|---|
| SYNC-010 Judge pipeline: scope, field rights, computed fields | done | b3a24ce | judgeBatch wired in pushChanges; scope, field rights, computed strip, author; 19 tests, full suite 2923 green |

- Run completed: SYNC-010 resumed its earlier partial changes and ended done.
- An earlier `/implement-stories SYNC-10` call stopped on UNKNOWN SYNC-10 (the ID must be zero-padded); it filed nothing.
- Follow-ups from the agent: rows with no parent reach their adapter unscoped (the adapter must refuse them); a forbidden line still returns resync_required false (CM-28's full resync and notification to the author are not covered).
- Next: `/implement-stories next:3`

### Run 2026-10-04 19:20 UTC: `/implement-stories SYNC-002`

| story | status | commit | note |
|---|---|---|---|
| SYNC-002 Sync archive table | done | 3d685e3 | sync_archives table, FKs, immutability grants; admin-action-table fixture updated |

- Run completed.
- SYNC-002 resumed from its blocked stash, after the story gained a "Tests to update" section for the admin-action-table.test.ts fixture (committed with the story).
- Next: `/implement-stories next:3`

### Run 2026-10-04 18:01 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| SYNC-001 Sync types, adapter registry and viewer | done | da21022 | types, registry, viewer; 7 tests pass |
| SYNC-002 Sync archive table | blocked | c543bea | FK admin_actions.sync_archive_id breaks existing admin-action-table.test.ts 'accepts REPLAY_SYNC...' (uses non-existent ARCHIVE_ID); story lists no Tests to update: allow inserting an archive row in that test's setup? |
| SYNC-003 Pull endpoint and identity tables | done | 385e6a9 | GET /sync/pull and identity adapters; 19 tests pass; no OpenAPI (SYNC-006) |
| SYNC-004 Pull relationships and negotiated prices | done | b2fa665 | customer_relationships and customer_prices pull adapters; suite 2170/2170 |
| SYNC-005 Pull the catalog | done | 61fa592 | products adapter: full catalog for OWNER/MANAGER/SELLER, 3 columns for DRIVER, none for customer |
| SYNC-006 Pull orders, lines and deliveries | done | 4782765 | orders, order_lines, deliveries pull adapters; 11 tests green |
| SYNC-008 Device tracking and full resynchronization | done | f6a33d1 | Pull checks X-Scope-Version, revoked device 401, records last_synced_at and scope_version_seen |

Not run: SYNC-007, SYNC-009..SYNC-023.
Also in this run: relationship, catalog, order, finance, delivery, privacy.

- Completed: every PLAN line was run or skipped; the run did not stop.
- Skipped, a dependency not done (via ORD-006): ORD-009 to ORD-017, ORD-019 to ORD-021, FIN-002 to FIN-020, SYNC-007.
- Skipped, a dependency not done (via DLV-002): DLV-003 to DLV-012.
- Skipped, a dependency not done (via SYNC-002, or the chains above): SYNC-009 to SYNC-023, PRIV-003.
- Stashes: "ORD-006 blocked: partial changes", "DLV-002 blocked: partial changes", "SYNC-002 blocked: partial changes".
- All three blocks have one cause: the story's new database rule breaks existing tests (ORD-006: 48 in 6 files; DLV-002: 4 in delivery-table; SYNC-002: 1 in admin-action-table), and none lists them under "Tests to update".
- Unexpected: REL-012, ORD-003 and SYNC-006 hand-backs lacked the final `<ID> <status>` line; STATUS.md said done, as their text did. No missing report file, every figure came from its notification.
- Next: add "Tests to update" to ORD-006, DLV-002 and SYNC-002, then `/implement-stories ORD-006,DLV-002,SYNC-002`, then `/implement-stories next:100`.

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

- Filed: 2026-10-04 19:20 UTC
- Status: **done**: sync_archives table, FKs, immutability grants; admin-action-table fixture updated
- Risk: high · story: [SYNC-002-sync-archive-table.md](../modules/sync/SYNC-002-sync-archive-table.md)
- Agent: 26,386 tokens, 8 tool uses, 5 min 37 s

### Agent report

**Summary:** Added sync_archives (migration, schema model), FK from admin_actions.sync_archive_id, trigger and REVOKE; fixture of admin-action-table test updated as now listed.

**Decisions:**
- Extra index on sync_archives(device_id) and admin_actions(sync_archive_id): FK lookups, not required by the story.
- Trigger fires on INSERT OR UPDATE, like the other synchronized tables.

**Tests added beyond the story:**
- `tests/integration/sync/archive-table.test.ts` › accepts a REPLAY_SYNC row pointing to an existing archive: FK allows a valid link (AC-4); passed at once
- same file › TRUNCATE denied and row unchanged after denied UPDATE/DELETE (C-39); passed at once
- same file › index (person_id, received_at desc) exists (Context); passed at once

**Evidence:** story tests 8/8 (plus 18 in admin-action-table); full suite 2262/2262, failing: none; typecheck clean; lint 0 errors, 62 warnings (existing)
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

<!-- begin SYNC-004 -->
## SYNC-004 — Pull relationships and negotiated prices

- Filed: 2026-10-04 17:20 UTC
- Status: **done**: customer_relationships and customer_prices pull adapters; suite 2170/2170
- Risk: high · story: [SYNC-004-pull-relationships-and-negotiated-prices.md](../modules/sync/SYNC-004-pull-relationships-and-negotiated-prices.md)
- Agent: 73,069 tokens, 26 tool uses, 6 min 0 s

### Agent report

**Summary:** Added the customer_relationships and customer_prices pull adapters (read-only), registered in sync.routes.ts; all green.

**Decisions:**
- Driver scope "CONFIRMED order with an address or a delivery of theirs": read as CONFIRMED order with a delivery address (an order to deliver, any driver of the org) OR a delivery assigned to this driver (matches design 9.6 "orders to deliver, their deliveries and the customers concerned").
- Driver `customer_label`: filled from projectForDriver.customer_name, so it is the customer person's name (else org name, else the counter label), not the raw customer_label.
- A person who is the customer of a row always gets the customer view, even if also OWNER/MANAGER/SELLER of the supplier (judge-self rule, design 10.1).
- Merged rows go to `deleted` even if deleted_at were empty; on incremental pull the driver also learns the ids of gone rows of their org.
- Row ids added to rows (supplier_organization_id, customer_person_id, customer_organization_id, supplier_person_id on the customer view); prices send id, relationship, product, price, set_at, server_updated_at (no set_by_id).
- Pushes to both tables are refused like identity (refuseEveryLine now exported from identity.adapter.ts).

**Tests added beyond the story:**
- `tests/integration/sync/pull-relationships.test.ts` › collaborator who is also the customer: guards the customer-view rule (CM-19, design 10.1); passed at once
- same file › incremental balance update, driver merged duplicate, deleted price, driver sees only orders to deliver: C-35 / AC-5 / AC-2; passed at once

**Other additions:**
- `src/modules/sync/sync.routes.ts`: registers the adapters (where identity ones are registered); sync.service.ts needed no change.

**Evidence:** story tests 12/12 (6 story rows plus extras); full suite 2170/2170, failing: none; typecheck clean; lint 0 errors (62 existing warnings)

**Follow-ups:**
- Driver relationships appear only while an order is CONFIRMED (per story); an IN_DELIVERY order without own delivery or address would drop the customer on a later resync. A relationship leaving a driver's scope is not sent in `deleted`.
- Customer-organization side (organization as customer) is not synced, per story text.
<!-- end SYNC-004 -->

<!-- begin SYNC-005 -->
## SYNC-005 — Pull the catalog

- Filed: 2026-10-04 17:28 UTC
- Status: **done**: products adapter: full catalog for OWNER/MANAGER/SELLER, 3 columns for DRIVER, none for customer
- Risk: medium · story: [SYNC-005-pull-the-catalog.md](../modules/sync/SYNC-005-pull-the-catalog.md)
- Agent: 54,783 tokens, 23 tool uses, 7 min 37 s

### Agent report

**Summary:** Added the `products` sync adapter (full catalog for OWNER/MANAGER/SELLER, id/name/unit for DRIVER, nothing for customers) and registered it.

**Decisions:**
- Registration: done in `sync.routes.ts` (where the other adapters register), not `sync.service.ts` which the story lists; the service needed no change.
- Driver "orders to deliver": CONFIRMED or IN_DELIVERY orders, not deleted, with an applied address or a delivery assigned to the driver (same pool as the relationships adapter, SYNC-006 AC-2).
- `min_order_quantity` sent as a decimal string like the catalog API ("2.5"); price as a number.
- Driver incremental: a product newly on a visible order line (line or order changed since) is sent even if unchanged; a deleted product goes in `deleted` by id only if some order line names it.

**Tests added beyond the story:**
- `tests/integration/sync/pull-catalog.test.ts` › seller deleted product in `deleted`: C-35 deletion path on incremental pull (C-35); passed only once the adapter existed
- same file › driver newly-linked product arrives incrementally: a product that becomes visible is never missing on the phone (mirrors people adapter rule)

**Evidence:** story tests 7/7; full suite 2176/2177 on the first run, the failure was the lint gate test caused by one lint error in my test (fixed, re-ran lint-gate test and sync tests green); typecheck clean; lint 0 errors, 62 warnings (pre-existing)

**Follow-ups:**
- Driver orders delivered in the last 90 days (SYNC-006 pool) are not counted for product visibility; revisit if SYNC-006 widens the driver order scope.
<!-- end SYNC-005 -->

<!-- begin SYNC-006 -->
## SYNC-006 — Pull orders, lines and deliveries

- Filed: 2026-10-04 17:37 UTC
- Status: **done**: orders, order_lines, deliveries pull adapters; 11 tests green
- Risk: high · story: [SYNC-006-pull-orders-lines-and-deliveries.md](../modules/sync/SYNC-006-pull-orders-lines-and-deliveries.md)
- Agent: 74,252 tokens, 24 tool uses, 8 min 57 s

### Agent report

**Summary:** Added orders, order_lines and deliveries pull adapters, wired in sync.routes, plus sync.openapi.ts for GET /sync/pull; done.

**Decisions:**
- Story text for DRIVER is truncated ("without customer_note of other..."): followed its last clause, every order field except sync_issue (customer_note kept).
- Driver pool: CONFIRMED needs an address, IN_DELIVERY does not (AC-2 literal); also orders they delivered and orders carrying their own deliveries.
- Retention clock: DELIVERED by delivered_at, CANCELLED by cancelled_at, 90 days.
- Lines are sent when the line or its order changed (AC-4); created/updated judged by the order's created_at (lines have none).
- Deliveries: supplier roles get all of the org, a DRIVER only their own, customers none (story silent, fail closed); no created_at, so first pull = created, later = updated.
- A person who is the customer of the order gets the customer view first, as in relationships.
- Timestamps converted to epoch ms over the ORD-007 views; sync.service.ts needed no change.

**Tests added beyond the story:**
- `pull-orders.test.ts` › owner and manager see price author, seller never (v5.0.0-8.2.3); passed at once
- `pull-orders.test.ts` › deleted line / soft-deleted order listed by id, never on a first pull (C-35); passed at once
- `pull-orders.test.ts` › driver: another driver's delivery changes not sent (CM-30); passed at once
- `pull-orders.test.ts` › customer of B and driver of A see nothing of B (AB-1); passed at once

**Other additions:**
- `scripts/generate-openapi.ts` imports sync.openapi.js: generate-script test compares its paths with the live doc.
- `/api/v1/sync/pull` added to catalog.test.ts route list (convention).

**Evidence:** story tests 11/11; full suite 2188/2188, failing: none; typecheck clean; lint 0 errors, 62 warnings (pre-existing)

**Follow-ups:**
- An order leaving a driver's scope (taken by another driver) is not re-sent, so the phone keeps the stale row until its own purge.
- Confirm the truncated DRIVER sentence in the story with its author.
<!-- end SYNC-006 -->

<!-- begin SYNC-007 -->
## SYNC-007 — Pull the ledger, money records and notifications

- Filed: 2026-10-05 00:08 UTC
- Status: **done**: money adapter registered in sync.routes.ts; 10 tests, full suite 2874 green
- Risk: high · story: [SYNC-007-pull-the-ledger-money-records-and-notifications.md](../modules/sync/SYNC-007-pull-the-ledger-money-records-and-notifications.md)
- Agent: 72,373 tokens, 20 tool uses, 6 min 13 s

### Agent report

**Summary:** Added money.adapter.ts (ledger_entries, expenses, handovers, credit_limit_changes, notifications) and registered it in sync routes; all green.

**Decisions:**
- Registration: done in `sync.routes.ts` (where the other adapters register), not `sync.service.ts` which the story lists; the service needed no change.
- Expense/handover retention: kept when `occurred_at` OR `cancelled_at` is within 90 days, so a recent cancellation of an older record is learnt (story lists cancelled_at as a retention date, rule not spelled out).
- Ledger shape: SELLER gets `transaction_reference` but not `recorded_by_id`; customer gets neither; customer view wins when the person is also a collaborator (as in orders).
- Handovers: OWNER/MANAGER all rows of the org; SELLER/DRIVER only own, per active membership organization.
- ledger_entries and credit_limit_changes have no `deleted_at`: mapped to null, "created" uses `server_updated_at` (immutable rows); expenses/handovers: uncancelled = created, cancelled = updated (no created_at column).
- Notifications omit `pushed_at` (server delivery detail); include `recipient_id` (own only).

**Tests added beyond the story:**
- `pull-money.test.ts` › revoked membership receives nothing: fail-closed on non-ACTIVE membership (ASVS 8.2.2); passed at once after implementation (written with the others, red before adapter existed)
- `pull-money.test.ts` › incremental pull lists a cancelled expense as updated (C-35)

**Evidence:** story tests 10/10; full suite 2874/2874, failing: none; typecheck clean; lint 0 errors, 68 warnings (existing)

**Follow-ups:**
- Retention rule for cancelled expenses/handovers is my reading; confirm with the owner of the design.
<!-- end SYNC-007 -->

<!-- begin SYNC-008 -->
## SYNC-008 — Device tracking and full resynchronization

- Filed: 2026-10-04 17:41 UTC
- Status: **done**: Pull checks X-Scope-Version, revoked device 401, records last_synced_at and scope_version_seen
- Risk: high · story: [SYNC-008-device-tracking-and-full-resynchronization.md](../modules/sync/SYNC-008-device-tracking-and-full-resynchronization.md)
- Agent: 38,495 tokens, 13 tool uses, 4 min 0 s

### Agent report

**Summary:** Pull now validates X-Scope-Version, answers resync_required or 401 SESSION_REVOKED, and records last_synced_at / scope_version_seen on the device.

**Decisions:**
- Full pull (empty last_pulled_at) skips the version check: otherwise a stale phone could never restart; AC-2 requires data on a full pull.
- Missing X-Scope-Version counts as 0 (fail closed); malformed value is 400 VALIDATION_ERROR (1-9 digits).
- Device row absent counts as not revoked, no write: existing SYNC-003..006 tests pull without a Device row and must stay unchanged.
- Revoked check lives in buildViewer (covers every pull); resync response also carries scope_version and records last_synced_at.
- phoneScopeVersion in recordPull is never stored; a claim above the real version logs warn `scope_version_claim_ahead` (ids only).

**Tests added beyond the story:**
- `tests/integration/sync/resync.test.ts` › never writes another person device / pull with another person's device id: updates filter on person + device (ASVS 8.2.2, C-34); passed at once (the update was written scoped)
- same file › malformed X-Scope-Version 400: boundary validation (CONVENTIONS Validation)
- same file › missing header is version 0: fail closed

**Other additions:**
- `scopeVersionHeaderSchema` in sync.schemas.ts, repository functions `isDeviceRevoked` and `markDevicePulled`, service `pull` orchestrator; OpenAPI header, scope_version, resync response and 401 documented.

**Evidence:** story tests 10/10; full suite 2198/2198, failing: none; typecheck clean; lint 0 errors, 62 warnings (existing)

**Follow-ups:**
- A token whose device row does not exist is still served (needed by existing tests); revisit if sync must require a registered device.
<!-- end SYNC-008 -->

<!-- begin SYNC-009 -->
## SYNC-009 — Push endpoint, archive and envelope

- Filed: 2026-10-05 00:16 UTC
- Status: **done**: Push envelope: archive, 426, clock skew, 409, aside, last_synced_at; interim apply loop until SYNC-010 judgeBatch
- Risk: high · story: [SYNC-009-push-endpoint-archive-and-envelope.md](../modules/sync/SYNC-009-push-endpoint-archive-and-envelope.md)
- Agent: 83,064 tokens, 28 tool uses, 7 min 29 s

### Agent report

**Summary:** Added POST /api/v1/sync/push (archive, 426, clock skew, 409, aside, last_synced_at) with an interim apply loop until SYNC-010.

**Decisions:**
- `judgeBatch` does not exist yet (SYNC-010): `sync.push.ts` has an internal `applyBatch` that runs each table's adapter push in one transaction, tables in SYNC_TABLES order; SYNC-010 must replace it.
- Conflict check reuses each adapter's `pull(viewer, last_pulled_at)`: only rows in the viewer's scope can conflict, so a 409 never confirms an out-of-scope id.
- `aside` counts rows (not tables) of unknown tables; an `issue` outcome counts as accepted (stored with sync_issue, CM-28), forbidden goes to `rejected`.
- `resync_required` stays false for now (SYNC-018 sets it for forbidden lines).
- Validation 400 (query, body, headers, >2000 rows) happens before archiving, so nothing is archived; `last_pulled_at` is required and not in the future.
- X-Client-Time accepts epoch ms or ISO 8601, else 400; X-App-Version is dotted numbers, else 400; missing version with a minimum configured gives 426 (fail closed).
- Minimum read through `configService.get('sync','min_app_version')` (remote-config is not wired to it yet: env `SYNC_MIN_APP_VERSION` works); an unparsable minimum gives 500.

**Tests added beyond the story:**
- `push-envelope.test.ts` › 409 out-of-scope id: no existence leak through SYNC_CONFLICT (CONVENTIONS 404/scope rule); passed at once
- `push-envelope.test.ts` › failing adapter rolls everything back, archive stays (v5.0.0-2.3.3); passed at once
- `push-envelope.test.ts` › 2000 rows accepted, counted across tables/lists (AC-5 boundary); strict validation cases; revoked device; no auth; passed at once

**Other additions:**
- `archiveBatch`, `withPushTransaction` in the repository; `recordPush` in the service; `pushQuerySchema`, `pushBodySchema` and header schemas.
- `/api/v1/sync/push` added to `tests/integration/api-docs/catalog.test.ts` (per-001 lists only auth paths, nothing to add).

**Evidence:** story tests 30/30; full suite 2903/2904, failing: pull-relationships "driver pull never contains a debt" (flaky: the string "99000" occurs in a server_updated_at timestamp; passes on rerun, not related); typecheck clean; lint 0 errors, 74 warnings (pre-existing)

**Follow-ups:**
- The flaky SYNC-004 test (`not.toContain('99000')` on a serialized body with timestamps) should use a less collision-prone sentinel.
- SYNC-010 must replace `applyBatch` and set `resync_required` per SYNC-018.
<!-- end SYNC-009 -->

<!-- begin SYNC-010 -->
## SYNC-010 — Judge pipeline: scope, field rights, computed fields

- Filed: 2026-10-05 02:43 UTC
- Status: **done**: judgeBatch wired in pushChanges; scope, field rights, computed strip, author; 19 tests, full suite 2923 green
- Risk: high · story: [SYNC-010-judge-pipeline-scope-field-rights-computed.md](../modules/sync/SYNC-010-judge-pipeline-scope-field-rights-computed.md)
- Agent: 53,176 tokens, 20 tool uses, 5 min 7 s

### Agent report

**Summary:** judgeBatch (scope, field rights, computed strip, author from session) written and wired into pushChanges; replaces the interim apply loop.

**Decisions:**
- Order, line and delivery step fields (status, delivered_*, departed_at...): the rules table grants them as transitions, not `update`; the judge requires the role to hold one transition and leaves the exact step to the adapters (SYNC-012+).
- Order line create right: the order's `create` right (a line is written with its order).
- Update of an unknown id answers OUT_OF_SCOPE, same as a foreign id (no existence leak).
- Customer person owning the relationship acts as CUSTOMER (no write right) even if also a member.
- Unchanged fields of a whole-row update (equal to stored) are not rights-checked.
- Notifications: phones cannot create; recipient is the scope owner.
- Sale `amount` on ledger entries is stripped; payment amount is kept (phone-collected).
- `beforeApply` option runs the 409 conflict check inside the batch transaction.

**Tests added beyond the story:**
- `tests/integration/sync/judge.test.ts` › unknown id vs foreign id, DRIVER create refused, immutable ledger update/delete, customer no write right, foreign notification, relationship create naming another org, rejected line not stopping others: fail-closed and no-leak paths (CONVENTIONS: 404/scope rule, immutable tables, CM-28); passed at once once the judge existed

**Other additions:**
- `findStoredRow`, `findRelationshipOwner`, `findOrderOwner` in `sync.repository.ts`: the judge compares updates with the server's own row; repository is the only prisma caller.

**Evidence:** story tests 19/19; full suite 2923/2923, failing: none; typecheck clean; lint 0 errors, 86 warnings (object-injection on allowlisted keys, same kind as existing)

**Follow-ups:**
- Rows of the six tables that name no parent are handed to the adapter unscoped (adapter must refuse the malformed row).
- `forbidden` still reports resync_required: false; full resync plus notification to the author (CM-28) is not in this story's ACs.
<!-- end SYNC-010 -->

<!-- begin SYNC-011 -->
## SYNC-011 — Push new and edited customers, and merge duplicates

- Filed: 2026-10-05 03:09 UTC
- Status: **done**: Push side of customer_relationships: create, merge, redirect, edit
- Risk: high · story: [SYNC-011-push-new-and-edited-customers-and-merge.md](../modules/sync/SYNC-011-push-new-and-edited-customers-and-merge.md)
- Agent: 104,228 tokens, 31 tool uses, 11 min 57 s

### Agent report

**Summary:** Push side of customer_relationships: create by phone number, merge duplicates, redirect later lines, edit three fields.

**Decisions:**
- Hook-up: `relationship.adapter.ts` push now delegates to `pushRelationships` (not in the story's Modify list; needed to register the push side).
- Redirect: `LineOutcome.mergedInto` (sync.types.ts); the judge keeps a per-batch map and rewrites `customer_relationship_id` of later lines before judging them.
- Insert: raw `INSERT ... ON CONFLICT DO NOTHING` with the client id (ensureCustomerRelationship cannot take an id); a conflict never aborts the batch.
- Duplicate path: stored as phone-only row (label falls back to the kept label, then the number, since C-06 needs a label without a customer), then `mergeDuplicateRelation`.
- AB-2: a created row with credit_limit != 0, status != ACTIVE, or any other non-null field outside the allowed list is refused FIELD_NOT_ALLOWED and nothing is stored (story said "forbidden").
- Unusable text (type, length, empty label, null label on a counter) is set aside with INVALID_FIELD; edits of a deleted row are set aside; deletions stay refused (SYNC_TABLE_READ_ONLY).
- INVALID_PHONE and MERGED are `issue` outcomes: the push answer does not list issues yet (SYNC-020), so tests read them by calling the adapter directly.

**Tests added beyond the story:**
- `push-relationships.test.ts` › counter from a phone: COUNTER_ONLINE_ONLY (story Context)
- `push-relationships.test.ts` › other organization / DRIVER create: OUT_OF_SCOPE and FIELD_NOT_ALLOWED, no person created (ASVS 8.2.1); passed at once (judge)
- `push-relationships.test.ts` › same id owned by another organization: not overwritten (scope); passed at once
- `push-relationships.test.ts` › two same-number rows in one batch merge; edit aimed at a merged duplicate lands on the survivor; repeat of a merged row (AC-6, C-36)

**Evidence:** story tests 16/16; full suite 2946/2946, failing: none; typecheck clean; lint 0 errors, 93 warnings (existing style)

**Follow-ups:**
- Issues (MERGED, INVALID_PHONE) are not yet returned to the phone: SYNC-020.
- Cross-batch orders naming a merged id need `resolveMergedRelation` in SYNC-012.
<!-- end SYNC-011 -->

<!-- begin SYNC-012 -->
## SYNC-012 — Push orders entered offline

- Filed: 2026-10-05 03:18 UTC
- Status: **done**: orders and lines pushed with server amounts; migration lets retired-product lines in
- Risk: high · story: [SYNC-012-push-orders-entered-offline.md](../modules/sync/SYNC-012-push-orders-entered-offline.md)
- Agent: 139,371 tokens, 36 tool uses, 9 min 19 s

### Agent report

**Summary:** Orders and order_lines push implemented (order.push.ts, judge hook); all tests green.

**Decisions:**
- Retired product (AC-3) vs ORD-005 trigger, which refuses non-ACTIVE products on insert: added migration 20261004340000_sync_012_retired_product_lines (not listed in the story) that skips only that check when the transaction-local setting `distribo.allow_retired_product` is 'on'. The push sets it around that one insert and resets it; schema.prisma comment updated.
- The orders adapter stores the order empty (total = delivery cost); the order_lines adapter inserts lines then recomputes the total (and sets sync_issue), since the total check is deferred to commit.
- Judge: lines of an order the adapter did not store take that order's outcome (issue/aside) instead of being judged, so AC-4 never yields `forbidden`.
- `created_at` from the phone is kept, but a moment after server now is clamped to now (CM-31); an unparsable one is set aside.
- Unusable values (quantity <= 0, negative/huge price or cost, bad date) are `aside` INVALID_FIELD; amounts capped at 1e12 so sums stay in bigint.
- A line naming a product of another organization is `forbidden` OUT_OF_SCOPE; a new line on an order not CONFIRMED / not SUPPLIER-placed / not entered by the viewer is `aside` ORDER_NOT_EDITABLE.
- PENDING relationships are person-supplied (no organization), so a seller reaches them only as OUT_OF_SCOPE at the judge; the adapter still answers RELATIONSHIP_NOT_ACTIVE (tested at adapter level). An inactive supplier organization is also RELATIONSHIP_NOT_ACTIVE (avoids a DB error aborting the batch).

**Tests added beyond the story:**
- push-orders.test.ts: several lines/decimal quantity with half-franc rounding and delivery cost in the total (AC-1, CM-14)
- push-orders.test.ts: DRIVER cannot create; product of another organization forbidden without aborting; unusable quantity/price/delivery cost set aside; merged relationship redirect; new line on a non-open order; same line id twice in a batch (ASVS 8.2.1, C-36, story Create section)

**Other additions:**
- order.adapter.ts wired to the new push functions (needed; story lists only the judge).
- `PRODUCT_RETIRED_NOTE` exported from order.push.ts.

**Evidence:** story tests 18/18; full suite 2964/2964, failing: none; typecheck clean; lint 0 errors, 99 warnings (existing security/* kind)

**Follow-ups:**
- A hostile line (foreign product) leaves the order stored empty; a human may want the order dropped too.
- The migration is a trigger change the story did not list; confirm the GUC approach is acceptable.
<!-- end SYNC-012 -->

<!-- begin SYNC-013 -->
## SYNC-013 — Push order status changes and deliveries

- Filed: 2026-10-05 03:28 UTC
- Status: **done**: Departures, crossed departures, failures and cancellations pushed through the state machine; 19 tests
- Risk: high · story: [SYNC-013-push-order-status-changes-and-deliveries.md](../modules/sync/SYNC-013-push-order-status-changes-and-deliveries.md)
- Agent: 125,143 tokens, 30 tool uses, 9 min 17 s

### Agent report

**Summary:** Deliveries push adapter and order edits (cancellation, supplier note) are in, all through transitionOrder; story tests and full suite green.

**Decisions:**
- Direct status push (DELIVERED, IN_DELIVERY, PENDING, CONFIRMED) by a phone: business issue, order keeps status, sync_issue set (AB-1); counted as accepted, not rejected.
- Cancel right (DRIVER forbidden, AB-2) is re-checked in the adapter with abilityFor: the judge only requires one step right, and a DRIVER holds depart.
- Cancel without reason: set aside (INVALID_FIELD). Cancel on IN_DELIVERY/other refused step: issue, sync_issue "Annulation impossible : commande <état>".
- "<time>" in the delivered-by message is "YYYY-MM-DD HH:mm UTC" (story left the format open).
- Assigned-but-not-departed delivery: replaced by the pushed one when it is the viewer's, or the viewer is MANAGER/OWNER (as DLV-005); otherwise stored as a crossed departure.
- Departure on an order that is not CONFIRMED or has no address: issue, no delivery stored, order sync_issue "Départ impossible : ...".
- Created row may carry failed_at+reason (depart and fail in one push): applied in sequence. An update carrying departed_at on an unstarted assigned delivery is handled as a departure.
- Rows with a new arrived_at are set aside (DELIVERY_CLOSING_NOT_APPLIED): closing belongs to SYNC-014/015.
- No customer/manager notifications (DLV-005/006 send them online); not in the story.

**Tests added beyond the story:**
- `push-deliveries.test.ts` › second departure on a cancelled order, driver failing another driver's delivery, other-business order, supplier note on a delivered order, departure with failure in one push, cancel on an IN_DELIVERY order, cancel without reason, assigned-delivery takeover (scope, fail-closed, CM-12/CM-23, ASVS 8.2.x); several passed at once (written after the adapter design)
- `push-deliveries.test.ts` › departure still applied when an edit of the same order ended as an issue: guards the judge change below (C-36); passed at once

**Other additions:**
- sync.judge.ts: unstored-order tracking now only for orders created in the batch (an edit ending as issue must not swallow later lines), and deliveries of an unstored order get the order's outcome like order_lines.
- order.push.ts exports shared helpers (outcome, forbidden, scopeOfOrder, SERVER_CONTEXT, STATUS_WORDS...) reused by delivery.push.ts; order.adapter.ts wires pushDeliveries.

**Evidence:** story tests 19/19; full suite 2983/2983, failing: none; typecheck clean; lint 0 errors, 103 warnings (existing kind)

**Follow-ups:**
- delivery.push.ts imports functions from delivery.repository.ts that delivery/contracts.md does not list (lockOrderToAssign, findDeliveryInProgress, markDeparted, markFailed...); contracts.md could list them.
- SYNC-015 must handle arrived_at and the "delivery wins" case of CM-23 (currently set aside).
<!-- end SYNC-013 -->

<!-- begin SYNC-014 -->
## SYNC-014 — Push the closing of an order with its sale and payments

- Filed: 2026-10-05 03:45 UTC
- Status: **done**: Closing of a pushed DELIVERED order via deliverOrder viaSync; story tests 45/45, full suite 2998/2998
- Risk: high · story: [SYNC-014-push-the-closing-of-an-order-with-its-sale-and.md](../modules/sync/SYNC-014-push-the-closing-of-an-order-with-its-sale-and.md)
- Agent: 131,098 tokens, 70 tool uses, 17 min 24 s

### Agent report

**Summary:** An order pushed DELIVERED is now closed by the server through `deliverOrder` with `viaSync`, in a savepoint of the batch transaction; sale at the server total.

**Decisions:**
- `DeliverOptions` gains `tx` and `restOrderId` beyond the story's signature: `tx` joins the batch transaction (a nested one would deadlock), `restOrderId` carries the pushed child id.
- Closing runs after all tables (`runClosings`); the judge pulls DELIVERED orders, delivered quantities, SALE/PAYMENT rows and `arrived_at` out of the normal adapters (`closing.push.ts` take* functions).
- Child (rest) order and its lines are taken out before the judge, as a DRIVER has no right to create orders; the server makes them at original prices with the pushed order id. Orphans (parent refused) get OUT_OF_SCOPE.
- Business refusals (409/400) become an `issue` plus a French `sync_issue` (not on an already DELIVERED order); 404 becomes forbidden OUT_OF_SCOPE (a driver without a delivery of their own).
- Crossed departure (CM-23): if the viewer's delivery was stored closed "Livraison déjà prise par", the closing closes the other in-progress delivery and reopens the viewer's before delivering.
- Pushed SALE id reused only if free; its amount is never read. A repeat returns the stored result with `creditExceededBy` 0.
- A payment id already used by another entry is answered forbidden and skipped; the batch goes on.
- Deliver route now returns explicit `{order, sale, payment}` so `creditExceededBy` does not leak to the API.
- A SELLER pushing a SALE row is still refused by the judge (rules table gives SELLER PAYMENT only); my seller tests push payments only.

**Tests added beyond the story:**
- `push-closing.test.ts` › driver with no own delivery (ASVS 8.2.1, AB-2); other business order refused; quantity above ordered leaves nothing written (fail closed); already delivered by another person writes no second sale; colliding payment id does not fail the batch (C-36); `creditExceededBy` on the service result (AC-5). All passed only after implementation.

**Other additions:**
- `findClosedResult` in `delivery.repository.ts` (repeat answer); `takenBy`/`TAKEN_BY_PREFIX` exported from `delivery.push.ts`.

**Evidence:** story tests 45/45; full suite 2998/2998, failing: none; typecheck clean; lint 0 errors, 109 warnings (a few new security/detect-object-injection like the existing ones).

**Follow-ups:**
- A pushed `arrived_at` is now silently dropped for orders closed in the same batch; SYNC-015/017 should check it still fits.
- Ledger rows of orders not stored are answered with the order outcome (judge extended to ledger_entries).
<!-- end SYNC-014 -->

<!-- begin SYNC-015 -->
## SYNC-015 — Push payments and notification reads

- Filed: 2026-10-05 04:13 UTC
- Status: **done**: ledger.push + notification reads; judge ONLINE_ONLY for non-payment ledger gestures
- Risk: high · story: [SYNC-015-push-payments-and-notification-reads.md](../modules/sync/SYNC-015-push-payments-and-notification-reads.md)
- Agent: 94,929 tokens, 29 tool uses, 7 min 38 s

### Agent report

**Summary:** Payments and notification reads now push; the judge answers ONLINE_ONLY for non-payment ledger gestures; the two judge.test.ts codes were updated as the story lists.

**Decisions:**
- ONLINE_ONLY check in the judge runs before scope and role, for every update/delete (existing or not) and every created non-PAYMENT: it never confirms a row exists.
- SALE and PAYMENT rows naming an order closed in the same batch are exempt from that check (SYNC-014 owns them); a PAYMENT with an order_id and no closing is ONLINE_ONLY.
- Role stays the rules table's (DRIVER may push a PAYMENT too), not "SELLER and above" literally.
- PENDING/missing/deleted relationship or no relationship id: outcome `issue` RELATIONSHIP_UNAVAILABLE, nothing stored. A judge-scoped PENDING one is in practice unreachable (viewer is CUSTOMER, FIELD_NOT_ALLOWED).
- Unusable amount, mode, time, note or reference: `aside` INVALID_FIELD. occurred_at is required.
- Repeat: an id stored as the viewer's own PAYMENT is accepted; any other stored id is OUT_OF_SCOPE. A pg advisory xact lock on the id serializes concurrent twins (C-36).
- Notification `read_status` accepts READ or UNREAD, via `ownFields` in the judge rules; another value is aside.

**Tests added beyond the story:**
- `push-payments.test.ts` › payment id stored by someone else: not a repeat, OUT_OF_SCOPE (ASVS 8.2.1)
- `push-payments.test.ts` › payment tied to an order outside a closing: ONLINE_ONLY
- `push-payments.test.ts` › unusable amounts, pending relationship, no relationship id: set aside or issue, nothing stored (C-36)
- `push-payments.test.ts` › notification: extra field forbidden, bad status aside, create/delete forbidden (AC-4)
- `push-payments.test.ts` › forbidden kinds also tested as OWNER (role independence); several of these passed at once as guards

**Other additions:**
- `money.adapter.ts`: wires `pushLedger` and `pushNotifications` (the story names only ledger.push.ts and the judge).

**Evidence:** story tests 19/19; full suite 3029/3029, failing: none; typecheck clean; lint 0 errors, 117 warnings (existing kind)

**Follow-ups:**
- push-deliveries.test.ts failed in isolation, with and without my change, on a stale local DB; it passed in the full run.
<!-- end SYNC-015 -->

<!-- begin SYNC-016 -->
## SYNC-016 — Controls on arrival: prices, articles and dates

- Filed: 2026-10-05 03:57 UTC
- Status: **done**: controls on arrival: PRICE_CHANGED, DATE_*, owner notification; suite 3010 green
- Risk: medium · story: [SYNC-016-controls-on-arrival-prices-articles-and-dates.md](../modules/sync/SYNC-016-controls-on-arrival-prices-articles-and-dates.md)
- Agent: 93,094 tokens, 29 tool uses, 8 min 52 s

### Agent report

**Summary:** Added `runControls`/`runBatchControls` (sync.controls.ts), called by the judge after all tables; PRICE_CHANGED, DATE_IN_FUTURE, DATE_OUT_OF_ORDER and one `sync.anomalies` notification per owner.

**Decisions:**
- Controls run at the end of `judgeBatch` (after lines and closings), not in the orders adapter: PRICE_CHANGED needs the stored lines.
- `readEnteredAt` now keeps a created_at more than 5 min ahead (was clamped to now), else DATE_IN_FUTURE could never be seen; drift under 5 min is still clamped.
- AB-1: the server holds only the current price and its date. A phone reference differing from it, with the price older than the order, is false: the line's reference is rewritten to the server price and the gap gets its author (a warn log records it). History before the order's date cannot be checked.
- No PRICE_CHANGED text for lines of retired articles (PRODUCT_RETIRED already flags them; existing SYNC-012 tests expect that exact text).
- Control messages append to an existing `sync_issue`; a code already present is not added again, so a repeated push changes nothing and sends no new notification.
- Notification count = number of issue messages in the batch for that org; only orders entered by the viewer in their own orgs are controlled; owners = ACTIVE registered OWNER (one per org by DB rule); text FR/EN by preferred language.
- Times in messages use Douala time (UTC+1), as the delivery module does.

**Tests added beyond the story:**
- `controls-prices.test.ts` › not flag clock few seconds ahead: drift under 5 min is no issue (CM-31); passed at once
- `controls-prices.test.ts` › DATE_OUT_OF_ORDER and joined issues with " ; " (story rules)
- `controls-prices.test.ts` › repeated batch changes nothing: idempotent repeat (ACC); passed at once after implementation
- `controls-prices.test.ts` › owner test also checks other-org owner, manager and seller are not told (tenant/role scope)
- `tests/unit/sync/controls-words.test.ts`: French weekday/hour and thousands grouping (story example)

**Other additions:**
- None beyond `whenWords`/`francs` exports used by the unit test.

**Evidence:** story tests 10/10 (+2 unit); full suite 3010/3010, failing: none; typecheck clean; lint 0 errors, 113 warnings (pre-existing)

**Follow-ups:**
- Price history is not stored, so a phone can still hide a discount by backdating created_at before the last price change; a price-history table would close it.
- The product `price_updated_at` is DB-controlled, so tests express "price changed later" through the order date.
<!-- end SYNC-016 -->

<!-- begin SYNC-017 -->
## SYNC-017 — Controls on arrival: credit, restricted mode and long absence

- Filed: 2026-10-05 04:20 UTC
- Status: **done**: controls: CREDIT_EXCEEDED, RESTRICTED_MODE, long-absence notice; 9 tests
- Risk: medium · story: [SYNC-017-controls-on-arrival-credit-restricted-mode-and.md](../modules/sync/SYNC-017-controls-on-arrival-credit-restricted-mode-and.md)
- Agent: 77,649 tokens, 19 tool uses, 6 min 22 s

### Agent report

**Summary:** Added CREDIT_EXCEEDED (closing), RESTRICTED_MODE (order dates) and the long-absence owner notification; nothing is ever refused.

**Decisions:**
- Amount format: used `francs()` ("15 000") as the SYNC-016 messages do; AC-1 writes "15000".
- Customer label fallback: customerLabel, then person name, then organization name, then "client" (same order as the unsettled-orders view).
- RESTRICTED_MODE covers orders created in the batch (via runControls); payments are not checked.
- Long absence: runs for every push (even an empty batch), skipped on a replay, one notification per OWNER of each org the viewer belongs to (owner who is the device holder included); EN text added.
- CREDIT_EXCEEDED is written in the closing's savepoint, appended before later PRICE_CHANGED; it does not feed the "n écarts" count notification (the story names only sync_issue).

**Tests added beyond the story:**
- `controls-credit.test.ts` › exactly 3 days after last sync not flagged: boundary of "more than 3 days" (CM-31); passed at once after implementation
- `controls-credit.test.ts` › synced 2 days ago adds no line; second push after long absence adds no second notice; other org owner not told (AC-3 scope); passed at once
- `controls-credit.test.ts` › customer without limit gets no credit issue (CM-15 null = no limit)

**Evidence:** story tests 9/9; full suite 3038/3038, failing: none; typecheck clean; lint 0 errors, 118 warnings (pre-existing)

**Follow-ups:**
- pull also sets last_synced_at (markDevicePulled): a phone that pulls before pushing hides RESTRICTED_MODE and long absence; check with the design.
- Credit overruns on a delivery do not notify the owner (no AC asks for it).
<!-- end SYNC-017 -->

<!-- begin SYNC-018 -->
## SYNC-018 — Forbidden sends are refused, recorded and trigger a resync

- Filed: 2026-10-05 04:29 UTC
- Status: **blocked**: Story code done and its 8 tests pass, but the sync.refused notification breaks push-payments.test.ts 'forbids a phone creating or deleting a notification' (counts all notifications = 2, now 3); not listed under Tests to update: may it count only sync.test notifications?
- Risk: high · story: [SYNC-018-forbidden-sends-are-refused-recorded-and.md](../modules/sync/SYNC-018-forbidden-sends-are-refused-recorded-and.md)
- Agent: 59,288 tokens, 15 tool uses, 9 min 27 s

### Agent report

**Summary:** Blocked: the feature works (8 story tests pass) but the mandated sync.refused notification breaks one existing test I may not edit.

**Decisions:**
- resync_required: true only when a line is refused (rejected non-empty); an aside-only batch keeps false, because push-envelope.test.ts (AC-4 unknown table) asserts false with aside 1.
- Old per-line `sync_line_forbidden` log in judgeTable removed; the single end-of-batch `sync_line_refused` log covers forbidden and aside lines (adapters keep their own log).
- Lines of tables without adapter now become per-line aside records (id, code NO_RULE) so they can be logged and named; the count is unchanged.
- Notification text: "<n> opération(s) non enregistrée(s). Motif : <codes>. Lignes : table:code, ..." (first 5), EN equivalent; table names outside SYNC_TABLES shown as `unknown`.

**Tests added beyond the story:**
- `tests/integration/sync/forbidden-sends.test.ts` › English notification, and "names at most 5 lines but counts all": language and 5-line cap (story Adds paragraph); failed first, then passed.

**Evidence:** story tests 8/8; full suite 3045/3046, failing: push-payments.test.ts "forbids a phone creating or deleting a notification"; typecheck clean; lint 0 errors, 119 warnings (pre-existing kind)

**Follow-ups:**
- Blocking question: that test expects `prisma.notification.count()` = 2 after a batch with 2 forbidden lines; the story's own notification makes it 3. Allow narrowing it to the seeded `sync.test` notifications (count where sourceEvent = 'sync.test')? Changes are left in src/modules/sync/sync.judge.ts and the new test file, uncommitted.
- sync.push.ts needed no change (PushResponse already carries resync_required).
<!-- end SYNC-018 -->

<!-- begin SYNC-020 -->
## SYNC-020 — The list of things to resolve

- Filed: 2026-10-05 04:42 UTC
- Status: **done**: GET /sync/issues: orders and deliveries with sync_issue, scoped by author or OWNER
- Risk: medium · story: [SYNC-020-the-list-of-things-to-resolve.md](../modules/sync/SYNC-020-the-list-of-things-to-resolve.md)
- Agent: 74,335 tokens, 28 tool uses, 11 min 56 s

### Agent report

**Summary:** Added GET /api/v1/sync/issues (orders and deliveries with a non-empty sync_issue, keyset-paged, scoped by active membership and author or OWNER).

**Decisions:**
- `message`: the full stored sync_issue text (story only defines `code`); `code`: text before the first colon, trimmed; the whole text when there is no colon (many stored issues, e.g. "Livrée après annulation", have none).
- Delivery `created_at`: Delivery has no created_at column, so it uses its order's created_at (as the delivery list already does); ties by id ascending.
- Scope: orders = entered_by or delivered_by the caller; deliveries = assigned to the caller; OWNER sees all of its orgs. Always requires an ACTIVE membership in the supplier org (removed member and customer see nothing). Only OWNER is widened (manager is not, as the story says).
- Added `findIssueRows` to sync.repository.ts (the only file that may call prisma), not in the story's Modify list.
- `created_at` serialized as ISO 8601 string.

**Tests added beyond the story:**
- `tests/integration/sync/issues.test.ts` › delivered and assigned: delivered_by and delivery assigned_to branches, other-org delivery excluded (story: "entered, delivered or are assigned to"); passed at once on the implemented scope
- `tests/integration/sync/issues.test.ts` › a person who left the business, and a customer, see nothing (AB-1, v5.0.0-8.2.2)
- `tests/integration/sync/issues.test.ts` › malformed query or cursor is 400 VALIDATION_ERROR (story Errors)
- `tests/integration/sync/issues.test.ts` › requires authentication (401)

**Other additions:**
- `/api/v1/sync/issues` added to the route list in tests/integration/api-docs/catalog.test.ts (CONVENTIONS); per-001.test.ts has no sync route list, so unchanged.

**Evidence:** story tests 9/9; full suite 3046/3047 on the first run (only the lint quality-gate test failed on one unnecessary `!` in sync.service.ts, fixed; that test and api-docs re-run green); typecheck clean; lint 0 errors (118 pre-existing warnings)

**Follow-ups:**
- Confirm the code/message split for issues without a colon (whole text as code) if the phone needs stable codes.
<!-- end SYNC-020 -->

<!-- begin SYNC-021 -->
## SYNC-021 — Owner reads the synchronization exceptions grouped by cause

- Filed: 2026-10-05 04:53 UTC
- Status: **done**: GET exceptions/sync grouped by cause; orders only; reuses FIN-019 period rules
- Risk: medium · story: [SYNC-021-owner-reads-the-synchronization-exceptions.md](../modules/sync/SYNC-021-owner-reads-the-synchronization-exceptions.md)
- Agent: 82,662 tokens, 26 tool uses, 11 min 14 s

### Agent report

**Summary:** Added GET /organizations/{id}/exceptions/sync (OWNER only), grouping flagged orders by code with count, amount and persons.

**Decisions:**
- Scope: only orders' `sync_issue` (created in the period); delivery issues carry no code, so they are not grouped.
- PRICE_CHANGED amount: per line with a stale reference price and applied < current price, (current - applied) x quantity, reported as a positive loss (AC-1 says 1400); lines sold above count 0.
- CREDIT_EXCEEDED amount: parsed from the text "plafond dépassé de N" (no structured field exists); an order with several codes counts once per code.
- persons: enteredById; for CREDIT_EXCEEDED deliveredById when set (the delivery caused it). Items sorted by amount desc then code.
- Period: reused `resolveMoneyPeriod` and `moneyExceptionsQuerySchema` from finance.schemas (not in finance contracts.md; imported directly to keep FIN-019 rules identical).
- Router `syncExceptionRoutes` exported from sync.routes.ts and mounted in src/app.ts under /organizations/:organizationId.

**Tests added beyond the story:**
- `exceptions.test.ts` › several causes on one order: one order with 3 codes counts once per code, other codes amount 0 (story context)
- `exceptions.test.ts` › line sold above the current price adds nothing (story "when negative")
- `exceptions.test.ts` › corrected or unflagged orders not counted (SYNC-020 AC-3 semantics)
- `exceptions.test.ts` › unauthenticated call gets 401 (CONVENTIONS errors)

**Other additions:**
- SYNC-021 path added to tests/integration/api-docs/catalog.test.ts (convention); per-001.test.ts has no matching route list.

**Evidence:** story tests 9/9; full suite 3056/3056, failing: none; typecheck clean; lint 0 errors, 118 warnings (same as before)

**Follow-ups:**
- Sync imports finance.schemas outside a contract; consider moving the period helper to src/shared.
<!-- end SYNC-021 -->
