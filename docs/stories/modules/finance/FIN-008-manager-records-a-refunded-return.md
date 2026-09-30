---
id: FIN-008
title: Manager records a refunded return
module: finance
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [FIN-005, FIN-006]
read_first: [src/modules/finance/finance.service.ts, src/modules/finance/ledger.service.ts]
design_refs: [finances/ledgerentry/retour-rembourse]
constraints: [CM-21]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3]
---

# FIN-008 — Manager records a refunded return

## Story
As a manager, I want one gesture for a returned and refunded article so that the customer's balance does not move by mistake.

## Context
- Exists: `appendLedgerEntry`; REFUND and CREDIT_NOTE rules (ACC-004).
- Adds: `POST /api/v1/organizations/{organizationId}/customers/{relationshipId}/returns` with `{ id, refund_entry_id, amount, mode, note }` (`id` is the credit note's id); response 201 `{ credit_note, refund }`. One transaction writes a CREDIT_NOTE and a REFUND of the same amount: the balance is unchanged and the recorder's held money falls by the amount.
- Works on a counter (a counter can refund an anonymous customer) and on ordinary customers. Refused for the manager's own record (403 `OWN_RECORD`), a PENDING relationship, an inactive organization.
- `CM-21`: A returned-and-refunded gesture records a CREDIT_NOTE and a REFUND of the same amount in one transaction.

## Acceptance criteria
```gherkin
Scenario: AC-1 Return
  Given balance 10000 and held 30000
  When a MANAGER records a return of 10000 in cash
  Then two entries exist, the balance is still 10000 and amount_held is 20000
Scenario: AC-2 Counter
  When the return is on a counter
  Then it succeeds and the counter's balance stays 0
Scenario: AC-3 Atomic
  When the second entry fails
  Then neither entry exists
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                      | status                |
    | a SELLER caller              | 403 FORBIDDEN         |
    | the manager's own record     | 403 OWN_RECORD        |
    | amount 0 or mode missing     | 400 VALIDATION_ERROR  |
```

## Abuse cases
```gherkin
Scenario: AB-1 Refund without credit note (tampering)
  When the request would create only the REFUND
  Then no such route exists and the balance rule keeps both entries together
```

## Implementation
- Create: `tests/integration/finance/return.test.ts`
- Modify: `src/modules/finance/finance.routes.ts`, `src/modules/finance/finance.schemas.ts`, `src/modules/finance/finance.service.ts`
- Pattern: `src/modules/finance/finance.routes.ts`
- Signatures:
  - `recordReturn(actor: Actor, relationshipId: string, input: ReturnInput): Promise<{ credit_note: LedgerEntryView; refund: LedgerEntryView }>`
- Types:
  - `ReturnInput = { id: string; refund_entry_id: string; amount: number; mode: 'CASH' | 'MOBILE_MONEY'; note: string }`
- Errors: `OWN_RECORD` 403, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner.
- v5.0.0-2.3.3: both entries and caches in one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| return | integration | AC-1, CM-21 | two entries, balance same, held down |
| counter | integration | AC-2 | ok |
| atomic | integration | AC-3, CWE-362 | nothing stored |
| refusals | integration | AC-4 | each Examples row → status |
| no lone refund | security | AB-1 | both entries always share the amount |

Command: `npx vitest run tests/integration/finance/return.test.ts`

## Out of scope
- Tracking the returned goods (no stock in v1).
