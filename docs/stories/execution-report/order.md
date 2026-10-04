# Execution report: order

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

### Run 2026-10-04 18:46 UTC: `/implement-stories ORD-006`

| story | status | commit | note |
|---|---|---|---|
| ORD-006 Order total equals the sum of its lines | done | e1c22aa | Deferred totals/delivered-quantity triggers; 14 story tests, full suite 2234 pass |

- Run completed: ORD-006 done; it resumed the previous run's partial changes (stash popped before the run) and the story's amended "Tests to update" (6 order/finance/relationship files plus the 2 sync files).
- No stash created.
- Next: `/implement-stories next:N`.

### Run 2026-10-04 18:32 UTC: `/implement-stories ORD-006`

| story | status | commit | note |
|---|---|---|---|
| ORD-006 Order total equals the sum of its lines | blocked | 87c63f5 | Totals trigger breaks 18 tests in tests/integration/sync/pull-catalog.test.ts (7) and pull-orders.test.ts (11), not under Tests to update; may I change their fixtures (order total + line in one tx)? |

- Stash: `ORD-006 blocked: partial changes` (stash@{0}); it also holds the uncommitted "Tests to update" edit of the ORD-006 story file, made before the run.
- Run completed: 1 story, blocked on 18 sync tests (pull-catalog, pull-orders) that SYNC-006 added after the story was written and that are not under "Tests to update".
- Next: `git stash pop`, add the two sync files to the story's "Tests to update", then `/implement-stories ORD-006`.

### Run 2026-10-04 18:01 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| ORD-003 Orders only on live relationships of active organizations | done | 3fde21b | BEFORE INSERT trigger orders_creation_guard; 2048/2048 pass |
| ORD-004 Order lines table | done | 3778f01 | order_lines table with CHECKs and triggers; 25 tests pass |
| ORD-005 Order line product and minimum quantity rules | done | 947da57 | line product, minimum quantity and customer-price trigger (migration 20261004310000) |
| ORD-006 Order total equals the sum of its lines | blocked | bfcbaff | Migration and 14 story tests pass, but the new totals trigger breaks 48 existing tests in 6 files (ledger-table, line-rules, order-line-table, order-table, status-rules, contest) that build orders with arbitrary totals or lines without matching total; story has no Tests to update: may they be updated? |
| ORD-007 Order calculations and party views | done | 642d452 | Pure order calculations and supplier/customer views; 14 unit tests, full suite 2103 pass |
| ORD-008 Order state machine | done | 0c1fa3d | transitionOrder with conditional update, viaSync delivery-wins; 23 tests |
| ORD-018 Closing a business refuses its pending orders | done | bba70d2 | Pending orders refused in the close transaction; customers notified |

Not run: ORD-009..ORD-017, ORD-019..ORD-021.
Also in this run: relationship, catalog, finance, delivery, sync, privacy.

- Completed: every PLAN line was run or skipped; the run did not stop.
- Skipped, a dependency not done (via ORD-006): ORD-009 to ORD-017, ORD-019 to ORD-021, FIN-002 to FIN-020, SYNC-007.
- Skipped, a dependency not done (via DLV-002): DLV-003 to DLV-012.
- Skipped, a dependency not done (via SYNC-002, or the chains above): SYNC-009 to SYNC-023, PRIV-003.
- Stashes: "ORD-006 blocked: partial changes", "DLV-002 blocked: partial changes", "SYNC-002 blocked: partial changes".
- All three blocks have one cause: the story's new database rule breaks existing tests (ORD-006: 48 in 6 files; DLV-002: 4 in delivery-table; SYNC-002: 1 in admin-action-table), and none lists them under "Tests to update".
- Unexpected: REL-012, ORD-003 and SYNC-006 hand-backs lacked the final `<ID> <status>` line; STATUS.md said done, as their text did. No missing report file, every figure came from its notification.
- Next: add "Tests to update" to ORD-006, DLV-002 and SYNC-002, then `/implement-stories ORD-006,DLV-002,SYNC-002`, then `/implement-stories next:100`.

