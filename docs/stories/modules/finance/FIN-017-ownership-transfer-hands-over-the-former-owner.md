---
id: FIN-017
title: Ownership transfer hands over the former owner's money
module: finance
kind: change
rev: 1
amends: [ORG-015]
size: S
risk: high
depends_on: [FIN-015, ORG-015]
read_first: [src/modules/organization/organization.service.ts, src/modules/finance/held-money.ts]
design_refs: [finances/handover, identite-et-organisation/collaboration]
constraints: [CM-18, C-27]
asvs: [v5.0.0-2.3.3, v5.0.0-16.3.1]
---

# FIN-017 — Ownership transfer hands over the former owner's money

## Story
Technical story: record a handover from the former owner to themselves when ownership changes, so that the money they held goes back to the business and they restart at zero.

## Context
- Exists: `transferOwnership` (ORG-015), `recordHandoverInTx` (FIN-015).
- Changes: in the same transaction, when the former owner's `amount_held` is above 0, a handover is inserted with `from_person_id` = `to_person_id` = the former owner, the amount held, and `occurred_at` now; only the fall applies (the person keeps no new money). When it is 0 or negative no handover is written.
- `CM-18`: At ownership transfer the server records a handover from the former owner to themselves for their amount_held, so it restarts at 0.
- `C-27`: `Expense.amount` > 0 and `paid_by_id` is a collaborator of the organization, active or gone; `Handover.amount` > 0, `from_person_id` a collaborator active or gone, `from_person_id` differs from `to_person_id` except the former owner's automatic handover, `to_person_id` an ACTIVE OWNER or MANAGER; expenses and handovers are never modified, only cancelled once with `cancelled_at` and `cancelled_by_id` set together.

## Acceptance criteria
```gherkin
Scenario: AC-1 Automatic handover
  Given the owner holds 3450000
  When ownership is transferred
  Then a handover of 3450000 from and to the former owner exists and their amount_held is 0
Scenario: AC-2 Nothing held
  When the owner holds 0
  Then no handover row is written
Scenario: AC-3 Atomic
  When the handover insert fails
  Then the ownership did not change
```

## Abuse cases
```gherkin
Scenario: AB-1 Cash left behind by the former owner (tampering)
  When ownership changes while the former owner holds money
  Then the money does not stay on a person who is no longer the owner
```

## Implementation
- Create: `tests/integration/finance/transfer-handover.test.ts`
- Modify: `src/modules/organization/organization.service.ts`, `src/modules/finance/held-money.ts`
- Pattern: `src/modules/finance/held-money.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: transfer and handover are one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| automatic | integration | AC-1, CM-18, C-27 | row and zero held |
| nothing held | integration | AC-2 | no row |
| atomic | integration | AC-3, CWE-362 | unchanged |
| no cash left | security | AB-1, CWE-841 | former owner holds 0 after transfer |

Command: `npx vitest run tests/integration/finance/transfer-handover.test.ts tests/integration/organization/transfer.test.ts`

## Out of scope
- Sales made offline by the former owner (SYNC module).
