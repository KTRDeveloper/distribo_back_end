---
id: REL-015
title: Manager ends and reopens a relationship as supplier
module: relationship
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [REL-009, ACC-002, ACC-007]
read_first: [src/modules/relationship/relationship.service.ts, src/modules/relationship/relationship.routes.ts]
design_refs: [relations-commerciales/customerrelationship/fin-de-relation]
constraints: [C-09]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.1]
---

# REL-015 — Manager ends and reopens a relationship as supplier

## Story
As a manager, I want to end a relationship with a customer, and reopen it, so that I can block a customer and later accept them again.

## Context
- Exists: `GET .../customers/{id}` (REL-009); rules `end` and `reopen` on CustomerRelationship for MANAGER online (ACC-002, Q-030); `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/customers/{relationshipId}/end` and `.../reopen` with `{ id }`; response 200 `projectForSupplier`.
- End: ACTIVE becomes ENDED with `ended_by_party` SUPPLIER; history, balance and payments stay. Reopen: only when ENDED with `ended_by_party` SUPPLIER; a relationship ended by the customer answers 409 `ENDED_BY_OTHER_PARTY`.
- A counter cannot be ended (409 `COUNTER_CANNOT_END`); a PENDING relationship cannot be ended here (409 `RELATIONSHIP_NOT_ACTIVE`).
- `C-09`: `ended_by_party` is set if and only if `status` is ENDED; only that party may reopen the relationship.

## Acceptance criteria
```gherkin
Scenario: AC-1 End
  When a MANAGER ends an ACTIVE customer relationship
  Then it is ENDED with ended_by_party SUPPLIER and the balance is unchanged
Scenario: AC-2 Reopen own closure
  When the manager reopens it
  Then it is ACTIVE with ended_by_party empty
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                                        | status                      |
    | reopening a relationship the customer ended    | 409 ENDED_BY_OTHER_PARTY    |
    | ending a counter                               | 409 COUNTER_CANNOT_END      |
    | ending a PENDING relationship                  | 409 RELATIONSHIP_NOT_ACTIVE |
    | a SELLER caller                                | 403 FORBIDDEN               |
Scenario: AC-4 Repeat
  When the same id is sent twice
  Then both answers are equal
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller blocks a customer (vertical)
  When a SELLER or DRIVER posts end
  Then the response is 403 and nothing changes
Scenario: AB-2 Reopening a relationship ended by the customer (tampering)
  When the supplier reopens a relationship the customer ended
  Then the response is 409 and it stays ENDED
```

## Implementation
- Create: `tests/integration/relationship/end-reopen-supplier.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `endRelationship(actor: Actor, relationshipId: string): Promise<SupplierRelationshipView>`
  - `reopenRelationship(actor: Actor, relationshipId: string): Promise<SupplierRelationshipView>`
- Errors: `ENDED_BY_OTHER_PARTY` 409, `COUNTER_CANNOT_END` 409, `RELATIONSHIP_NOT_ACTIVE` 409, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager and online only.
- v5.0.0-2.3.1: state transitions are checked in one conditional update.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| end | integration | AC-1, C-09 | ENDED, SUPPLIER, balance same |
| reopen | integration | AC-2, C-09 | ACTIVE |
| refusals | integration | AC-3 | each Examples row → status |
| repeat | integration | AC-4 | equal answers |
| seller | security | AB-1, WSTG-ATHZ-03 | 403 |
| other party | security | AB-2, CWE-841 | 409 |

Command: `npx vitest run tests/integration/relationship/end-reopen-supplier.test.ts`

## Out of scope
- Refusing new orders on an ended relationship (ORD module).
