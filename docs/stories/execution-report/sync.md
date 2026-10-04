# Execution report: sync

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

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

- Filed: 2026-10-04 17:05 UTC
- Status: **blocked**: FK admin_actions.sync_archive_id breaks existing admin-action-table.test.ts 'accepts REPLAY_SYNC...' (uses non-existent ARCHIVE_ID); story lists no Tests to update: allow inserting an archive row in that test's setup?
- Risk: high · story: [SYNC-002-sync-archive-table.md](../modules/sync/SYNC-002-sync-archive-table.md)
- Agent: 39,027 tokens, 13 tool uses, 3 min 24 s

### Agent report

**Summary:** Blocked: implementation done and story tests green, but the new FK breaks one existing test the story does not list under "Tests to update".

**Decisions:**
- Migration 20261004320000_sync_002_sync_archives: table, FKs (person, device, admin_actions.sync_archive_id), DESC index, set_server_updated_at trigger, REVOKE UPDATE/DELETE/TRUNCATE; schema.prisma updated with comments.
- Added indexes on sync_archives(device_id) and admin_actions(sync_archive_id) for FK lookups (pattern of ADM-003).

**Tests added beyond the story:**
- `tests/integration/sync/archive-table.test.ts` › accepts a REPLAY_SYNC row pointing to an existing archive: FK allows valid link (AC-4); passed at once
- same file › rejects a missing person or device with 23502, index (person_id, received_at DESC) exists (AC-3, Context)

**Evidence:** story tests 8/8; full suite 2146/2147, failing: admin-action-table.test.ts > "accepts REPLAY_SYNC by a SUPER_ADMIN with a sync_archive_id"; typecheck clean; lint 0 errors, 60 warnings (pre-existing kind)

**Follow-ups:**
- Question: that existing test inserts REPLAY_SYNC with a non-existent ARCHIVE_ID and expects success; AC-4 makes that impossible. Fix needs the test to insert a sync_archives row first (needs person+device). I did not touch it (rule: never modify tests not listed). Allow it, or add "Tests to update" to the story.
- Work left uncommitted in the working tree (migration, schema, new test).
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