### Run 2026-10-04 12:26 UTC: `/implement-stories REL-004,ORD-002,ADM-008`

| story | status | commit | note |
|---|---|---|---|
| ORD-002 Order status, cancellation and delivery rules in the database | done | f62e655 | CHECKs and status trigger on orders; 1510 tests pass |

Also in this run: relationship, admin.

- Run completed: all 3 PLAN stories done, none skipped, no stash.
- Unexpected: the REL-004 and ORD-002 hand-backs held a summary instead of the one line `<ID> <status>`; STATUS.md agreed (done) in both.
- REL-004 flags: the same author cannot change a limit twice in a row (spec as written, left for REL-012); an INSERT with a non-zero credit_limit is accepted and not journaled.
- ORD-002 flags: deleting a person would violate the new CHECKs through ON DELETE SET NULL on cancelled_by_id / delivered_by_id; two integration files in one vitest command once deadlocked on shared fixture IDs.
- All figures filed from the task notifications.
- Next: /implement-stories next:N

### Run 2026-10-04 10:55 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| ORD-001 Orders table | done | bcc80d2 | orders table, enums, FKs, indexes, triggers; 16 tests |
| ORD-002 Order status, cancellation and delivery rules in the database | blocked | 305910b | Story tests pass (35/35) but 2 ORD-001 tests in order-table.test.ts contradict C-16/C-17: 'accepts every documented status' (DELIVERED/CANCELLED/PENDING inserted without their columns) and 'accepts delivered_by_id and cancelled_by_id of a registered person' (set on CONFIRMED). Not under Tests to update: list them, or say how to proceed |

Not run: ORD-003..ORD-021.
Also in this run: relationship, admin, catalog, finance, delivery.

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

### Run 2026-10-04 04:48 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| ORD-001 Orders table | todo | - |  |
| ORD-002 Order status, cancellation and delivery rules in the database | todo | - |  |
| ORD-003 Orders only on live relationships of active organizations | todo | - |  |
| ORD-004 Order lines table | todo | - |  |
| ORD-005 Order line product and minimum quantity rules | todo | - |  |
| ORD-006 Order total equals the sum of its lines | todo | - |  |
| ORD-007 Order calculations and party views | todo | - |  |
| ORD-008 Order state machine | todo | - |  |
| ORD-009 Customer places an order | todo | - |  |
| ORD-010 Organization manager orders from a supplier | todo | - |  |
| ORD-011 Supplier accepts an order, lowering prices if needed | todo | - |  |
| ORD-012 Supplier refuses an order | todo | - |  |
| ORD-013 Seller enters an order for a customer | todo | - |  |
| ORD-014 Seller edits an order they entered, before departure | todo | - |  |
| ORD-015 Seller writes a note on an order at any time | todo | - |  |
| ORD-016 Supplier cancels an order before departure | todo | - |  |
| ORD-017 Customer cancels an order before departure | todo | - |  |
| ORD-018 Closing a business refuses its pending orders | todo | - |  |
| ORD-019 Seller lists the orders | todo | - |  |
| ORD-020 Seller opens one order | todo | - |  |
| ORD-021 Customer lists and opens their orders | todo | - |  |

Also in this run: relationship, admin, catalog, finance, delivery.

