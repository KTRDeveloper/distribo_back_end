# Execution report: delivery

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

### Run 2026-10-04 19:09 UTC: `/implement-stories DLV-002`

| story | status | commit | note |
|---|---|---|---|
| DLV-002 Delivery state rules in the database | done | 02db210 | CHECKs, partial unique index, driver membership trigger; delivery-table tests updated per amended story |

- Run completed.
- Resumed from the DLV-002 partial changes (stash popped before the run); the story gained a "Tests to update" section for 4 delivery-table.test.ts fixtures before the run, committed with the story.
- Next: `/implement-stories next:N`.

### Run 2026-10-04 18:01 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| DLV-002 Delivery state rules in the database | blocked | bc49604 | DLV-001 tests in delivery-table.test.ts (4) contradict DLV-002 (no collaboration; two in-progress deliveries); story lists no Tests to update, may I amend them? |

Not run: DLV-003..DLV-012.
Also in this run: relationship, catalog, order, finance, sync, privacy.

- Completed: every PLAN line was run or skipped; the run did not stop.
- Skipped, a dependency not done (via ORD-006): ORD-009 to ORD-017, ORD-019 to ORD-021, FIN-002 to FIN-020, SYNC-007.
- Skipped, a dependency not done (via DLV-002): DLV-003 to DLV-012.
- Skipped, a dependency not done (via SYNC-002, or the chains above): SYNC-009 to SYNC-023, PRIV-003.
- Stashes: "ORD-006 blocked: partial changes", "DLV-002 blocked: partial changes", "SYNC-002 blocked: partial changes".
- All three blocks have one cause: the story's new database rule breaks existing tests (ORD-006: 48 in 6 files; DLV-002: 4 in delivery-table; SYNC-002: 1 in admin-action-table), and none lists them under "Tests to update".
- Unexpected: REL-012, ORD-003 and SYNC-006 hand-backs lacked the final `<ID> <status>` line; STATUS.md said done, as their text did. No missing report file, every figure came from its notification.
- Next: add "Tests to update" to ORD-006, DLV-002 and SYNC-002, then `/implement-stories ORD-006,DLV-002,SYNC-002`, then `/implement-stories next:100`.

### Run 2026-10-04 10:55 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| DLV-001 Deliveries table | done | 9e83843 | deliveries table, triggers and tests green |

Not run: DLV-002..DLV-010.
Also in this run: relationship, admin, catalog, order, finance.

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
| DLV-001 Deliveries table | todo | - |  |
| DLV-002 Delivery state rules in the database | todo | - |  |
| DLV-003 Driver sees the orders to deliver | todo | - |  |
| DLV-004 Manager assigns an order to a driver | todo | - |  |
| DLV-005 Driver departs with an order | todo | - |  |
| DLV-006 Driver reports a failed delivery | todo | - |  |
| DLV-007 "Commande livrée": deliver a whole order and record the sale and the payment | todo | - |  |
| DLV-008 Deliver only part of an order and settle the rest | todo | - |  |
| DLV-009 Seller validates a counter sale | todo | - |  |

Also in this run: relationship, admin, catalog, order, finance.

