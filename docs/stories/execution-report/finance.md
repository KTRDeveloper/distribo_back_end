# Execution report: finance

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

### Run 2026-10-04 04:48 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| FIN-001 Ledger entries table | todo | - |  |
| FIN-002 Ledger sale and reversal rules in the database | todo | - |  |
| FIN-003 Append a ledger entry and update the caches | todo | - |  |
| FIN-004 Seller records a payment | todo | - |  |
| FIN-005 Manager returns money to a customer | todo | - |  |
| FIN-006 Manager grants a credit note | todo | - |  |
| FIN-007 Manager records an opening balance from a paper notebook | todo | - |  |
| FIN-008 Manager records a refunded return | todo | - |  |
| FIN-009 Manager reverses a ledger entry | todo | - |  |
| FIN-010 Parties read the ledger of a relationship | todo | - |  |
| FIN-011 Expenses table | todo | - |  |
| FIN-012 Manager records an expense | todo | - |  |
| FIN-013 Manager cancels an expense | todo | - |  |
| FIN-014 Handovers table | todo | - |  |
| FIN-015 Owner or manager records a handover received | todo | - |  |
| FIN-016 Cancel a handover and dispute the noted amount | todo | - |  |
| FIN-017 Ownership transfer hands over the former owner's money | todo | - |  |
| FIN-018 Nightly check of balances and held money | todo | - |  |
| FIN-019 Owner reads the money exceptions | todo | - |  |
| FIN-020 Owner reads the treasury and expenses | todo | - |  |

Also in this run: relationship, admin, catalog, order, delivery.

- Stopped after REL-002: blocked, a REL-001 test (`relationship-table.test.ts` › "rejects an unknown merged_into_id with 23503 and accepts an existing one") conflicts with the new CHECKs and the story does not list it under "Tests to update".
- Not reached: REL-003 to DLV-009 (98 stories), because the run stopped on the block; no `--keep-going`.
- Nothing unexpected: the agent report and the notification figures both came in.
- REL-002's migration, test file and schema.prisma comment are left uncommitted in the working tree, waiting for the human decision.
- Next: decide whether that REL-001 test may be updated (amend REL-002's "Tests to update"), then `/implement-stories REL-002` and `/implement-stories next:100`.

<!-- begin FIN-001 -->
## FIN-001 — Ledger entries table

- Filed: 2026-10-04 10:11 UTC
- Status: **done**: ledger_entries table, generated balance_effect, append-only grants
- Risk: high · story: [FIN-001-ledger-entries-table.md](../modules/finance/FIN-001-ledger-entries-table.md)
- Agent: 53,789 tokens, 19 tool uses, 12 min 9 s

### Agent report

**Summary:** Added ledger_entries (enums, generated balance_effect, CHECKs, FKs, triggers, REVOKE) with migration 20261004230000_fin_001_ledger_entries and schema model.

**Decisions:**
- Enum names LedgerEntryKind / LedgerEntryMode: story gave values only.
- occurred_at has no default (NOT NULL): the caller supplies the business time.
- All FKs ON DELETE RESTRICT (incl. optional order_id, reverses_entry_id): SET NULL would update an immutable row.
- balance_effect in Prisma is `BigInt @default(dbgenerated())`, documented in the model comment; code must omit it on create.
- CHECK on mode uses (mode IS NOT NULL) = (kind IN PAYMENT, REFUND).

**Tests added beyond the story:**
- ledger-table.test.ts › flips the sign of a reversing SALE/CREDIT_NOTE/REFUND: sign flip for all kinds (C-23); passed at once with the migration
- ledger-table.test.ts › OPENING_BALANCE / REFUND without mode / CREDIT_NOTE with mode: mode rule edges (C-23)
- ledger-table.test.ts › unknown kind or mode (22P02), missing required columns (23502), unknown order/reversed entry (23503), no deleted_at column, TRUNCATE denied (C-39)

**Evidence:** story tests 28/28; full suite 1360/1360, failing: none; typecheck clean; lint 0 errors, 55 warnings (pre-existing)

**Follow-ups:**
- The SET NULL default would also be wrong for other immutable tables' optional FKs; not checked here.
<!-- end FIN-001 -->

<!-- begin FIN-011 -->
## FIN-011 — Expenses table

- Filed: 2026-10-04 10:28 UTC
- Status: **done**: expenses table, triggers and tests green
- Risk: medium · story: [FIN-011-expenses-table.md](../modules/finance/FIN-011-expenses-table.md)
- Agent: 60,450 tokens, 22 tool uses, 17 min 13 s

### Agent report

**Summary:** Added `expenses` table (migration 20261004240000_fin_011_expenses, Prisma model, schema comment) with CHECKs, FKs, payer-collaborator trigger, cancel-once trigger, registered-person and server_updated_at triggers.

**Decisions:**
- deleted_at: kept per "Adds" but made immutable too (story says every change except cancelling raises 23514); no delete path exists yet.
- Immutability trigger compares to_jsonb(NEW)/(OLD) minus server_updated_at and the two cancel columns, so future columns are protected by default.
- Payer trigger counts any collaboration row (any status, deleted or not); it steps aside on NULL or unknown organization so 23502/23503 are reported by their own checks.
- paid_by_id is also under require_registered_person (story lists it), checked at commit.
- No REVOKE on distribo_app: story asks for triggers only; DELETE is not blocked (see follow-ups).

**Tests added beyond the story:**
- `expense-table.test.ts` › payer collaborating only with another organization: tenant scope of C-27 (C-27); passed at once after the migration
- `expense-table.test.ts` › amount -5, clearing a cancellation, half cancellation, guest canceller, cancel combined with an amount edit: fail-closed paths (AC-2, C-27, C-04)
- `expense-table.test.ts` › edits of description, organization, recorder, occurred_at, deleted_at: every other column is immutable (AC-3)
- `expense-table.test.ts` › NOT NULL (23502) and unknown FK (23503), server_updated_at moves on cancel (Expense:required, Expense:fk)

**Other additions:**
- Test-DB: first migration version failed 23502/23503 tests (BEFORE trigger fired first); I edited the unmerged migration and dropped its objects from the test DB by hand.

**Evidence:** story tests 28/28; full suite 1388/1388, failing: none; typecheck clean; lint 0 errors, 56 warnings (pre-existing)

**Follow-ups:**
- DELETE/TRUNCATE on expenses by distribo_app is not revoked; confirm whether Expense should be append-only at privilege level (not in story or C-27).
<!-- end FIN-011 -->
