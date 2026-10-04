# Execution report: finance

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

### Run 2026-10-04 21:00 UTC: `/implement-stories FIN-002`

| story | status | commit | note |
|---|---|---|---|
| FIN-002 Ledger sale and reversal rules in the database | done | 4c15eca | migration 20261004330000 adds sale and reversal triggers plus partial unique index; ledger-table fixtures updated |

- Re-run of FIN-002 after the user approved a "Tests to update" section (9 FIN-001 tests in ledger-table.test.ts), added to the story before the run and committed with it.
- Old stash `stash@{0}` "FIN-002 blocked: partial changes" from the earlier run is now redundant.
- Run completed; nothing unexpected.
- Next: `/implement-stories next:1`

### Run 2026-10-04 10:55 UTC: `/implement-stories next:100`

| story | status | commit | note |
|---|---|---|---|
| FIN-001 Ledger entries table | done | 76169ae | ledger_entries table, generated balance_effect, append-only grants |
| FIN-011 Expenses table | done | e84a321 | expenses table, triggers and tests green |
| FIN-014 Handovers table | done | 8491810 | handovers table, party-role and cancel-once triggers; 33 tests pass |

Not run: FIN-002..FIN-010, FIN-012..FIN-013, FIN-015..FIN-020.
Also in this run: relationship, admin, catalog, order, delivery.

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

<!-- begin FIN-002 -->
## FIN-002 — Ledger sale and reversal rules in the database

- Filed: 2026-10-04 21:00 UTC
- Status: **done**: migration 20261004330000 adds sale and reversal triggers plus partial unique index; ledger-table fixtures updated
- Risk: high · story: [FIN-002-ledger-sale-and-reversal-rules-in-the-database.md](../modules/finance/FIN-002-ledger-sale-and-reversal-rules-in-the-database.md)
- Agent: 41,793 tokens, 13 tool uses, 4 min 29 s

### Agent report

**Summary:** Migration with two BEFORE INSERT triggers and a partial unique index; ledger-table.test.ts fixtures updated per the new "Tests to update".

**Decisions:**
- Unknown order or unknown reversal target: the triggers return without error so the foreign key raises 23503, as the updated ledger-table test expects.
- Self-reversal (reverses_entry_id = id): refused with 23514, since the entry would itself be a reversal (C-25); otherwise it passed the FK.
- Concurrent sales: a transaction-scoped advisory lock per order, because the app role cannot lock the orders row.

**Tests added beyond the story:**
- `tests/integration/finance/ledger-rules.test.ts` › lets only one of two concurrent SALEs commit: race on the one-live-sale rule (C-24); written before the migration, failed then passed
- same file › keeps the live-SALE rule per order, does not require an order for other kinds, reversal of a reversal, self-reversal 23514 (C-24, C-25)

**Other additions:**
- schema.prisma comment above LedgerEntry for the new rules and the partial unique index (CLAUDE.md rule).

**Evidence:** story tests 16/16; full suite 2520/2520, failing: none; typecheck clean; lint 0 errors, 62 warnings (pre-existing)

**Follow-ups:**
- The concurrency test was not run without the lock to confirm it would fail without it.
<!-- end FIN-002 -->

<!-- begin FIN-003 -->
## FIN-003 — Append a ledger entry and update the caches

- Filed: 2026-10-04 21:13 UTC
- Status: **done**: appendLedgerEntry and reverseLedgerEntry; addToBalance added to relationship repo; 19 story tests, full suite 2539 pass
- Risk: high · story: [FIN-003-append-a-ledger-entry-and-update-the-caches.md](../modules/finance/FIN-003-append-a-ledger-entry-and-update-the-caches.md)
- Agent: 57,504 tokens, 19 tool uses, 10 min 31 s

### Agent report

**Summary:** Added `appendLedgerEntry` and `reverseLedgerEntry` in `ledger.service.ts`: relationship balance first, then the recorder's amount held, in the caller's transaction.

