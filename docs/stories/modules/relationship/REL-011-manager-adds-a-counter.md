---
id: REL-011
title: Manager adds a counter
module: relationship
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [REL-007, ACC-002, REL-008]
read_first: [src/modules/relationship/relationship.service.ts, src/modules/relationship/relationship.repository.ts]
design_refs: [relations-commerciales/customerrelationship/comptoirs]
constraints: [C-06, C-10]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]
---

# REL-011 — Manager adds a counter

## Story
As a manager, I want to add a named counter so that sales at another place have their own prices.

## Context
- Exists: `createCounter` (REL-006); the ACC-002 rule for MANAGER, ONLINE, create, CustomerRelationship with condition `counter: true` (Q-029); `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/counters` with `{ id, customer_label }`; response 201 `projectForSupplier`. The service checks the ability with subject `{ counter: true }`.
- A counter has no customer, `credit_limit` 0, status ACTIVE. Two counters of one organization may not share a label (409 `COUNTER_LABEL_TAKEN`).
- `C-06`: A relationship has exactly one supplier (organization or person); at most one customer (person or organization), none only for a counter, and then `customer_label` is required; `customer_phone_number` is empty once `customer_person_id` is set.
- `C-10`: `credit_limit` is 0 at creation and always 0 for a counter; `credit_limit_set_by_id` and `credit_limit_set_at` are set together; every change adds one `CreditLimitChange` row in the same transaction.

## Acceptance criteria
```gherkin
Scenario: AC-1 Add
  When a MANAGER posts "Comptoir usine"
  Then the response is 201 and a counter with that label and credit_limit 0 exists
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                            | status                   |
    | a SELLER caller                    | 403 FORBIDDEN            |
    | an empty label                     | 400 VALIDATION_ERROR     |
    | a label already used by a counter  | 409 COUNTER_LABEL_TAKEN  |
    | credit_limit in the body           | 400 VALIDATION_ERROR     |
Scenario: AC-3 Repeat
  When the same body is posted twice
  Then one counter exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller creates a counter (vertical)
  When a SELLER or DRIVER posts
  Then the response is 403 and nothing is stored
```

## Implementation
- Create: `tests/integration/relationship/add-counter.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `addCounter(actor: Actor, input: { id: string; customer_label: string }): Promise<SupplierRelationshipView>`
- Errors: `COUNTER_LABEL_TAKEN` 409, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager and online only.
- v5.0.0-15.3.3: strict schema with two fields.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| add | integration | AC-1, C-06, C-10 | 201, counter |
| refusals | integration | AC-2 | each Examples row → status |
| repeat | integration | AC-3 | one counter |
| seller | security | AB-1, WSTG-ATHZ-03 | 403 |

Command: `npx vitest run tests/integration/relationship/add-counter.test.ts`

## Out of scope
- Counter prices (CAT module).
