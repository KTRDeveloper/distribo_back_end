---
id: REL-020
title: Customer invites a supplier by phone number
module: relationship
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [REL-016, ORG-018, ACC-005, ACC-007, PER-006, REL-006, REL-007, REL-008]
read_first: [src/modules/relationship/relationship.repository.ts, src/modules/organization/organization.repository.ts]
design_refs: [relations-commerciales/customerrelationship/invitation-d-un-fournisseur-par-un]
constraints: [C-06, C-07, C-08, C-10]
asvs: [v5.0.0-8.2.1, v5.0.0-2.4.1, v5.0.0-15.3.3]
---

# REL-020 — Customer invites a supplier by phone number

## Story
As a customer, I want to invite a supplier by phone number so that we can trade once they join.

## Context
- Exists: `findOrCreateByPhone`; `findOrganizationsByPublicNumber` (ORG-018); the shared lookup limit key `lookup:<personId>` (PER-006); `requireAbility('invite_supplier', 'CustomerRelationship')` for an organization (MANAGER, network); `idempotent()`.
- Adds: `POST /api/v1/suppliers/invitations` (a registered person as customer) and `POST /api/v1/organizations/{organizationId}/suppliers/invitations` (an organization as customer, MANAGER or OWNER), both with `{ id, phone_number, supplier_label }`; response 201 `projectForCustomer`.
- The number must not be a public number of an organization (409 `NUMBER_IS_ORGANIZATION`: the customer orders from it instead). The supplier person is found or created as a guest. The relationship is PENDING, `supplier_person_id` set, `credit_limit` 0, `created_by_id` the caller. An existing live relationship for the pair answers 409 `RELATIONSHIP_EXISTS`.
- Each call consumes one unit of the caller's lookup limit (60 per hour); over it answers 429 `RATE_LIMITED`. No SMS is sent; the customer sends the invitation from their own phone.
- `C-06`: A relationship has exactly one supplier (organization or person); at most one customer (person or organization), none only for a counter, and then `customer_label` is required; `customer_phone_number` is empty once `customer_person_id` is set.
- `C-07`: At most one live relationship per (supplier, customer) pair, ignoring deleted and merged rows (partial unique indexes per column combination); `supplier_organization_id` differs from `customer_organization_id`; `merged_into_id` set means the row is deleted.
- `C-08`: `status` is PENDING if and only if `supplier_person_id` is set.
- `C-10`: `credit_limit` is 0 at creation and always 0 for a counter; `credit_limit_set_by_id` and `credit_limit_set_at` are set together; every change adds one `CreditLimitChange` row in the same transaction.

## Acceptance criteria
```gherkin
Scenario: AC-1 Person invites
  When a customer person invites a number that no organization publishes, with supplier_label "Chez Paul"
  Then the response is 201, the relationship is PENDING with supplier_person_id set and credit_limit 0
Scenario: AC-2 Organization invites
  When a MANAGER invites on behalf of their organization
  Then the customer of the relationship is that organization
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is stored
  Examples:
    | problem                                     | status                   |
    | a public number of an organization          | 409 NUMBER_IS_ORGANIZATION |
    | the number of an existing live relationship | 409 RELATIONSHIP_EXISTS  |
    | a SELLER on behalf of an organization       | 403 FORBIDDEN            |
    | a landline                                  | 400 VALIDATION_ERROR     |
    | supplier_label empty                        | 400 VALIDATION_ERROR     |
Scenario: AC-4 Limit
  When 61 invitations or lookups are made in one hour
  Then the 61st answers 429 `RATE_LIMITED`
```

## Abuse cases
```gherkin
Scenario: AB-1 Order or credit on a pending supplier (business logic)
  Then the relationship is PENDING, so no order can be placed on it (ORD rule) and its credit limit is 0
Scenario: AB-2 Probing numbers through invitations (anti-automation)
  When one person sends invitations to 61 numbers in an hour
  Then the 61st is refused with 429
Scenario: AB-3 Server-owned fields (mass assignment)
  When the body contains status, credit_limit or supplier_organization_id
  Then the response is 400
```

## Implementation
- Create: `tests/integration/relationship/invite-supplier.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `inviteSupplier(viewer: { personId: string; organizationId?: string; role?: Role }, input: InviteSupplierInput): Promise<CustomerRelationshipView>`
- Types:
  - `InviteSupplierInput = { id: string; phone_number: string; supplier_label: string }`
- Errors: `NUMBER_IS_ORGANIZATION` 409, `RELATIONSHIP_EXISTS` 409, `RATE_LIMITED` 429, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`, `ioredis`

## Security
- v5.0.0-8.2.1: an organization customer is represented by a MANAGER or OWNER only, online.
- v5.0.0-2.4.1: shared per-person lookup limit.
- v5.0.0-15.3.3: strict schema with three fields.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| person invites | integration | AC-1, C-08, C-06, C-10 | 201, PENDING |
| organization invites | integration | AC-2 | organization as customer |
| refusals | integration | AC-3, C-07 | each Examples row → status |
| limit | integration | AC-4 | 61st → 429 |
| pending is inert | security | AB-1, CWE-841 | limit 0, status PENDING |
| probing | security | AB-2, WSTG-BUSL-07 | 429 |
| mass assignment | security | AB-3, CWE-915 | 400 |

Command: `npx vitest run tests/integration/relationship/invite-supplier.test.ts`

## Out of scope
- The supplier accepting (REL-021).