- Stopped after REL-002: blocked, a REL-001 test (`relationship-table.test.ts` › "rejects an unknown merged_into_id with 23503 and accepts an existing one") conflicts with the new CHECKs and the story does not list it under "Tests to update".
- Not reached: REL-003 to DLV-009 (98 stories), because the run stopped on the block; no `--keep-going`.
- Nothing unexpected: the agent report and the notification figures both came in.
- REL-002's migration, test file and schema.prisma comment are left uncommitted in the working tree, waiting for the human decision.
- Next: decide whether that REL-001 test may be updated (amend REL-002's "Tests to update"), then `/implement-stories REL-002` and `/implement-stories next:100`.

<!-- begin ORD-001 -->
## ORD-001 — Orders table

- Filed: 2026-10-04 09:55 UTC
- Status: **done**: orders table, enums, FKs, indexes, triggers; 16 tests
- Risk: medium · story: [ORD-001-orders-table.md](../modules/order/ORD-001-orders-table.md)
- Agent: 42,422 tokens, 14 tool uses, 11 min 10 s

### Agent report

**Summary:** Added the `orders` table (model Order, migration 20261004220000_ord_001_orders) with enums, FKs, indexes and triggers.

**Decisions:**
- Enum names: new `OrderParty` (CUSTOMER/SUPPLIER, used by placed_by_party and cancelled_by_party) and `OrderStatus`; not reusing RelationshipParty to keep modules independent.
- Invalid enum values are asserted as 22P02 (story says only "rejects").
- Text columns (notes, reason, sync_issue) use `@db.Text`; FKs keep Prisma defaults (nullable ones ON DELETE SET NULL).
- Registered-person guard is a deferred constraint trigger (as REL/CAT tables), so the guest check fires at commit.

**Tests added beyond the story:**
- `tests/integration/order/order-table.test.ts` › accepts every documented status: all 5 status values insertable (Order.status:enum); passed at once
- same file › delivered_by_id/cancelled_by_id guest rejected 23514 and registered accepted (C-04); null delivery_cost/status 23502 (Order:required); server_updated_at moves on update (C-35); indexes exist

**Evidence:** story tests 16/16; full suite 1332/1332, failing: none; typecheck clean; lint 0 errors, 55 warnings (pre-existing)
<!-- end ORD-001 -->

<!-- begin ORD-002 -->
## ORD-002 — Order status, cancellation and delivery rules in the database

- Filed: 2026-10-04 12:26 UTC
- Status: **done**: CHECKs and status trigger on orders; 1510 tests pass
- Risk: high · story: [ORD-002-order-status-cancellation-and-delivery-rules-in.md](../modules/order/ORD-002-order-status-cancellation-and-delivery-rules-in.md)
- Agent: 53,549 tokens, 17 tool uses, 16 min 7 s

### Agent report

**Summary:** Added migration 20261004280000_ord_002_status_rules (6 CHECKs + BEFORE UPDATE status trigger), status-rules tests, updated the 3 listed order-table tests and the Order comment in schema.prisma.

**Decisions:**
- "sync_issue set in the same update": trigger requires NEW.sync_issue IS NOT NULL (not that it differs from OLD); the story does not say more.
- CANCELLED to DELIVERED: the trigger clears the four cancellation columns itself, so a caller cannot leave half a cancellation behind; the CHECKs still guard it.
- "Reason empty" is read as NULL (no blank-string rule invented).
- Frozen check compares to_jsonb(NEW) and to_jsonb(OLD) minus supplier_note, sync_issue, server_updated_at, so deleted_at and every other column are frozen too (as the story says: "otherwise only").
- DELIVERED to any other status is refused (only DELIVERED to CANCELLED is named, but the step list is exhaustive).

**Tests added beyond the story:**
- `status-rules.test.ts` › cancellation columns: person empty, party empty, cancelled_by_id / cancelled_at on CONFIRMED (C-16 "all set iff CANCELLED"); passed with the migration
- `status-rules.test.ts` › moving a supplier-placed order to PENDING (C-17 on UPDATE)
- `status-rules.test.ts` › steps: PENDING to IN_DELIVERY, CONFIRMED to PENDING, IN_DELIVERY to PENDING, DELIVERED to CONFIRMED, CANCELLED to PENDING refused (CM-12 permitted steps only)
- `status-rules.test.ts` › CANCELLED to DELIVERED clears the cancellation columns; non-frozen order stays editable
- `status-rules.test.ts` › crafted updates: revive with cleared columns, edit total/delivered_at/deleted_at of DELIVERED, cancel DELIVERED with cancellation columns filled (AB-1)

**Other additions:**
- schema.prisma: plain-language comment above `Order` for the new rules (CLAUDE.md rule).

**Evidence:** story tests 42/42 (order-table 16/16); full suite 1510/1510, failing: none; typecheck clean; lint 0 errors, 57 warnings (existing)

**Follow-ups:**
- FK `cancelled_by_id`/`delivered_by_id` use ON DELETE SET NULL; deleting a person would now violate the pair CHECKs (people are not deleted today).
- Running two integration files in one vitest command once gave a deadlock on shared fixture IDs; single files and the full suite are fine.
<!-- end ORD-002 -->

<!-- begin ORD-003 -->
## ORD-003 — Orders only on live relationships of active organizations

- Filed: 2026-10-04 16:24 UTC
- Status: **done**: BEFORE INSERT trigger orders_creation_guard; 2048/2048 pass
- Risk: high · story: [ORD-003-orders-only-on-live-relationships-of-active.md](../modules/order/ORD-003-orders-only-on-live-relationships-of-active.md)
- Agent: 38,446 tokens, 17 tool uses, 11 min 48 s

### Agent report

**Summary:** Added BEFORE INSERT trigger on orders refusing non-ACTIVE/deleted relationships and non-ACTIVE supplier orgs (23514); done.

**Decisions:**
- Unknown relationship id: the trigger lets it through so the foreign key still answers 23503 (existing order-table test expects it); still fails closed.
- No row lock on the relationship/organization in the trigger: a concurrent suspension could race an insert; ORD-018 covers closing a business.
- "Supplier organization not null": a person-supplier relationship is always PENDING (existing CHECK), so it is refused by the status test; no separate ACTIVE-with-person case is reachable.

**Other additions:**
- Rule comment added above model Order in `prisma/schema.prisma` (CLAUDE.md rule for rules outside the schema).

**Evidence:** story tests 9/9; full suite 2048/2048, failing: none; typecheck clean; lint 0 errors, 59 warnings (pre-existing)

**Follow-ups:**
- I edited the migration after a first run, so I dropped the trigger and re-applied the migration on the test DB by hand (docker exec); other local DBs that applied the first version need the same.
<!-- end ORD-003 -->

<!-- begin ORD-004 -->
## ORD-004 — Order lines table

- Filed: 2026-10-04 16:28 UTC
- Status: **done**: order_lines table with CHECKs and triggers; 25 tests pass
- Risk: high · story: [ORD-004-order-lines-table.md](../modules/order/ORD-004-order-lines-table.md)
- Agent: 46,480 tokens, 14 tool uses, 3 min 52 s

### Agent report

**Summary:** Created `order_lines` (migration 20261004300000_ord_004_order_lines, Prisma model with plain-language rules comment) with the amount, quantity and price-gap CHECKs and the two triggers.

**Decisions:**
- "customer orders" test row: the story lists no database rule tying lines to the order's placed_by_party, so the test checks that on a CUSTOMER order an equal price is accepted and any gap without author is refused (23514); "never raised afterward" is left to ORD-005 (noted in the schema comment).
- Foreign keys use ON DELETE RESTRICT, like the sibling tables; price_set_by_id stays RESTRICT (SET NULL would break the gap-author CHECK).
- Gap/author CHECK also forces price_set_by_id and price_set_at to be both set or both empty, which is the "set if and only if" reading of C-20.

**Tests added beyond the story:**
- `order-line-table.test.ts` › rejects an amount that no longer matches after an update: an UPDATE of quantity alone is refused (C-20); passed at once (CHECK covers updates)
- `order-line-table.test.ts` › rejects a guest as the price author with 23514: C-04 deferred registered-person guard; passed at once once the trigger existed
- `order-line-table.test.ts` › negative prices, negative delivered_quantity, author without time or time without author, author on equal price: the story's CHECKs; passed at once
- `order-line-table.test.ts` › rejects an unknown price author with 23503: AC-4 FK on price_set_by_id

**Evidence:** story tests 25/25; full suite 2073/2073, failing: none; typecheck clean; lint 0 errors, 59 warnings (pre-existing)

**Follow-ups:**
- `prisma migrate diff` lists FK on-delete noise for order_lines (as for other tables with the same RESTRICT pattern); not a new drift class.
- Rule "customer-placed order price never raised afterward" is not in the database; ORD-005 must enforce it.
<!-- end ORD-004 -->

<!-- begin ORD-005 -->
## ORD-005 — Order line product and minimum quantity rules

- Filed: 2026-10-04 16:32 UTC
- Status: **done**: line product, minimum quantity and customer-price trigger (migration 20261004310000)
- Risk: high · story: [ORD-005-order-line-product-and-minimum-quantity-rules.md](../modules/order/ORD-005-order-line-product-and-minimum-quantity-rules.md)
- Agent: 38,794 tokens, 10 tool uses, 3 min 24 s

### Agent report

**Summary:** Added trigger order_lines_enforce_rules (migration 20261004310000_ord_005_line_rules) for product, minimum quantity and customer-price rules.

**Decisions:**
- Unknown order or product: trigger returns NEW and leaves it to the foreign keys (23503), as ORD-003 does.
- Relationship with a person supplier: any product refused (23514), since a person has no products.
- Update on a customer order: only `unit_price_applied > reference_price` is refused, so a lowering with author passes (AC-4).
- Updated the OrderLine comment in schema.prisma: it said ORD-005 routes enforce the no-raise rule; it now describes the trigger.

**Tests added beyond the story:**
- `line-rules.test.ts` › no minimum on the product: any quantity accepted (AC-2 only covers a product with a minimum); passed at once
- `line-rules.test.ts` › person-supplier relationship: product refused (C-15, ORD-003 migration comment)
- `line-rules.test.ts` › customer-order line updatable after product deleted (AC-3); passed at once
- `line-rules.test.ts` › supplier-order line with a price gap accepted (CM-16, only customer orders limited); passed at once
- `line-rules.test.ts` › lowered price, then reference lowered below it: refused (C-20, never above reference)

**Evidence:** story tests 16/16; full suite 2089/2089, failing: none; typecheck clean; lint 0 errors, 59 warnings (existing)
<!-- end ORD-005 -->

<!-- begin ORD-006 -->
## ORD-006 — Order total equals the sum of its lines

- Filed: 2026-10-04 18:46 UTC
- Status: **done**: Deferred totals/delivered-quantity triggers; 14 story tests, full suite 2234 pass
- Risk: high · story: [ORD-006-order-total-equals-the-sum-of-its-lines.md](../modules/order/ORD-006-order-total-equals-the-sum-of-its-lines.md)
- Agent: 39,376 tokens, 10 tool uses, 6 min 0 s

### Agent report

**Summary:** Deferred constraint triggers on orders and order_lines (totals and delivered quantities), schema comments, all listed fixtures updated, including the two sync files the amended story now lists.

**Decisions:**
- Migration, schema comments and the first 6 test files were already in the working tree from the earlier blocked run; I kept them and finished the sync fixtures.
- pull-orders `seedOrder`: nested `lines: { create }`; new option `freeLine` (prices, amount and total 0) used only for the IN_DELIVERY order, as the story asks.
- Price-author test: line update and order total update in one `prisma.$transaction`.

**Tests added beyond the story:**
- `tests/integration/order/total-check.test.ts` › no-lines total mismatch, removing a line, soft-deleted line ignored, moving a line to another order, DELIVERED accepted with quantities: trigger edge cases (AC-2, AC-3, C-19); written before this run, they pass.

**Evidence:** story tests 14/14; full suite 2234/2234, failing: none; typecheck clean; lint 0 errors, 62 warnings

**Follow-ups:**
- Any later story that writes lines or totals must change both in one transaction (23514 otherwise); ORD-007 and order-creation code must respect it.
<!-- end ORD-006 -->

<!-- begin ORD-007 -->
## ORD-007 — Order calculations and party views

- Filed: 2026-10-04 16:42 UTC
- Status: **done**: Pure order calculations and supplier/customer views; 14 unit tests, full suite 2103 pass
- Risk: medium · story: [ORD-007-order-calculations-and-party-views.md](../modules/order/ORD-007-order-calculations-and-party-views.md)
- Agent: 28,895 tokens, 10 tool uses, 3 min 9 s

### Agent report

**Summary:** Added order.calculations.ts and order.views.ts (pure, no DB) with unit tests; all green.

**Decisions:**
- OrderWithLines: defined as Prisma `Order & { lines: OrderLine[] }` in order.views.ts (story left it open).
- View shape: snake_case keys, money as JSON numbers (like catalog), quantities as decimal strings, dates as ISO strings (date-only for desired_delivery_date), so views are JSON-serializable.
- Price author: only OWNER/MANAGER get price_set_by_id/price_set_at; any other or unknown role gets neither (fail closed).
- Notes (customer_note, supplier_note) and parent_order_id stay in the customer view (MODULE.md: notes visible to both parties).

**Tests added beyond the story:**
- `tests/unit/order/calculations-and-views.test.ts` › DRIVER and unknown role: price author hidden like SELLER (v5.0.0-8.2.3, fail closed); passed at once
- same file › delivered quantity 0 is used, not the ordered one (CM-14 "when set"); passed at once
- same file › customer view exact key list (v5.0.0-15.3.1 explicit fields); passed at once
- same file › views JSON-serializable (no bigint leak); passed at once

**Evidence:** story tests 14/14; full suite 2103/2103, failing: none; typecheck clean; lint 0 errors, 59 warnings (pre-existing)
<!-- end ORD-007 -->

<!-- begin ORD-008 -->
## ORD-008 — Order state machine

- Filed: 2026-10-04 16:48 UTC
- Status: **done**: transitionOrder with conditional update, viaSync delivery-wins; 23 tests
- Risk: high · story: [ORD-008-order-state-machine.md](../modules/order/ORD-008-order-state-machine.md)
- Agent: 41,304 tokens, 14 tool uses, 6 min 15 s

### Agent report

**Summary:** Added transitionOrder (order.state.ts) and order.repository.ts with conditional status updates; all story tests pass.

**Decisions:**
- Conditional UPDATE: used Prisma `updateMany` with `status in allowedFrom` (one atomic statement) plus a read-back in the same tx, instead of raw `UPDATE ... RETURNING *` (avoids snake_case/bigint mapping).
- viaSync: normal step is tried first; only if it updates nothing, a second conditional update handles CANCELLED to DELIVERED (sets sync_issue, clears cancellation columns) or DELIVERED to CANCELLED (sync_issue only, order returned unchanged). Normal syncs never get a sync_issue.
- Reason is trimmed; a blank reason counts as missing for SUPPLIER. A reason sent for a non-cancel target is ignored.
- Unknown order id: 404 NOT_FOUND (story only lists 409/400).

**Tests added beyond the story:**
- `tests/integration/order/state-machine.test.ts` › answers 404 NOT_FOUND for an unknown order: fail-closed on absent id (CONVENTIONS errors); passed at once? no, written with the implementation
- `...` › lets a CUSTOMER cancel without a reason: C-16 reason only required for SUPPLIER
- `...` › does not set sync_issue when sync delivers a CONFIRMED order normally; refuses delivery-after-cancellation without viaSync; still refuses other impossible steps through sync: viaSync scope limits (story Context)

**Evidence:** story tests 23/23; full suite 2126/2126 after fixing a lint error in my test (first run 2125/2126, quality-gates lint), failing: none; typecheck clean; lint 0 errors, 60 pre-existing warnings
<!-- end ORD-008 -->

<!-- begin ORD-009 -->
## ORD-009 — Customer places an order

- Filed: 2026-10-04 19:31 UTC
- Status: **done**: POST /api/v1/orders; 35 story tests + full suite green
- Risk: high · story: [ORD-009-customer-places-an-order.md](../modules/order/ORD-009-customer-places-an-order.md)
- Agent: 81,181 tokens, 22 tool uses, 8 min 36 s

### Agent report

**Summary:** Added POST /api/v1/orders (customer places a PENDING order, server-side prices, relationship ensured, team notified) in one transaction.

**Decisions:**
- Notification text: fixed FR/EN "new order received" per recipient language (no customer name, so no personal data); related = order id.
- Duplicate line ids in one body: rejected with 400 by a schema refine (else the primary key would give a 500).
- Min-quantity check done in the service (400 VALIDATION_ERROR) before the DB trigger, which would answer with a raw check error.
- Response lines are returned in request order.
- Quantity accepts string or number, canonicalised by the schema (same rule as catalog min_order_quantity, re-implemented locally to avoid a cross-module import).
- No OpenAPI paths or catalog.test/per-001 additions: ORD-019 owns OpenAPI registration (story "Out of scope").

**Tests added beyond the story:**
- `place-order.test.ts` › accepts exactly 100 lines: limit boundary (AC-4)
- `place-order.test.ts` › requires authentication: 401 deny by default (CONVENTIONS); passed at once
- `place-order.test.ts` › refuses an unknown business with 404: assertOrganizationActive contract; passed at once
- `place-order.test.ts` › duplicate line id / negative / 1e3 quantity: malformed input 400 (AC-4)
- `place-order.test.ts` › always orders as the caller: AB-2 positive side; body address overrides default (Context)

**Other additions:**
- `runInTransaction`, `insertPendingOrder`, `listOrderTeamIds` in order.repository.ts: only file allowed to call prisma.

**Evidence:** story tests 35/35; full suite 2297/2297, failing: none; typecheck clean; lint 0 errors, 62 warnings (none new; one new object-injection warning removed)

**Follow-ups:**
- The same order id sent by two different people hits the primary key (500); the story gives no code for it.
<!-- end ORD-009 -->

<!-- begin ORD-018 -->
## ORD-018 — Closing a business refuses its pending orders

- Filed: 2026-10-04 16:53 UTC
- Status: **done**: Pending orders refused in the close transaction; customers notified
- Risk: medium · story: [ORD-018-closing-a-business-refuses-its-pending-orders.md](../modules/order/ORD-018-closing-a-business-refuses-its-pending-orders.md)
- Agent: 54,634 tokens, 13 tool uses, 3 min 55 s

### Agent report

**Summary:** closeOrganization now refuses every PENDING order of the business in the same transaction and notifies registered customers.

**Decisions:**
- Added `lockPendingOrders` (SELECT ... FOR UPDATE, raw parameterized SQL) beside `refusePendingOrders` (signature kept, returns count): locks rows and gives the customers to notify, so a parallel confirm cannot slip between read and update.
- `refusePendingOrders` is one updateMany applying the same fields as `transitionOrder` PENDING to CANCELLED, not a call to it: order.state imports the repository (cycle) and one UPDATE covers the whole business.
- One `order.status_changed` per refused order (related = the order), so a customer with two pending orders gets two; AC-2 does not say.
- Guest customers (no registered_at) are refused but not notified, because `notify` rejects guests and would roll the close back.
- Mismatch between locked and refused counts throws 409 CONFLICT (unreachable while the rows are locked, fail closed).

**Tests added beyond the story:**
- `close-refuses-pending.test.ts` › pending order of another business is untouched: tenant scope (CONVENTIONS scope rules); passed at once
- `close-refuses-pending.test.ts` › guest customer refused without notification, close succeeds: guest recipients cannot be notified (notify contract)

**Evidence:** story tests 20/20 (6 new + 14 close); full suite 2132/2132, failing: none; typecheck clean; lint 0 errors, 60 warnings (pre-existing)

**Follow-ups:**
- order/contracts.md does not list `refusePendingOrders`; organization imports order.repository directly as the story's Implementation says.
<!-- end ORD-018 -->
