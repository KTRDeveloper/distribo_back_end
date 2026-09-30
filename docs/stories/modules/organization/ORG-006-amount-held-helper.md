---
id: ORG-006
title: Amount held helper
module: organization
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [ORG-003, ORG-004]
read_first: [src/modules/organization/organization.repository.ts, tests/integration/organization/collaboration-table.test.ts]
design_refs: [finances/handover, identite-et-organisation/collaboration]
constraints: [C-37]
asvs: [v5.0.0-2.3.3, v5.0.0-2.3.4]
---

# ORG-006 — Amount held helper

## Story
Technical story: provide the one function that changes a collaborator's held money, so that two simultaneous operations never lose one.

## Context
- Exists: `collaborations.amount_held` bigint default 0 (ORG-003); `organization.repository.ts`.
- Adds: `addAmountHeld(tx, personId, organizationId, delta)` running one statement, `UPDATE collaborations SET amount_held = amount_held + $delta WHERE person_id = $p AND organization_id = $o`, inside the caller's transaction. A missing collaboration throws 404 `NOT_FOUND`. The value may go negative.
- `C-37`: `CustomerRelationship.balance` and `Collaboration.amount_held` are updated by adding the effect of each operation inside its transaction, always relationship first then collaboration; a nightly check compares each total with the sum of its entries.

## Acceptance criteria
```gherkin
Scenario: AC-1 Add and subtract
  When addAmountHeld adds 5000 then -2000
  Then `amount_held` is 3000
Scenario: AC-2 Simultaneous operations
  When 20 calls each add 100 in parallel transactions
  Then `amount_held` is 2000
Scenario: AC-3 Unknown collaboration
  When the person is not a collaborator of the organization
  Then the call throws `NOT_FOUND` and changes nothing
Scenario: AC-4 Rollback
  When the caller's transaction rolls back
  Then `amount_held` is unchanged
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/organization/amount-held.test.ts`
- Modify: `src/modules/organization/organization.repository.ts`
- Pattern: `src/modules/organization/organization.repository.ts`
- Signatures:
  - `addAmountHeld(tx: Prisma.TransactionClient, personId: string, organizationId: string, delta: bigint): Promise<void>`
- Errors: `NOT_FOUND` 404
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.4: the increment is one SQL statement, never read then write.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| add and subtract | integration | AC-1, C-37 | +5000, -2000 → 3000 |
| parallel | integration | AC-2, C-37 | 20 parallel +100 → 2000 |
| unknown | integration | AC-3 | NOT_FOUND |
| rollback | integration | AC-4 | unchanged |

Command: `npx vitest run tests/integration/organization/amount-held.test.ts`

## Out of scope
- Callers (FIN module).
