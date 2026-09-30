---
id: FIN-006
title: Manager grants a credit note
module: finance
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [FIN-005]
read_first: [src/modules/finance/finance.service.ts, src/modules/finance/finance.routes.ts]
design_refs: [finances/ledgerentry]
constraints: [C-23]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]
---

# FIN-006 — Manager grants a credit note

## Story
As a manager, I want to grant a credit note so that a customer owes less without money moving.

## Context
- Exists: `appendLedgerEntry`; rule for kind CREDIT_NOTE (MANAGER online, OWNER always; ACC-004).
- Adds: `POST /api/v1/organizations/{organizationId}/customers/{relationshipId}/credit-notes` with `{ id, amount, note }` (`note` 1 to 2000, required: the reason); response 201. A CREDIT_NOTE lowers the balance and moves no money. Same refusals as FIN-005 (counter, PENDING, own record, inactive organization).
- `C-23`: `LedgerEntry.amount` > 0; `balance_effect` is a generated column of `kind`, `amount` and `reverses_entry_id`; `mode` is set if and only if `kind` is PAYMENT or REFUND.

## Acceptance criteria
```gherkin
Scenario: AC-1 Credit note
  Given balance 30000
  When a MANAGER grants 5000 with note "retour d'un sac"
  Then balance is 25000 and no amount_held changes
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                          | status                    |
    | no note                          | 400 VALIDATION_ERROR      |
    | a SELLER caller                  | 403 FORBIDDEN             |
    | the manager's own record         | 403 OWN_RECORD            |
    | a counter                        | 409 COUNTER_ONLY_RETURNS  |
Scenario: AC-3 Repeat
  When the same id is posted twice
  Then one entry exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller forgives debts (vertical)
  When a SELLER posts a credit note
  Then the response is 403 and the balance is unchanged
```

## Implementation
- Create: `tests/integration/finance/credit-note.test.ts`
- Modify: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.schemas.ts`, `src/modules/finance/finance.service.ts`
- Pattern: `src/modules/finance/finance.routes.ts`
- Signatures:
  - `recordCreditNote(actor: Actor, relationshipId: string, input: { id: string; amount: number; note: string }): Promise<LedgerEntryView>`
- Errors: `OWN_RECORD` 403, `COUNTER_ONLY_RETURNS` 409, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| credit note | integration | AC-1, C-23 | balance down, held unchanged |
| refusals | integration | AC-2 | each Examples row → status |
| repeat | integration | AC-3 | one entry |
| seller | security | AB-1, WSTG-ATHZ-03 | 403 |

Command: `npx vitest run tests/integration/finance/credit-note.test.ts`

## Out of scope
- Returns with money back (FIN-008).