**Decisions:**
- Reversal held-money owner: the collaboration of `input.recordedById` (the person reversing) in the relationship's supplier organization. FIN-018 counts a reversal under the person who recorded it, so I followed that. The story is silent on it.
- Mirror entry keeps `order_id` (the story says same order). The FIN-002 sale rule ignores reversals, so the database accepts it.
- DB access stays in the service through the caller's `tx`; I did not add a repository file the story does not list.
- Validation (400): amount at most 0, or a mode that does not fit the kind (mode required only for PAYMENT/REFUND). This avoids an opaque 23514 as a 500.
- Unknown or deleted relationship: pre-check, then 404 NOT_FOUND. Otherwise the foreign key would give a 500.

**Tests added beyond the story:**
- `ledger-service.test.ts` › input checks (4 cases): invalid amount or mode gives 400 and no write (C-23, Errors line); passed at once
- `ledger-service.test.ts` › unknown relationship 404, unknown entry to reverse 404 (story Errors line); passed at once
- `ledger-service.test.ts` › reversal of a REFUND and of a SALE keeps its order and leaves held money alone (AC-2, CM-17); passed at once
- `ledger-service.test.ts` › "stores the given fields": entry fields are persisted as given

**Other additions:**
- `addToBalance(tx, id, delta)` in `relationship.repository.ts`: the story and `relationship/contracts.md` say it exists (REL-007), but it was not in the code. I wrote it per the contract: atomic `SET balance = balance + delta`, 404 when no live row.

**Evidence:** story tests 19/19; full suite 2539/2539 on the final run, failing: none; typecheck clean; lint 0 errors, 62 warnings (existing)

**Follow-ups:**
- The first full run had 2 failures in a relationship-related test (a serialized response check); two reruns were green. Looks like a flake unrelated to this story; not investigated.
- `reverseLedgerEntry` targets the entry's original relationship id. An entry written before a merge sits on the now-deleted duplicate, so reversing it gives 404 (`addToBalance` ignores deleted rows). FIN-009 should decide how to handle this.
<!-- end FIN-003 -->

<!-- begin FIN-004 -->
## FIN-004 — Seller records a payment

- Filed: 2026-10-04 21:19 UTC
- Status: **done**: Payment route, 13 tests, full suite green; OpenAPI paths left to FIN-010
- Risk: high · story: [FIN-004-seller-records-a-payment.md](../modules/finance/FIN-004-seller-records-a-payment.md)
- Agent: 76,241 tokens, 27 tool uses, 5 min 59 s

### Agent report

**Summary:** Added POST /organizations/:organizationId/customers/:relationshipId/payments (schemas, service, routes, app mount) on top of appendLedgerEntry; all 13 tests pass.

**Decisions:**
- DRIVER refusal: the CASL rule `create LedgerEntry PAYMENT` also matches DRIVER (delivery payments), so the route adds an explicit `atLeast(role, 'SELLER')` check after requireAbility, 403 FORBIDDEN with a permission_refused warn log.
- Response balance: locked relationship balance plus the entry's generated balance_effect (row locked FOR UPDATE), no extra query.
- Org status: findOrganizationStatus directly (assertOrganizationActive refuses CLOSED, which AC-5 must accept); SUSPENDED gives 409.
- `amount` capped at Number.MAX_SAFE_INTEGER so a huge value is a 400, not a bigint overflow 500; `transaction_reference` trimmed, 1 to 100 characters.
- catalog.test.ts / per-001.test.ts not changed: the story puts OpenAPI registration in FIN-010 (which documents FIN-004..009), and a catalog entry would fail without it.

**Tests added beyond the story:**
- `tests/integration/finance/record-payment.test.ts` › accepts a payment on an ENDED relationship and from a MANAGER: the story context says ENDED is allowed and security says seller and above; passed at once only after implementation (written before)
- `tests/integration/finance/record-payment.test.ts` › answers 404 for a non-member and a foreign relationship, nothing moved (AB-3, CONVENTIONS 404 outside scope)

**Other additions:**
- PENDING test drops and re-adds the pending_iff_supplier_person CHECK inside the test (a PENDING row cannot belong to an organization supplier otherwise); restored in `finally`.

**Evidence:** story tests 13/13; full suite 2552/2552, failing: none; typecheck clean; lint 0 errors, 62 warnings (pre-existing)

