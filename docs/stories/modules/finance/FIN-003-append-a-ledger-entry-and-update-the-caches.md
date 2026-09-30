---
id: FIN-003
title: Append a ledger entry and update the caches
module: finance
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [FIN-002, REL-025, ORG-006]
read_first: [src/modules/relationship/relationship.repository.ts, src/modules/organization/organization.repository.ts]
design_refs: [finances/ledgerentry, finances/handover]
constraints: [C-37, CM-17]
asvs: [v5.0.0-2.3.3, v5.0.0-2.3.4]
---

# FIN-003 — Append a ledger entry and update the caches

## Story
Technical story: provide the one function that writes a ledger entry and updates the balance and the held money in the right order, so that simultaneous writes never lose an effect.

## Context
- Exists: `ledger_entries` (FIN-001, FIN-002); `addToBalance` (REL-025 repository, `SET balance = balance + delta`); `addAmountHeld` (ORG-006); `resolveMergedRelation`.
- Adds: `src/modules/finance/ledger.service.ts` with `appendLedgerEntry(tx, input)` and `reverseLedgerEntry(tx, entryId, input)`.
- `appendLedgerEntry` resolves a merged relationship id, inserts the row, reads its generated `balance_effect`, adds it to the relationship's `balance` (first), then for a PAYMENT adds +amount and for a REFUND adds -amount to the recorder's `amount_held` (second). A reversal of a PAYMENT subtracts and a reversal of a REFUND adds. It runs in the caller's transaction.
- `reverseLedgerEntry` builds the mirror entry (same relationship, kind, amount, mode and order) with `reverses_entry_id` and the new id.
- `C-37`: `CustomerRelationship.balance` and `Collaboration.amount_held` are updated by adding the effect of each operation inside its transaction, always relationship first then collaboration; a nightly check compares each total with the sum of its entries.
- `CM-17`: amount_held = payments recorded minus refunds made, expenses paid and handovers given, plus handovers received; a reversed entry counts the other way; a cancelled expense or handover no longer counts; the owner's amount is tracked but never presented.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Cache effects
  When appendLedgerEntry writes a <kind> of 10000 recorded by a collaborator
  Then the balance changes by <balance> and the recorder's amount_held by <held>
  Examples:
    | kind            | balance | held   |
    | SALE            | +10000  | 0      |
    | PAYMENT         | -10000  | +10000 |
    | REFUND          | +10000  | -10000 |
    | CREDIT_NOTE     | -10000  | 0      |
    | OPENING_BALANCE | +10000  | 0      |
Scenario: AC-2 Reversal
  When reverseLedgerEntry reverses a PAYMENT of 10000
  Then the balance rises by 10000 and the recorder's amount_held falls by 10000
Scenario: AC-3 Simultaneous writes
  When 20 payments of 100 are appended in parallel transactions for one relationship
  Then the balance ends 2000 lower and no effect is lost
Scenario: AC-4 Atomic
  When the held-money update fails
  Then no entry and no balance change remain
Scenario: AC-5 Merged relationship
  When the given relationship id was merged into another
  Then the entry is written on the surviving relationship
```

## Abuse cases
```gherkin
Scenario: AB-1 Lost update on a balance (tampering)
  When two transactions read the same balance and both write
  Then both effects are kept because the cache changes by addition
```

## Implementation
- Create: `src/modules/finance/ledger.service.ts`, `tests/integration/finance/ledger-service.test.ts`
- Pattern: `src/modules/organization/organization.repository.ts`
- Signatures:
  - `appendLedgerEntry(tx: Prisma.TransactionClient, input: LedgerInput): Promise<LedgerEntry>`
  - `reverseLedgerEntry(tx: Prisma.TransactionClient, entryId: string, input: { id: string; recordedById: string; note?: string }): Promise<LedgerEntry>`
- Types:
  - `LedgerInput = { id: string; relationshipId: string; kind: LedgerKind; amount: bigint; mode?: 'CASH' | 'MOBILE_MONEY'; orderId?: string; transactionReference?: string; note?: string; recordedById: string; organizationId: string; occurredAt: Date }`
- Errors: `NOT_FOUND` 404, `VALIDATION_ERROR` 400
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: entry and both cache updates are one transaction.
- v5.0.0-2.3.4: caches change by `SET x = x + delta`; the relationship is always updated before the collaboration.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| cache effects | integration | AC-1, C-37, CM-17 | each Examples row → deltas |
| reversal | integration | AC-2 | mirror effects |
| simultaneous | integration | AC-3, CWE-362 | balance −2000 |
| atomic | integration | AC-4 | nothing remains |
| merged | integration | AC-5 | entry on surviving row |
| lost update | security | AB-1, WSTG-BUSL-04 | both effects kept |

Command: `npx vitest run tests/integration/finance/ledger-service.test.ts`

## Out of scope
- Routes (FIN-004 onward).
