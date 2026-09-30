---
id: REL-012
title: Owner or manager sets a credit limit
module: relationship
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [REL-009, REL-004, ACC-002, ACC-007, NTF-002]
read_first: [src/modules/relationship/relationship.service.ts, src/modules/relationship/relationship.repository.ts]
design_refs: [relations-commerciales/customerrelationship/plafond-de-credit-une-seule-regle, relations-commerciales/creditlimitchange]
constraints: [C-10, C-04]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-16.3.1]
---

# REL-012 — Owner or manager sets a credit limit

## Story
As an owner, I want to set a customer's credit limit so that credit is granted only by decision.

## Context
- Exists: the credit rules and the journal trigger (REL-004); `requireAbility('update', 'CustomerRelationship')` field `credit_limit` (ACC-002: MANAGER online, OWNER always); `notify`; `idempotent()`.
- Adds: `PUT /api/v1/organizations/{organizationId}/customers/{relationshipId}/credit-limit` with `{ id, credit_limit }`, an integer of at least 0 or `null` (no ceiling); response 200 `projectForSupplier`.
- One update sets `credit_limit`, `credit_limit_set_by_id` (the caller) and `credit_limit_set_at`; the trigger writes the journal.
- Refused: a counter (409 `COUNTER_NO_CREDIT`); a relationship where the caller is the customer or manages the customer organization (403 `OWN_RECORD`; such gestures return to the owner, and an owner is refused only on a customer person equal to themselves); a PENDING or ENDED relationship (409 `RELATIONSHIP_NOT_ACTIVE`).
- When a MANAGER raises a limit, the owner gets a notification `credit_limit.raised`.
- `C-10`: `credit_limit` is 0 at creation and always 0 for a counter; `credit_limit_set_by_id` and `credit_limit_set_at` are set together; every change adds one `CreditLimitChange` row in the same transaction.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.

## Acceptance criteria
```gherkin
Scenario: AC-1 Set a limit
  When an OWNER sets 100000 on an ACTIVE customer
  Then the response is 200, credit_limit is 100000, the author is the OWNER and one journal row exists
Scenario: AC-2 Manager raises
  When a MANAGER raises the limit to 500000
  Then the owner gets one notification `credit_limit.raised`
Scenario: AC-3 Lower and clear
  When the limit is lowered to 20000, then set to null
  Then two more journal rows exist, the last with new_limit empty
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status> and the limit is unchanged
  Examples:
    | problem                                      | status                    |
    | a SELLER or DRIVER caller                    | 403 FORBIDDEN             |
    | a counter                                    | 409 COUNTER_NO_CREDIT     |
    | credit_limit -1                              | 400 VALIDATION_ERROR      |
    | credit_limit 1.5                             | 400 VALIDATION_ERROR      |
    | a manager on their own customer record       | 403 OWN_RECORD            |
    | a PENDING or ENDED relationship              | 409 RELATIONSHIP_NOT_ACTIVE |
Scenario: AC-5 Repeat
  When the same id is sent twice
  Then one journal row exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller or driver grants credit (vertical)
  When a SELLER or DRIVER puts a limit
  Then the response is 403 and no journal row exists
Scenario: AB-2 Manager grants credit to themselves (elevation)
  When a MANAGER who is the customer person raises their own limit
  Then the response is 403 `OWN_RECORD`
Scenario: AB-3 Author chosen by the client (mass assignment)
  When the body contains credit_limit_set_by_id or credit_limit_set_at
  Then the response is 400
```

## Implementation
- Create: `tests/integration/relationship/credit-limit.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `setCreditLimit(actor: Actor, relationshipId: string, input: { id: string; credit_limit: number | null }): Promise<SupplierRelationshipView>`
- Errors: `COUNTER_NO_CREDIT` 409, `OWN_RECORD` 403, `RELATIONSHIP_NOT_ACTIVE` 409, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: owner, or manager online, decided by the rules table.
- v5.0.0-2.3.3: limit, author, time and journal row are one statement.
- v5.0.0-16.3.1: log `warn` event `credit_limit_changed` with relationship id, author id, previous and new limit.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| set | integration | AC-1, C-10, C-04 | 200, author, one journal row |
| manager raises | integration | AC-2 | owner notified |
| lower and clear | integration | AC-3 | three rows, last new_limit empty |
| refusals | integration | AC-4 | each Examples row → status, unchanged |
| repeat | integration | AC-5 | one row |
| seller or driver | security | AB-1, WSTG-ATHZ-03 | 403, no row |
| own record | security | AB-2, CWE-639 | 403 OWN_RECORD |
| author from client | security | AB-3, CWE-915 | 400 |

Command: `npx vitest run tests/integration/relationship/credit-limit.test.ts`

## Out of scope
- Raising the limit inside a sale (DLV module).