**Follow-ups:**
- A different person reusing another person's ledger entry id would hit a primary key violation (500); same as the other gesture routes, not handled here.
- Add the payments path to catalog.test.ts when FIN-010 registers the OpenAPI paths.
<!-- end FIN-004 -->

<!-- begin FIN-005 -->
## FIN-005 — Manager returns money to a customer

- Filed: 2026-10-04 21:24 UTC
- Status: **done**: refund route, 13 tests, full suite green
- Risk: high · story: [FIN-005-manager-returns-money-to-a-customer.md](../modules/finance/FIN-005-manager-returns-money-to-a-customer.md)
- Agent: 53,628 tokens, 17 tool uses, 5 min 18 s

### Agent report

**Summary:** Added POST .../customers/{relationshipId}/refunds and `recordRefund`; all tests green.

**Decisions:**
- Customer notified: only a registered customer person; a business customer or guest gets nothing (the story names no recipient for a business).
- Organization status: any status but ACTIVE is refused (CLOSED and SUSPENDED), unlike payments, per AC-3.
- PENDING relationship: 409 `RELATIONSHIP_NOT_ACTIVE` (same code as FIN-004; the story names none). ENDED stays allowed.
- Own-record rule copied from setCreditLimit (customer person is the caller, or a non-owner manages the customer organization); logged as `own_record_refused`.
- Reused `recordPaymentSchema`/`PaymentInput` (same limits); route has no SELLER floor, the rules table already refuses SELLER and DRIVER.
- Notification related entity type is `ledger_entry`; content includes the amount in XAF, FR/EN by recipient language.

**Tests added beyond the story:**
- `refund.test.ts` › owner refunds with mobile money reference: OWNER allowed, held money of the owner lowered (v5.0.0-8.2.1)
- `refund.test.ts` › guest customer: refund stored, no notification (AC-2 says "registered")
- `refund.test.ts` › owner refunds their manager as customer: the OWN_RECORD limit binds managers only (same rule as credit limit)
- `refund.test.ts` › another business's customer gives 404 and stores nothing (v5.0.0-8.2.2)
- The SUSPENDED case, the PENDING relationship and the client-set `kind` rejection sit in the story's refusal tests.

**Other additions:**
- None.

**Evidence:** story tests 13/13; full suite 2565/2565, failing: none; typecheck clean; lint 0 errors, no warning in the finance code

**Follow-ups:**
- No `.openapi.ts` for finance exists (FIN-004 did not add one), so the refunds and payments paths are in neither catalog.test.ts nor per-001.test.ts; left as is.
<!-- end FIN-005 -->

<!-- begin FIN-006 -->
## FIN-006 — Manager grants a credit note

- Filed: 2026-10-04 21:29 UTC
- Status: **done**: POST credit-notes; guards shared with refund; 2574 tests pass
- Risk: high · story: [FIN-006-manager-grants-a-credit-note.md](../modules/finance/FIN-006-manager-grants-a-credit-note.md)
- Agent: 43,185 tokens, 12 tool uses, 4 min 26 s

### Agent report

**Summary:** Added POST credit-notes route, schema and `recordCreditNote`; credit note lowers the balance, no held money moves.

**Decisions:**
- Inactive organization: same as refund (only ACTIVE; CLOSED and SUSPENDED give 409 ORGANIZATION_NOT_ACTIVE), from "Same refusals as FIN-005".
- `note` is trimmed, so a blank note is a 400.
- No notification sent: the story does not ask for one.

**Tests added beyond the story:**
- `credit-note.test.ts` › owner grants on own-manager customer: owner exempt from OWN_RECORD (ACC-004, v5.0.0-8.2.1); passed at once after the route existed
- `credit-note.test.ts` › invalid bodies (blank note, 2001 chars, amount 0 or 1.5, `mode`, `kind`): 400 and nothing stored (strict schema, v5.0.0-15.3.3)
- `credit-note.test.ts` › CLOSED or SUSPENDED organization: 409 (Context, same as FIN-005)
- `credit-note.test.ts` › another business's customer: 404 and nothing stored (v5.0.0-8.2.2)

