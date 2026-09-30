---
id: REL-009
title: Seller opens one customer
module: relationship
kind: feature
rev: 1
amends: []
size: XS
risk: medium
depends_on: [REL-008]
read_first: [src/modules/relationship/relationship.routes.ts, src/modules/relationship/relationship.service.ts]
design_refs: [relations-commerciales/customerrelationship]
constraints: [CM-19]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# REL-009 — Seller opens one customer

## Story
As a seller, I want to open a customer's record so that I see their balance, credit limit and notes.

## Context
- Exists: `GET .../customers` (REL-008).
- Adds: `GET /api/v1/organizations/{organizationId}/customers/{relationshipId}` (SELLER and above) returning `projectForSupplier`. An id outside the organization's relationships, malformed or deleted answers 404 or 400.
- `CM-19`: `customer_label` and `supplier_notes` are never sent to the customer; `supplier_label` is never sent to the supplier; each party writes only its own fields.

## Acceptance criteria
```gherkin
Scenario: AC-1 Open
  When a SELLER opens a customer of their organization
  Then the response is 200 with the supplier view including balance and credit_limit
Scenario Outline: AC-2 Not found
  When the id is <case>
  Then the response is <status>
  Examples:
    | case                                  | status |
    | a relationship of another business    | 404    |
    | a deleted relationship                | 404    |
    | not a UUID                            | 400    |
Scenario: AC-3 Driver refused
  Then a DRIVER gets 403
```

## Abuse cases
```gherkin
Scenario: AB-1 Reading a relationship by id from another business (horizontal)
  When a member of A requests a relationship id of B under A's path
  Then the response is 404
```

## Implementation
- Create: `tests/integration/relationship/get-customer.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `getCustomer(actor: Actor, relationshipId: string): Promise<SupplierRelationshipView>`
- Errors: `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: the row is selected by id and the visibility predicate together.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| open | integration | AC-1, CM-19 | supplier view |
| not found | integration | AC-2 | each Examples row → status |
| driver | integration | AC-3 | 403 |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/relationship/get-customer.test.ts`

## Out of scope
- Orders and ledger of the customer (ORD, FIN modules).