- Stopped after REL-002: blocked, a REL-001 test (`relationship-table.test.ts` › "rejects an unknown merged_into_id with 23503 and accepts an existing one") conflicts with the new CHECKs and the story does not list it under "Tests to update".
- Not reached: REL-003 to DLV-009 (98 stories), because the run stopped on the block; no `--keep-going`.
- Nothing unexpected: the agent report and the notification figures both came in.
- REL-002's migration, test file and schema.prisma comment are left uncommitted in the working tree, waiting for the human decision.
- Next: decide whether that REL-001 test may be updated (amend REL-002's "Tests to update"), then `/implement-stories REL-002` and `/implement-stories next:100`.

<!-- begin DLV-001 -->
## DLV-001 — Deliveries table

- Filed: 2026-10-04 10:54 UTC
- Status: **done**: deliveries table, triggers and tests green
- Risk: medium · story: [DLV-001-deliveries-table.md](../modules/delivery/DLV-001-deliveries-table.md)
- Agent: 37,258 tokens, 15 tool uses, 13 min 4 s

### Agent report

**Summary:** Added `deliveries` table (migration 20261004260000_dlv_001_deliveries), Delivery model and relations, and the integration test file.

**Decisions:**
- FK delete rule: ON DELETE RESTRICT on order_id and assigned_to_id, matching the orders and handovers migrations.
- `failure_reason` and `sync_issue` typed TEXT (story says string, no length given), as in orders.
- `require_registered_person` is a deferred constraint trigger, like the other author columns, so 23514 shows at commit.

**Tests added beyond the story:**
- `tests/integration/delivery/delivery-table.test.ts` › allows several attempts for the same order: one row per attempt (story: "one row per attempt"); passed at once
- same file › rejects an unknown assigned_to_id with 23503, rejects a null order_id with 23502, accepts a registered driver, moves server_updated_at forward on update, has indexes: Delivery:fk / Delivery:required / C-35 / Context; passed at once after the migration

**Evidence:** story tests 10/10; full suite 1431/1431, failing: none; typecheck clean; lint 0 errors, 57 warnings (existing)
<!-- end DLV-001 -->

<!-- begin DLV-002 -->
## DLV-002 — Delivery state rules in the database

- Filed: 2026-10-04 19:09 UTC
- Status: **done**: CHECKs, partial unique index, driver membership trigger; delivery-table tests updated per amended story
- Risk: high · story: [DLV-002-delivery-state-rules-in-the-database.md](../modules/delivery/DLV-002-delivery-state-rules-in-the-database.md)
- Agent: 28,776 tokens, 9 tool uses, 6 min 2 s

### Agent report

**Summary:** Migration with two CHECKs, partial unique index and BEFORE INSERT membership trigger; delivery-table fixture updated as the amended story lists.

**Decisions:**
- failure_reason CHECK: a blank string (after trim) counts as no reason, so "failure_reason empty" rejects with failed_at set.
- Trigger skips the check when order or driver does not exist, so the foreign keys keep answering 23503 (existing delivery-table tests).
- Trigger fires on INSERT only and ignores soft-deleted collaborations (deleted_at not null); schema.prisma comment documents the rules.

**Tests added beyond the story:**
- `delivery-rules.test.ts` › rejects an update that sets both outcomes: the CHECK also guards UPDATE (C-21)
- `delivery-rules.test.ts` › allows an in-progress delivery on another order: index is per order (AC-2); passed at once
- `delivery-rules.test.ts` › rejects a collaborator whose membership is deleted / registered person with no collaboration (C-21 ACTIVE collaborator)
- `delivery-rules.test.ts` › lets only one of two concurrent inserts through: race guard (AB-1, CWE-362)

**Other additions:**
- schema.prisma comment above Delivery describing the DB-enforced rules (CLAUDE.md rule).

**Evidence:** story tests 30/30 (delivery folder, both files); full suite 2254/2254, failing: none; typecheck clean; lint 0 errors, 62 warnings (existing)

**Follow-ups:**
- The story file in the working tree carries the "Tests to update" section added before this run (uncommitted).
<!-- end DLV-002 -->

<!-- begin DLV-003 -->
## DLV-003 — Driver sees the orders to deliver

- Filed: 2026-10-04 20:39 UTC
- Status: **done**: Driver to-deliver pool and own deliveries; tests green
- Risk: high · story: [DLV-003-driver-sees-the-orders-to-deliver.md](../modules/delivery/DLV-003-driver-sees-the-orders-to-deliver.md)
- Agent: 73,470 tokens, 24 tool uses, 6 min 18 s

### Agent report

**Summary:** Added GET to-deliver and mine routes for drivers (any active member), with projectForDriver customer part; done.

**Decisions:**
- Delivery has no created_at: `mine` is ordered by the order's created_at desc then delivery id, cursor carries that pair.
- `mine` status: in_progress = neither arrived nor failed (assigned-not-departed included), done = arrived, failed = failed; no status returns all; deleted deliveries excluded.
- Pool keeps CONFIRMED + non-null address only; no exclusion of orders already assigned (story does not say).
- No 403 path: every role is DRIVER or above, so loadActor (404 for non-members) is the only gate.
- Items carry an extra `delivery_id` in `mine`; line field `label` is `label_applied`.

**Tests added beyond the story:**
- `driver-lists.test.ts` › deleted order never listed, deleted delivery never listed: soft-delete scope (story: "not deleted"); passed at once
- `driver-lists.test.ts` › open to every role, 401 without token, strict query 400: deny-by-default and input limits (CONVENTIONS); passed at once
- `driver-lists.test.ts` › pages mine without repeats, lists nothing of this business to the other: AC-5, AB-2 on mine; passed at once

**Other additions:**
- `delivery.schemas.ts`, `delivery.views.ts`: query schemas and explicit-field projections (not in the Create list).
- `scripts/generate-openapi.ts` imports `delivery.openapi.js`, else generate-script test fails; DLV-003 paths added to `catalog.test.ts`. per-001 has no org routes, so untouched.

**Evidence:** story tests 14/14; full suite 2478/2479 before the generate-script fix, that test then passed (api-docs 28/28); typecheck clean; lint 0 errors, 62 pre-existing warnings

**Follow-ups:**
- Orders already assigned to a driver stay in the pool until they leave CONFIRMED; confirm this is intended for DLV-004.
<!-- end DLV-003 -->

<!-- begin DLV-004 -->
## DLV-004 — Manager assigns an order to a driver

- Filed: 2026-10-04 20:45 UTC
- Status: **done**: assign route, reassign before departure, 25 tests
- Risk: medium · story: [DLV-004-manager-assigns-an-order-to-a-driver.md](../modules/delivery/DLV-004-manager-assigns-an-order-to-a-driver.md)
- Agent: 66,922 tokens, 24 tool uses, 5 min 29 s

### Agent report

**Summary:** POST .../orders/{orderId}/assign implemented (assign, reassign on the same row, refusals, idempotent repeat); done.

**Decisions:**
- Check order inside one tx after locking the order row: 404 order, 409 DELIVERY_IN_PROGRESS (departed), 409 INVALID_TRANSITION, 400 no address, 404 driver. Departed check comes before status so a departed delivery always answers DELIVERY_IN_PROGRESS.
- "Delivery in progress" = not arrived, not failed, not deleted; after a failed one a new delivery row is created (one per attempt).
- Driver = ACTIVE collaborator of the caller's org, any role, registered person; otherwise 404.
- Notification `delivery.assigned` related to the order (type `order`); the previous driver is not notified on reassign (story silent).
- Route uses requireAbility('assign','Delivery') so OWNER also passes (role hierarchy); strict validation before idempotent().
- delivery.schemas.ts already existed: modified, not created.

**Tests added beyond the story:**
- `tests/integration/delivery/assign.test.ts` › OWNER assigns, any-role collaborator, PENDING/IN_DELIVERY orders, revoked/invited/other-org driver, other-business order, other-org member 404, strict-body 400s, 401, new delivery after a failed one (C-21, CONVENTIONS errors/scope); passed at once after implementation

**Other additions:**
- catalog.test.ts: assign path entry (CONVENTIONS rule). Added `projectDelivery` view and repository helpers (lockOrderToAssign etc.).

**Evidence:** story tests 25/25; full suite 2504/2504, failing: none; typecheck clean; lint 0 errors, 62 warnings (pre-existing)

**Follow-ups:**
- A client gesture id equal to an existing delivery id of another order would surface as 500 (primary key); not mapped.
<!-- end DLV-004 -->

<!-- begin DLV-005 -->
## DLV-005 — Driver departs with an order

- Filed: 2026-10-04 23:10 UTC
- Status: **done**: depart route, 21 tests; full suite 2757 green
- Risk: high · story: [DLV-005-driver-departs-with-an-order.md](../modules/delivery/DLV-005-driver-departs-with-an-order.md)
- Agent: 69,808 tokens, 19 tool uses, 5 min 18 s

### Agent report

**Summary:** Added `POST .../orders/{orderId}/depart` (`departWithOrder`): one transaction under the order row lock, `transitionOrder` to IN_DELIVERY, delivery created or marked departed, customer notified.

**Decisions:**
- Manager or owner takes over an order assigned to another driver: the same row gets `departed_at` and `assigned_to_id` becomes the caller, so the person on the road owns the delivery (the story is silent on this case).
- Order already IN_DELIVERY, or a delivery already departed, gives DELIVERY_IN_PROGRESS even for the same driver; checked before INVALID_TRANSITION, which covers PENDING, DELIVERED and CANCELLED.
- Customer recipient is read through a new repository function (relationship person, else the person who entered the order, only if registered), because order.service's helper is not a contract export; a guest gets no notification.
- Reused `lockOrderToAssign` and `findDeliveryInProgress` from DLV-004 for the lock, so the race loser sees IN_DELIVERY and gets 409.
- `requireAbility('depart','Order')` checks the role only; the status condition is enforced by the service under the lock. SELLER passes the route check because the ability ranks SELLER above DRIVER (ACC rule, unchanged).

**Tests added beyond the story:**
- `depart.test.ts` › notifies the customer order.status_changed: the notification the story requires (Context)
- `depart.test.ts` › lets a MANAGER / an OWNER depart with an order assigned to another driver: the takeover branch (Context)
- `depart.test.ts` › departs with an order whose earlier delivery failed: a failed delivery does not count as in progress (C-21)
- `depart.test.ts` › 400 for unknown field, missing id, malformed id, and 401 without a token: strict body, deny by default (CONVENTIONS validation)
- `depart.test.ts` › answers 404 to a member of another business: also covers a cross-path attempt, and an own-business success

**Other additions:**
- `departSchema`, `markDeparted`, `insertDepartedDelivery`, `findRegisteredCustomerRecipient`, the OpenAPI path and the route line in `catalog.test.ts` (convention: a route story adds its path there)

**Evidence:** story tests 21/21; full suite 2757/2757, failing: none; typecheck clean; lint 0 errors, 65 warnings (all existing, none in the delivery files)

**Follow-ups:**
- Confirm the takeover rule (`assigned_to_id` becomes the manager or owner) when DLV-006 and DLV-007 read the delivery's driver.
<!-- end DLV-005 -->

<!-- begin DLV-006 -->
## DLV-006 — Driver reports a failed delivery

- Filed: 2026-10-04 23:16 UTC
- Status: **done**: POST deliveries/{id}/fail, 23 story tests, full suite green
- Risk: medium · story: [DLV-006-driver-reports-a-failed-delivery.md](../modules/delivery/DLV-006-driver-reports-a-failed-delivery.md)
- Agent: 66,336 tokens, 18 tool uses, 5 min 23 s

### Agent report

**Summary:** Added POST /deliveries/{deliveryId}/fail (route, schema, service, repository, openapi); all green.

**Decisions:**
- Delivery not yet departed (assigned only): 409 INVALID_TRANSITION, since "in progress" for a failure means on the road.
- Order locked first (via the delivery's supplier join), then the delivery is read, so parallel fail/arrive/depart serialize.
- Owner and every manager are notified, including the caller if they are one (literal reading of the story).
- Response `delivery` extends the DeliveryView with `failed_at` and `failure_reason` (new FailedDeliveryView).
- Reason is trimmed; whitespace-only is 400.
- Catalog test got the new path (counts as listed); per-001 has no route list, so unchanged.

**Tests added beyond the story:**
- `fail.test.ts` › parallel failures: one 200, one 409, notified once (race, v5.0.0-2.3.4)
- `fail.test.ts` › MANAGER/OWNER may fail another driver's delivery; notification to owner and managers; not-departed delivery 409; 2000-char boundary; foreign business 404 (story Context and CONFIRM rules); passed at once for the boundary cases

**Evidence:** story tests 23/23; full suite 2780/2780, failing: none; typecheck clean; lint 0 errors, 65 warnings (pre-existing security/detect-non-literal-fs-filename)
<!-- end DLV-006 -->

<!-- begin DLV-007 -->
## DLV-007 — "Commande livrée": deliver a whole order and record the sale and the payment

- Filed: 2026-10-04 23:23 UTC
- Status: **done**: deliver route, credit rule under relationship lock; error details support added to httpError
- Risk: high · story: [DLV-007-commande-livree-deliver-a-whole-order-and.md](../modules/delivery/DLV-007-commande-livree-deliver-a-whole-order-and.md)
- Agent: 107,529 tokens, 31 tool uses, 7 min 16 s

### Agent report

**Summary:** Added POST .../orders/{orderId}/deliver (deliverOrder): one transaction, order then relationship row locked, credit rule, SALE and optional PAYMENT, customer notified.

**Decisions:**
- `details.min_collect` needed error details: `httpError` got an optional 4th `details` arg and `error-handler.ts` emits it (backward compatible; both files not listed in the story).
- A collection above 0 needs `mode` and `payment_entry_id` (400 otherwise); with 0 both are ignored. `payment_entry_id` must differ from `sale_entry_id`.
- SELLER or above deliver only CONFIRMED orders (story text); an IN_DELIVERY order for them is 409 INVALID_TRANSITION. DRIVER only IN_DELIVERY with own departed delivery (another's is 404).
- Order lock is taken before the relationship lock (merged relation resolved to the surviving row); `viaSync` is only passed through to `transitionOrder`.
- No rule invented for a collection above the order total (overpayment is allowed, balance goes negative).

**Tests added beyond the story:**
- `deliver.test.ts` › notifies the customer order.status_changed: AC text in Context.
- `deliver.test.ts` › lets a SELLER / the OWNER deliver a CONFIRMED order: Context rule; passed at once.
- `deliver.test.ts` › null limit = no limit, limit 0 requires the whole total: CM-15.
- `deliver.test.ts` › answers 404 to a member of another business / unknown order, 401 without token: CONVENTIONS scope rules.
- `deliver.test.ts` › same id twice creates one sale and one payment: idempotent() rule.
- `deliver.test.ts` › writes nothing when a ledger entry id already exists: v5.0.0-2.3.3 single transaction.
- `deliver.test.ts` › 400 for kind, amount, negative, fractional, unknown mode: AB-2 extension.

**Other additions:**
- Catalog test path and regenerated `openapi/openapi.json` (CONVENTIONS rule); `per-001` lists only auth routes, so nothing added.

**Evidence:** story tests 30/30; full suite 2810/2810, failing: none; typecheck clean; lint 0 errors, 65 warnings (all pre-existing security/detect-non-literal-fs-filename)

**Follow-ups:**
- A reused ledger entry id (sale_entry_id or payment_entry_id of an earlier gesture) surfaces as a 500 from the primary-key violation, not a 409.
- Overpayment (collected above total) and SELLER+ delivering an IN_DELIVERY order are unspecified: confirm the intended rule.
- Delivery imports `resolveMergedRelation` from relationship.repository, which is not in the delivery contracts list.
<!-- end DLV-007 -->

<!-- begin DLV-008 -->
## DLV-008 — Deliver only part of an order and settle the rest

- Filed: 2026-10-04 23:36 UTC
- Status: **done**: Partial delivery with LATER child order / ABANDON; 48/48 story tests, full suite green
- Risk: high · story: [DLV-008-deliver-only-part-of-an-order-and-settle-the.md](../modules/delivery/DLV-008-deliver-only-part-of-an-order-and-settle-the.md)
- Agent: 73,279 tokens, 25 tool uses, 12 min 31 s

### Agent report

**Summary:** The deliver gesture accepts `lines` and `rest`; LATER creates a CONFIRMED child order in the same transaction, ABANDON creates nothing.

**Decisions:**
- Request-level checks that need the order (short line without `rest`, quantity above the ordered one, nothing delivered): done in the service after the locks and before any write, as 400 VALIDATION_ERROR. A line of another order is 404.
- Child order: placed by SUPPLIER, `entered_by` is the delivering actor, address copied from the parent. Price author and time are copied from the original line.
- `rest` sent when no line is short: ignored, not refused.
- `delivered_quantity` accepts a string or a number, validated by a regex of plain decimals with at most 3 places. `lines` is capped at 200 and a duplicate `line_id` is a 400.
- `setLineDelivered` now takes the quantity as text, formatted from thousandths.

**Tests added beyond the story:**
- `partial-delivery.test.ts` › price author kept on the rest line: CM-22 prices and author, with a lowered price and 5.5 remaining; passed at once with the implementation
- `partial-delivery.test.ts` › unlisted lines fully delivered, child only of short lines: story Context
- `partial-delivery.test.ts` › a line delivered at 0 beside another delivered line: story Context, 0 is allowed if one line is above 0
- `partial-delivery.test.ts` › extra refusal rows (negative quantity, duplicate line, unknown rest, amount on a line): AC-3 and AB-2

**Other additions:**
- `delivery.openapi.ts`: summary and 400/404 texts updated for the partial delivery.

**Evidence:** story tests 48/48 (partial-delivery and deliver); full suite 2828/2828, failing: none; typecheck clean; lint 0 errors (warnings are existing ones plus 1 in the new test)

**Follow-ups:**
- Another test file had one flaky failure (price_updated_at timing) in the first full run; it was green on rerun.
- If the product was deactivated since the order, the LATER child's line insert fails (ORD-005) and answers 500. The story does not say what to do.
<!-- end DLV-008 -->

<!-- begin DLV-009 -->
## DLV-009 — Seller validates a counter sale

- Filed: 2026-10-04 23:42 UTC
- Status: **done**: counter sale route, 15 tests, full suite green
- Risk: high · story: [DLV-009-seller-validates-a-counter-sale.md](../modules/delivery/DLV-009-seller-validates-a-counter-sale.md)
- Agent: 90,603 tokens, 27 tool uses, 6 min 9 s

### Agent report

**Summary:** Added POST /counters/{relationshipId}/sales (sellAtCounter): one transaction creates, delivers and pays the counter order; done.

**Decisions:**
- Order id: the body `id` becomes the order id (as ORD-013); `idempotent()` replays the first 201.
- Route permission: `create Order` and `deliver Order` both required, so a DRIVER gets 403 (deliver alone lets a DRIVER through on a string subject).
- Order is inserted CONFIRMED with lines already delivered, then `transitionOrder` to DELIVERED (state machine stays the only status writer); `delivery_address_applied` null, cost 0, no delivery row.
- Not-ACTIVE counter gives 409 `RELATIONSHIP_NOT_ACTIVE`, as `enterOrder` does; the story only says "counter, else 404".
- `mode` and `payment_entry_id` are required even for collected_amount 0, so the 0 row of AC-2 reaches the 409 check.
- Collected vs total is checked after pricing and before any write.

**Tests added beyond the story:**
- `counter-sale.test.ts` › prices on the server and applies a seller price gap: unit_price_applied gap as ORD-013 (CM-13, ORD-013)
- `counter-sale.test.ts` › stores nothing when a later step fails (unknown product; reused sale entry id): atomicity (AC-4, v5.0.0-2.3.3)
- `counter-sale.test.ts` › refuses a DRIVER (403): role scope (ACC-003 rules)
- `counter-sale.test.ts` › rejects unknown fields with 400 (v5.0.0-15.3.3); passed with the implementation
- `counter-sale.test.ts` › refuses a suspended business (4xx, nothing stored): story "organization ACTIVE"

**Other additions:**
- Exported `priceEnteredLine` (order.service), `enterOrderLineSchema`/`ORDER_LINES_MAX` (order.schemas) and `supplierOrderViewSchema` (order.openapi) for reuse; order contracts.md is not updated (stories folder is read-only for me).
- DLV-009 path added to `tests/integration/api-docs/catalog.test.ts`; per-001 lists only auth paths, nothing to add there.
- `openapi/openapi.json` regenerated by the suite.

**Evidence:** story tests 15/15; full suite 2843/2843, failing: none; typecheck clean; lint 0 errors, 67 warnings (pre-existing security/detect-non-literal-fs-filename)

**Follow-ups:**
- order and delivery contracts.md should list `priceEnteredLine` as provided by order and consumed by delivery.
- A 409 COUNTER_PAYMENT_INCOMPLETE is stored by `idempotent()`: a retry with the same id returns the same 409; a corrected sale needs a new gesture id.
<!-- end DLV-009 -->

<!-- begin DLV-010 -->
## DLV-010 — Cancelled or shop-delivered orders drop their unstarted deliveries

- Filed: 2026-10-04 23:54 UTC
- Status: **done**: unstarted deliveries removed on both cancels and shop delivery
- Risk: medium · story: [DLV-010-cancelled-or-shop-delivered-orders-drop-their.md](../modules/delivery/DLV-010-cancelled-or-shop-delivered-orders-drop-their.md)
- Agent: 61,893 tokens, 24 tool uses, 11 min 58 s

### Agent report

**Summary:** Added `deleteUnstartedDeliveries` and called it in the supplier cancel, customer cancel and shop path of `deliverOrder`, after the status change, in the same transaction.

**Decisions:**
- Service export: re-exported `deleteUnstartedDeliveries` from `delivery.service.ts` so `order.service.ts` imports it through the service, as `delivery/contracts.md` says. This adds an import cycle order.service <-> delivery.service (the other direction already existed); it is safe because both only use each other inside functions.
- Shop path: the cleanup runs only when the caller is not a DRIVER; a driver's own delivery is closed by `markArrived`.
- `refuseOrder` (PENDING to CANCELLED) is not touched: a PENDING order has no delivery and the story names three paths.

**Tests added beyond the story:**
- `tests/integration/delivery/unstarted-cleanup.test.ts` › keeps a failed delivery when the order is delivered in the shop: a failed delivery is not removed by the shop path (AC-3, C-22); passed once implemented
- same file › does not touch the deliveries of another order: the cleanup is scoped to the one order (C-22)
- same file › leaves the delivery untouched when a shop delivery is refused: credit refusal rolls back (AC-4)

**Evidence:** story tests 48/48 (3 files); full suite 2851/2851 on the last two runs, failing: none; typecheck clean; lint 0 errors, 67 warnings (existing)

**Follow-ups:**
- The first full-suite run showed 2 failures that did not repeat in two later runs; I did not capture which tests. Probably a flake under load, worth watching.
<!-- end DLV-010 -->
