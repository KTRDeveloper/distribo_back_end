---
id: REL-016
title: Customer lists their suppliers
module: relationship
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [REL-005, FND-009, REL-006, REL-007, REL-008]
read_first: [src/modules/relationship/relationship.routes.ts, src/modules/relationship/relationship.visibility.ts]
design_refs: [relations-commerciales/customerrelationship]
constraints: [CM-19]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# REL-016 — Customer lists their suppliers

## Story
As a customer, I want to list my suppliers so that I see who I buy from and what I owe.

## Context
- Exists: `visibleRelationsWhere`, `projectForCustomer` (REL-005); pagination.
- Adds: `GET /api/v1/suppliers?limit&cursor&status` for any signed-in person: relationships where `customer_person_id` is the caller (ACTIVE, ENDED, and PENDING invitations the caller sent), newest first, `projectForCustomer`.
- `CM-19`: `customer_label` and `supplier_notes` are never sent to the customer; `supplier_label` is never sent to the supplier; each party writes only its own fields.

## Acceptance criteria
```gherkin
Scenario: AC-1 List
  Given a person who is the customer of two organizations and invited one supplier
  When they list
  Then three items are returned with supplier_label and balance and without customer_label or supplier_notes
Scenario: AC-2 Status filter
  When status=PENDING is used
  Then only the invitation is returned
Scenario: AC-3 Pagination
  When limit 2 is used with the returned cursor
  Then the pages hold 2 and 1 items
Scenario: AC-4 Only own
  Then relationships of other people and deleted rows never appear
```

## Abuse cases
```gherkin
Scenario: AB-1 Another person's suppliers (horizontal)
  When person A lists
  Then no relationship of person B appears
Scenario: AB-2 Supplier-side fields (information disclosure)
  When the list is read
  Then no customer_label or supplier_notes appears
```

## Implementation
- Create: `tests/integration/relationship/list-suppliers.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `listSuppliersOfPerson(personId: string, query: ListSuppliersQuery): Promise<{ items: CustomerRelationshipView[]; next_cursor: string | null }>`
- Errors: `UNAUTHORIZED` 401, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: the filter is the visibility predicate for the caller's person id.
- v5.0.0-15.3.1: customer projection only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1, CM-19 | three items, customer view |
| status | integration | AC-2 | PENDING only |
| paging | integration | AC-3 | 2 and 1 |
| only own | integration | AC-4 | none foreign |
| other person | security | AB-1, WSTG-ATHZ-04 | no foreign rows |
| supplier fields | security | AB-2, CWE-200 | absent |

Command: `npx vitest run tests/integration/relationship/list-suppliers.test.ts`

## Out of scope
- Organizations as customers (REL-018).
