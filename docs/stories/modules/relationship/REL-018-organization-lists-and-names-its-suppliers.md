---
id: REL-018
title: Organization lists and names its suppliers
module: relationship
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [REL-017, ACC-002, REL-006, REL-007, REL-008]
read_first: [src/modules/relationship/relationship.service.ts, src/modules/relationship/relationship.routes.ts]
design_refs: [relations-commerciales/customerrelationship/organisation-cliente]
constraints: [CM-19]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# REL-018 — Organization lists and names its suppliers

## Story
As a manager, I want to list and name the suppliers of my business so that its purchases are organized.

## Context
- Exists: customer-side views and label edit for persons (REL-016, REL-017); `loadActor`.
- Adds: `GET /api/v1/organizations/{organizationId}/suppliers` (MANAGER and above; paginated `projectForCustomer` of relationships where the organization is `customer_organization_id`) and `PATCH /api/v1/organizations/{organizationId}/suppliers/{relationshipId}` with `{ supplier_label }` (MANAGER online).
- A SELLER or DRIVER answers 403.
- `CM-19`: `customer_label` and `supplier_notes` are never sent to the customer; `supplier_label` is never sent to the supplier; each party writes only its own fields.

## Acceptance criteria
```gherkin
Scenario: AC-1 List
  Given an organization that buys from two suppliers
  When its MANAGER lists
  Then two items are returned in the customer view
Scenario: AC-2 Name
  When the MANAGER patches supplier_label
  Then the response is 200 with the label
Scenario Outline: AC-3 Roles
  When the caller is <role>
  Then GET answers <status>
  Examples:
    | role    | status |
    | OWNER   | 200    |
    | MANAGER | 200    |
    | SELLER  | 403    |
    | DRIVER  | 403    |
Scenario: AC-4 Limits
  When supplier_label has 101 characters or the body has other keys
  Then the response is 400
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's suppliers (horizontal)
  When a member of A lists or patches for business B
  Then the response is 404
Scenario: AB-2 Supplier-side fields (information disclosure)
  When the list is read
  Then no customer_label or supplier_notes appears
```

## Implementation
- Create: `tests/integration/relationship/org-suppliers.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `listSuppliersOfOrganization(actor: Actor, query: ListSuppliersQuery): Promise<{ items: CustomerRelationshipView[]; next_cursor: string | null }>`
  - `orgEditSupplier(actor: Actor, relationshipId: string, input: { supplier_label: string }): Promise<CustomerRelationshipView>`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager and above; the label edit online.
- v5.0.0-15.3.1: customer projection only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1, CM-19 | two items |
| set label | integration | AC-2 | label stored |
| roles | integration | AC-3 | each Examples row → status |
| limits | integration | AC-4 | 400 |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |
| supplier fields | security | AB-2, CWE-200 | absent |

Command: `npx vitest run tests/integration/relationship/org-suppliers.test.ts`

## Out of scope
- Ending and reopening as an organization (REL-019).
