---
id: FIN-009
title: Manager reverses a ledger entry
module: finance
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [FIN-005, ACC-007]
read_first: [src/modules/finance/ledger.service.ts, src/modules/finance/finance.service.ts]
design_refs: [finances/ledgerentry]
constraints: [C-25]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-8.2.2]
---

# FIN-009 — Manager reverses a ledger entry

## Story
As a manager, I want to cancel a wrong ledger entry so that the mistake is corrected without editing history.

## Context
- Exists: `reverseLedgerEntry` (FIN-003); rule `reverse` on LedgerEntry (MANAGER online, OWNER always; ACC-004); `notify`.
- Adds: `POST /api/v1/organizations/{organizationId}/ledger-entries/{entryId}/reverse` with `{ id, note? }`; response 201 with the reversal entry.
- The entry must belong to a relationship of which the organization is supplier, must not itself be a reversal (409 `CANNOT_REVERSE_REVERSAL`) and must not already be reversed (409 `ALREADY_REVERSED`). On the manager's own customer record only the owner may reverse (403 `OWN_RECORD`). A reversal that raises the balance notifies a registered customer `balance.increased`.
- `C-25`: A ledger entry is never updated or deleted; `reverses_entry_id` is unique, on the same relationship, the same kind and amount, and points to an entry that is not itself a reversal.

## Acceptance criteria
```gherkin
Scenario: AC-1 Reverse a payment
  Given a PAYMENT of 20000 by a seller
  When a MANAGER reverses it
  Then a mirror entry of the same kind and amount points to it, the balance is +20000 and the seller's amount_held is −20000
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                           | status                           |
    | an entry already reversed         | 409 ALREADY_REVERSED             |
    | a reversal entry                  | 409 CANNOT_REVERSE_REVERSAL      |
    | an entry of another business      | 404 NOT_FOUND                    |
    | a SELLER or DRIVER caller         | 403 FORBIDDEN                    |
    | the manager's own customer record | 403 OWN_RECORD                   |
Scenario: AC-3 Parallel reversals
  When two managers reverse one entry at once
  Then one succeeds and the other answers 409
Scenario: AC-4 History kept
  Then the original entry is unchanged
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller erases a payment (vertical)
  When a SELLER or DRIVER posts a reversal
  Then the response is 403 and nothing is written
Scenario: AB-2 Reversing another business's entry (horizontal)
  When a member of A posts an entry id of B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/finance/reverse.test.ts`
- Modify: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.schemas.ts`, `src/modules/finance/finance.service.ts`
- Pattern: `src/modules/finance/finance.routes.ts`
- Signatures:
  - `reverseEntry(actor: Actor, entryId: string, input: { id: string; note?: string }): Promise<LedgerEntryView>`
- Errors: `ALREADY_REVERSED` 409, `CANNOT_REVERSE_REVERSAL` 409, `OWN_RECORD` 403, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner.
- v5.0.0-8.2.2: the entry is reached through the organization's own relationships.
- v5.0.0-2.3.3: mirror entry and caches are one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| reverse | integration | AC-1, C-25 | mirror entry, effects |
| refusals | integration | AC-2 | each Examples row → status |
| parallel | integration | AC-3, CWE-362 | one success |
| history | integration | AC-4 | original unchanged |
| seller | security | AB-1, WSTG-ATHZ-03 | 403 |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/finance/reverse.test.ts`

## Out of scope
- Reversing an expense or a handover (FIN-013, FIN-016).
