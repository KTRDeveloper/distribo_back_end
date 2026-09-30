---
id: FIN-018
title: Nightly check of balances and held money
module: finance
kind: technical
rev: 1
amends: []
size: M
risk: medium
depends_on: [FIN-016, FIN-003]
read_first: [src/lib/metrics.ts, package.json]
design_refs: [finances/ledgerentry, finances/handover]
constraints: [C-37, CM-17]
asvs: [v5.0.0-16.3.3, v5.0.0-2.3.3]
---

# FIN-018 — Nightly check of balances and held money

## Story
Technical story: compare every cached balance and held-money total with the sum of its entries and alert on any difference, so that a drift cannot stay hidden.

## Context
- Exists: `balance`, `amount_held`, ledger, expenses, handovers (FIN-001 to FIN-017).
- Adds: `src/jobs/reconcile.ts`, `src/modules/finance/reconcile.service.ts`, npm script `job:reconcile` (`tsx src/jobs/reconcile.ts`), Prometheus counter `reconcile_mismatch_total`. It only reads; scheduling is left to deployment (Q-010).
- Balance check: each live relationship's `balance` equals the sum of its ledger entries' `balance_effect`.
- Held-money check per collaboration: PAYMENT entries the person recorded (+), REFUND entries (−), with a reversal flipping the sign; minus their non-cancelled expenses as payer; minus non-cancelled handovers as remitter; plus non-cancelled handovers as receiver, except a handover to oneself, which only subtracts.
- Each difference is logged at `error` with event `balance_mismatch` or `amount_held_mismatch`, the ids and the difference (never names), and counted. The script exits 1 when any mismatch exists, else 0.
- `C-37`: `CustomerRelationship.balance` and `Collaboration.amount_held` are updated by adding the effect of each operation inside its transaction, always relationship first then collaboration; a nightly check compares each total with the sum of its entries.
- `CM-17`: amount_held = payments recorded minus refunds made, expenses paid and handovers given, plus handovers received; a reversed entry counts the other way; a cancelled expense or handover no longer counts; the owner's amount is tracked but never presented.

## Acceptance criteria
```gherkin
Scenario: AC-1 Clean data
  Given consistent balances and held amounts
  When the reconcile service runs
  Then it reports 0 mismatches
Scenario: AC-2 Balance drift
  When a balance cache is changed by 1 franc directly
  Then one `balance_mismatch` is reported with the relationship id and the difference
Scenario: AC-3 Held-money drift
  When an amount_held is changed directly
  Then one `amount_held_mismatch` is reported
Scenario: AC-4 Full formula
  Given payments, refunds, reversals, cancelled and live expenses, handovers in and out, and an automatic self handover
  Then the expected held money is computed as stated and matches the caches
Scenario: AC-5 Exit code
  Then the script exits 1 on a mismatch and 0 otherwise
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/jobs/reconcile.ts`, `src/modules/finance/reconcile.service.ts`, `tests/integration/finance/reconcile.test.ts`
- Modify: `package.json`, `src/lib/metrics.ts`
- Pattern: `src/lib/metrics.ts`
- Signatures:
  - `reconcile(): Promise<{ balanceMismatches: Mismatch[]; heldMismatches: Mismatch[] }>`
- Types:
  - `Mismatch = { id: string; expected: string; actual: string }`
- Dependencies: `prom-client`, `pino`, `@prisma/client`

## Security
- v5.0.0-16.3.3: mismatches are security-relevant events with a fixed name.
- v5.0.0-2.3.3: the check reads inside one repeatable-read transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| clean | integration | AC-1, C-37 | 0 mismatches |
| balance drift | integration | AC-2 | reported |
| held drift | integration | AC-3, CM-17 | reported |
| full formula | integration | AC-4 | matches |
| exit code | integration | AC-5 | 1 and 0 |

Command: `npx vitest run tests/integration/finance/reconcile.test.ts`

## Out of scope
- Scheduling the job (deployment).
