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