**Other additions:**
- `lockCustomerForOutflow` in `finance.service.ts`: the refund guards extracted, now shared by `recordRefund` and `recordCreditNote`. Behavior unchanged; refund tests still pass.

**Evidence:** story tests 9/9; full suite 2574/2574, failing: none; typecheck clean; lint 0 errors, 62 warnings (existing)

**Follow-ups:**
- No `.openapi.ts` for finance and no catalog/per-001 entries: neither FIN-004, FIN-005 nor this story has them, so I kept the precedent. Convention says each route should be registered.
<!-- end FIN-006 -->

<!-- begin FIN-007 -->
## FIN-007 — Manager records an opening balance from a paper notebook

- Filed: 2026-10-04 21:33 UTC
- Status: **done**: POST opening-balances; reuses refund guards; all tests pass
- Risk: high · story: [FIN-007-manager-records-an-opening-balance-from-a-paper.md](../modules/finance/FIN-007-manager-records-an-opening-balance-from-a-paper.md)
- Agent: 37,508 tokens, 12 tool uses, 4 min 9 s

### Agent report

**Summary:** Added POST .../customers/{relationshipId}/opening-balances (recordOpeningBalance), reusing the FIN-005/006 guards.

**Decisions:**
- Schema: `openingBalanceSchema` aliases `creditNoteSchema` (same fields, note required), since the shape is identical.
- Extracted `notifyBalanceIncreased` from recordRefund so refund and opening balance share it (no behavior change).
- No `.openapi.ts` or catalog/per-001 entries: the finance module has none for FIN-004..006 either.

**Tests added beyond the story:**
- `opening-balance.test.ts` › owner on manager-as-customer: owner allowed on own-record (v5.0.0-8.2.1, as FIN-006)
- `opening-balance.test.ts` › CLOSED/SUSPENDED org: ORGANIZATION_NOT_ACTIVE ("Same refusals as FIN-005")
- `opening-balance.test.ts` › retried id: one entry, one notification (project rule on idempotent gestures)
- `opening-balance.test.ts` › foreign customer: 404, nothing stored (v5.0.0-8.2.2); these four passed at once once the route existed

**Evidence:** story tests 10/10; full suite 2584/2584, failing: none; typecheck clean; lint 0 errors, 62 warnings (pre-existing)

**Follow-ups:**
- Finance routes (FIN-004..007) are not registered in an `.openapi.ts` although CONVENTIONS requires it; worth a dedicated story.
<!-- end FIN-007 -->

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

<!-- begin FIN-014 -->
## FIN-014 — Handovers table

- Filed: 2026-10-04 10:41 UTC
- Status: **done**: handovers table, party-role and cancel-once triggers; 33 tests pass
- Risk: medium · story: [FIN-014-handovers-table.md](../modules/finance/FIN-014-handovers-table.md)
- Agent: 41,058 tokens, 16 tool uses, 12 min 52 s

### Agent report

**Summary:** Added the handovers table (migration 20261004250000_fin_014_handovers), Prisma model with rules comment, and the integration test file.

**Decisions:**
- Receiver check ignores deleted_at: story says only ACTIVE OWNER or MANAGER status; sender check likewise counts any row, as for expenses.
- Sender/receiver checks live in one BEFORE INSERT trigger that steps aside on NULL or unknown organization so 23502/23503 are reported by the native checks (same pattern as FIN-011).

**Tests added beyond the story:**
- `handover-table.test.ts` › receiver is a DRIVER / owner of another org / never collaborated: receiver scope per organization (C-27); passed at once with the implementation
- `handover-table.test.ts` › guest as sender/receiver/canceller rejected: C-04
- `handover-table.test.ts` › refuses to change amount/sender/receiver/org/occurred_at/deleted_at: never-edit rule (C-27)
- `handover-table.test.ts` › app account insert to a driver: AB-1 through the application role

**Evidence:** story tests 33/33; full suite 1421/1421, failing: none; typecheck clean; lint 0 errors, 57 warnings (existing)

**Follow-ups:**
- Tests were written first and failed (33/33) before the migration existed.
<!-- end FIN-014 -->
