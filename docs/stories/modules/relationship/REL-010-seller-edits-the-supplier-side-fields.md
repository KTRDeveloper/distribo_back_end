---
id: REL-010
title: Seller edits the supplier-side fields
module: relationship
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [REL-009, ACC-002]
read_first: [src/modules/relationship/relationship.service.ts, src/shared/access/ability.ts]
design_refs: [relations-commerciales/customerrelationship]
constraints: [CM-19, C-06]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.3, v5.0.0-15.3.3]
---

# REL-010 — Seller edits the supplier-side fields

## Story
As a seller, I want to change a customer's label, address and notes so that my records stay right.

## Context
- Exists: `GET .../customers/{id}` (REL-009); `abilityFor` with the ACC-002 field rules.
- Adds: `PATCH /api/v1/organizations/{organizationId}/customers/{relationshipId}` with any of `customer_label` (1 to 100), `delivery_address` (up to 2000), `supplier_notes` (up to 2000; null clears); response 200 `projectForSupplier`.
- The service asks `abilityFor(role, { onServer: false, online: true, daysSinceSync: 0 })` whether the role may update each field sent; a field not allowed answers 403 `FORBIDDEN` and nothing is changed. At least one field is required.
- `CM-19`: `customer_label` and `supplier_notes` are never sent to the customer; `supplier_label` is never sent to the supplier; each party writes only its own fields.
- `C-06`: A relationship has exactly one supplier (organization or person); at most one customer (person or organization), none only for a counter, and then `customer_label` is required; `customer_phone_number` is empty once `customer_person_id` is set.

## Acceptance criteria
```gherkin
Scenario: AC-1 Edit
  When a SELLER patches customer_label and supplier_notes
  Then the response is 200 with the new values
Scenario Outline: AC-2 Limits
  When the body has <field> = <value>
  Then the response is <status>
  Examples:
    | field           | value      | status |
    | customer_label  | empty      | 400    |
    | customer_label  | 101 chars  | 400    |
    | supplier_notes  | 2001 chars | 400    |
    | (no field)      |            | 400    |
Scenario: AC-3 Counter label
  When a counter's customer_label is set to empty
  Then the response is 400 because a counter needs a label
Scenario: AC-4 Driver refused
  Then a DRIVER gets 403
```

## Abuse cases
```gherkin
Scenario: AB-1 Credit and balance in the body (mass assignment)
  When the body contains credit_limit, balance, status, supplier_label or customer_person_id
  Then the response is 400 and nothing changes
Scenario: AB-2 Another business's customer (horizontal)
  When a member of A patches a relationship of B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/relationship/edit-customer.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `editCustomer(actor: Actor, relationshipId: string, input: EditCustomerInput): Promise<SupplierRelationshipView>`
- Types:
  - `EditCustomerInput = { customer_label?: string; delivery_address?: string | null; supplier_notes?: string | null }`
- Errors: `VALIDATION_ERROR` 400, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.3: field-level check per key through the rules table.
- v5.0.0-15.3.3: strict schema with three optional fields.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| edit | integration | AC-1, CM-19 | 200, new values |
| limits | integration | AC-2 | each Examples row → 400 |
| counter label | integration | AC-3, C-06 | 400 |
| driver | integration | AC-4 | 403 |
| mass assignment | security | AB-1, CWE-915 | 400, unchanged |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/relationship/edit-customer.test.ts`

## Out of scope
- Credit limit (REL-012). Ending the relationship (REL-014).
