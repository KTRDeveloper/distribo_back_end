---
id: REL-008
title: Seller lists the customers
module: relationship
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [REL-007, FND-009]
read_first: [src/modules/relationship/relationship.routes.ts, src/modules/relationship/relationship.visibility.ts]
design_refs: [relations-commerciales/customerrelationship]
constraints: [CM-19]
asvs: [v5.0.0-8.2.2, v5.0.0-8.4.1, v5.0.0-15.3.1]
---

# REL-008 — Seller lists the customers

## Story
As a seller, I want to list my customers so that I can find one to sell to.

## Context
- Exists: `POST .../customers` (REL-007); `visibleRelationsWhere`, `projectForSupplier`; pagination helpers.
- Adds: `GET /api/v1/organizations/{organizationId}/customers?limit&cursor&status&counter` (SELLER and above; DRIVER gets 403). `status` filters ACTIVE, PENDING or ENDED; `counter=true` returns only counters, `false` only customers. Rows are the organization's relationships as supplier, `projectForSupplier`, newest first.
- Adds `relationship.openapi.ts` documenting this route and REL-007's; `relationship.routes.ts` imports it for its side effect.
- `CM-19`: `customer_label` and `supplier_notes` are never sent to the customer; `supplier_label` is never sent to the supplier; each party writes only its own fields.

## Acceptance criteria
```gherkin
Scenario: AC-1 List
  Given an organization with 3 customers and the default counter
  When a SELLER lists
  Then 4 items are returned newest first, each with customer_label and supplier_notes and no supplier_label
Scenario Outline: AC-2 Filters
  When the query has <query>
  Then <count> items are returned
  Examples:
    | query           | count |
    | counter=true    | 1     |
    | counter=false   | 3     |
    | status=ENDED    | 0     |
Scenario: AC-3 Pagination
  When limit 2 is used with the returned cursor
  Then the pages hold 2 and 2 items
Scenario: AC-4 Driver refused
  When a DRIVER lists
  Then the response is 403 `FORBIDDEN`
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's customers (horizontal)
  When a member of A lists the customers of B
  Then the response is 404
Scenario: AB-2 Customer-side fields (information disclosure)
  When the list is read
  Then no supplier_label appears
```

## Implementation
- Create: `src/modules/relationship/relationship.openapi.ts`, `tests/integration/relationship/list-customers.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.schemas.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `listCustomers(actor: Actor, query: ListCustomersQuery): Promise<{ items: SupplierRelationshipView[]; next_cursor: string | null }>`
- Types:
  - `ListCustomersQuery = { limit: number; cursor?: string; status?: 'PENDING' | 'ACTIVE' | 'ENDED'; counter?: boolean }`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.2: the query starts from the visibility predicate for the actor's organization.
- v5.0.0-15.3.1: the projection lists fields explicitly.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1, CM-19 | 4 items, supplier view |
| filters | integration | AC-2 | each Examples row → count |
| paging | integration | AC-3 | 2 and 2 |
| driver | integration | AC-4 | 403 |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |
| customer fields | security | AB-2, CWE-200 | no supplier_label |

Command: `npx vitest run tests/integration/relationship/list-customers.test.ts`

## Out of scope
- Search by name.
