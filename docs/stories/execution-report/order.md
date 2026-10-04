# Execution report: order

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

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

- Filed: 2026-10-04 09:58 UTC
- Status: **blocked**: Story tests pass (35/35) but 2 ORD-001 tests in order-table.test.ts contradict C-16/C-17: 'accepts every documented status' (DELIVERED/CANCELLED/PENDING inserted without their columns) and 'accepts delivered_by_id and cancelled_by_id of a registered person' (set on CONFIRMED). Not under Tests to update: list them, or say how to proceed
- Risk: high · story: [ORD-002-order-status-cancellation-and-delivery-rules-in.md](../modules/order/ORD-002-order-status-cancellation-and-delivery-rules-in.md)
- Agent: 48,629 tokens, 13 tool uses, 2 min 38 s

### Agent report

**Summary:** Blocked: migration, trigger and tests are done and green, but two ORD-001 tests contradict C-16/C-17/C-19 and the story lists no "Tests to update".

**Decisions:**
- CANCELLED to DELIVERED: `sync_issue` counts as set when it is non-null and not blank in the new row (not only when this update changes it); the trigger also clears the four cancellation columns, so the update need not.
- Reason rule: "not null when SUPPLIER" implemented literally (an empty string is accepted), as the story says.
- Frozen check compares `to_jsonb(NEW)` and `to_jsonb(OLD)` minus supplier_note, sync_issue, server_updated_at, so new columns are frozen by default.
- Trigger only on UPDATE (the story says BEFORE UPDATE); inserts are covered by the CHECKs.

**Tests added beyond the story:**
- `tests/integration/order/status-rules.test.ts` › clears the cancellation columns when delivery wins: the trigger clears them (story context); passed only after the trigger
- same file › CANCELLED can change supplier_note and sync_issue only (C-18); PENDING to IN_DELIVERY, CONFIRMED to PENDING, DELIVERED to CONFIRMED, blank sync_issue refused (CM-12); non-frozen order may still change other columns

**Other additions:**
- `prisma/schema.prisma`: plain-language comment above `Order` for the new rules (CLAUDE.md rule).

**Evidence:** story tests 35/35; full suite not run (blocked); typecheck clean; lint 0 errors, 56 warnings (+1 object-injection warning in the new test, same pattern as the existing tests)

**Follow-ups:**
- Failing ORD-001 tests in `tests/integration/order/order-table.test.ts`: 'orders enums and keys (AC-2)' › 'accepts every documented status' (inserts DELIVERED, CANCELLED, and PENDING placed by SUPPLIER without the required columns) and › 'accepts delivered_by_id and cancelled_by_id of a registered person' (sets both on a CONFIRMED order).
- Add both to ORD-002 "Tests to update", expected: each status inserted with consistent columns, PENDING placed by CUSTOMER; the registered-person test on a DELIVERED or CANCELLED row (or one column per row). Then rerun the full suite.
- Work is uncommitted in the tree: migration `20261004230000_ord_002_status_rules`, schema.prisma comment, the new test.
<!-- end ORD-002 -->
