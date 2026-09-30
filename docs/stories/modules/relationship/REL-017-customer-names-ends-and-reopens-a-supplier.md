---
id: REL-017
title: Customer names, ends and reopens a supplier
module: relationship
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [REL-016, ACC-007, REL-006, REL-007, REL-008]
read_first: [src/modules/relationship/relationship.service.ts, src/modules/relationship/relationship.routes.ts]
design_refs: [relations-commerciales/customerrelationship/fin-de-relation, relations-commerciales/customerrelationship]
constraints: [C-09, CM-19]
asvs: [v5.0.0-8.2.2, v5.0.0-8.2.3, v5.0.0-15.3.3]
---

# REL-017 — Customer names, ends and reopens a supplier

## Story
As a customer, I want to name a supplier, leave one, and come back so that my list stays mine.

## Context
- Exists: `GET /api/v1/suppliers` (REL-016); `idempotent()`.
- Adds: `PATCH /api/v1/suppliers/{relationshipId}` with `{ supplier_label }` (1 to 100); `POST /api/v1/suppliers/{relationshipId}/end` and `.../reopen` with `{ id }`. Responses 200 `projectForCustomer`.
- The caller must be `customer_person_id`. End: ACTIVE becomes ENDED with `ended_by_party` CUSTOMER; balance and payments stay. Reopen only when the customer ended it; otherwise 409 `ENDED_BY_OTHER_PARTY`.
- `C-09`: `ended_by_party` is set if and only if `status` is ENDED; only that party may reopen the relationship.
- `CM-19`: `customer_label` and `supplier_notes` are never sent to the customer; `supplier_label` is never sent to the supplier; each party writes only its own fields.

## Acceptance criteria
```gherkin
Scenario: AC-1 Name a supplier
  When the customer patches supplier_label "Chez Fotso"
  Then the response is 200 with that label and the supplier never sees it
Scenario: AC-2 End and reopen
  When the customer ends an ACTIVE relationship and then reopens it
  Then it is ENDED with ended_by_party CUSTOMER, then ACTIVE with ended_by_party empty
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                                           | status                   |
    | reopening a relationship the supplier ended       | 409 ENDED_BY_OTHER_PARTY |
    | supplier_label of 101 characters                  | 400 VALIDATION_ERROR     |
    | credit_limit or customer_label in the body        | 400 VALIDATION_ERROR     |
    | a relationship of another person                  | 404 NOT_FOUND            |
```

## Abuse cases
```gherkin
Scenario: AB-1 Reopening a block (tampering)
  When a customer blocked by the supplier posts reopen
  Then the response is 409 and it stays ENDED
Scenario: AB-2 Another person's relationship (horizontal)
  When person A patches or ends a relationship of person B
  Then the response is 404 and it is unchanged
```

## Implementation
- Create: `tests/integration/relationship/customer-actions.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `customerEditSupplier(personId: string, relationshipId: string, input: { supplier_label: string }): Promise<CustomerRelationshipView>`
  - `customerEndRelationship(personId: string, relationshipId: string): Promise<CustomerRelationshipView>`
  - `customerReopenRelationship(personId: string, relationshipId: string): Promise<CustomerRelationshipView>`
- Errors: `ENDED_BY_OTHER_PARTY` 409, `VALIDATION_ERROR` 400, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: the row is selected with the caller's person id as customer.
- v5.0.0-15.3.3: only `supplier_label` is writable.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| set label | integration | AC-1, CM-19 | label stored, invisible to supplier |
| end and reopen | integration | AC-2, C-09 | states as described |
| refusals | integration | AC-3 | each Examples row → status |
| reopen a block | security | AB-1, CWE-841 | 409 |
| other person | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/relationship/customer-actions.test.ts`

## Out of scope
- Organization customers (REL-018, REL-019).
