---
id: REL-007
title: Seller adds a customer by phone number
module: relationship
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [REL-006, REL-005, ACC-002, ACC-007, PER-005, NTF-002]
read_first: [docs/stories/modules/relationship/contracts.md, src/modules/relationship/relationship.repository.ts]
design_refs: [relations-commerciales/customerrelationship/entree-en-relation-le-numero-comme, relations-commerciales/customerrelationship]
constraints: [C-06, C-07, C-10]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, v5.0.0-2.3.3]
---

# REL-007 — Seller adds a customer by phone number

## Story
As a seller, I want to add a customer by phone number so that I can sell to them at once.

## Context
- Exists: `createCounter` (REL-006); `findOrCreateByPhone` (PER-005); `requireAbility('create', 'CustomerRelationship')` (ACC-002, DAYS_3 rule; this route is online); `assertOrganizationActive`; `idempotent()`; `notify`; `projectForSupplier` (REL-005).
- Adds: `POST /api/v1/organizations/{organizationId}/customers` with `{ id, phone_number, customer_label?, delivery_address? }` and `ensureCustomerRelationship` in `relationship.repository.ts`. Response 201 with `projectForSupplier`.
- The person is found or created as a guest. The relationship is ACTIVE, `credit_limit` 0, `balance` 0, `created_by_id` the caller. An existing live relationship for the same organization and person is returned with 200 instead of creating another. A registered customer gets a notification `customer.added`.
- `customer_label` 1 to 100 characters, `delivery_address` up to 2000 (Q-027). The organization must be ACTIVE.
- `C-06`: A relationship has exactly one supplier (organization or person); at most one customer (person or organization), none only for a counter, and then `customer_label` is required; `customer_phone_number` is empty once `customer_person_id` is set.
- `C-07`: At most one live relationship per (supplier, customer) pair, ignoring deleted and merged rows (partial unique indexes per column combination); `supplier_organization_id` differs from `customer_organization_id`; `merged_into_id` set means the row is deleted.
- `C-10`: `credit_limit` is 0 at creation and always 0 for a counter; `credit_limit_set_by_id` and `credit_limit_set_at` are set together; every change adds one `CreditLimitChange` row in the same transaction.

## Acceptance criteria
```gherkin
Scenario: AC-1 New customer
  When a seller posts a new number with label "Maman Ngono"
  Then the response is 201, the relationship is ACTIVE with credit_limit 0 and balance 0, and a guest person holds the number
Scenario: AC-2 Registered customer is notified
  When the number belongs to a registered person
  Then that person has one unread notification `customer.added`
Scenario: AC-3 Existing customer
  When the same number is added again
  Then the response is 200 with the same relationship and nothing new is created
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is stored
  Examples:
    | problem                            | status                      |
    | a landline                         | 400 VALIDATION_ERROR        |
    | customer_label of 101 characters   | 400 VALIDATION_ERROR        |
    | a CLOSED organization              | 409 ORGANIZATION_NOT_ACTIVE |
    | a DRIVER caller                    | 403 FORBIDDEN               |
Scenario: AC-5 Repeat of one gesture
  When the same body with the same id is posted twice
  Then both answers are equal
```

## Abuse cases
```gherkin
Scenario: AB-1 Credit chosen by the client (mass assignment)
  When the body contains credit_limit, balance, status or created_by_id
  Then the response is 400 and nothing is stored
Scenario: AB-2 Adding a customer to another business (horizontal)
  When a member of A posts to business B
  Then the response is 404
```

## Implementation
- Create: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `tests/integration/relationship/add-customer.test.ts`
- Modify: `src/modules/relationship/relationship.repository.ts`, `src/app.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `addCustomer(actor: Actor, input: AddCustomerInput): Promise<{ created: boolean; relationship: SupplierRelationshipView }>`
  - `ensureCustomerRelationship(tx: Prisma.TransactionClient, input: EnsureInput): Promise<{ relationship: CustomerRelationship; created: boolean }>`
- Types:
  - `AddCustomerInput = { id: string; phone_number: string; customer_label?: string; delivery_address?: string }`
- Errors: `VALIDATION_ERROR` 400, `ORGANIZATION_NOT_ACTIVE` 409, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: behind `loadActor` and `requireAbility`.
- v5.0.0-15.3.3: strict schema with four fields; the credit limit starts at 0.
- v5.0.0-2.3.3: person, relationship and notification are written together.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| new customer | integration | AC-1, C-06, C-10 | 201, ACTIVE, limit 0, guest person |
| notified | integration | AC-2 | notification row |
| existing | integration | AC-3, C-07 | 200, no new row |
| refusals | integration | AC-4 | each Examples row → status |
| repeat | integration | AC-5 | equal answers |
| mass assignment | security | AB-1, CWE-915 | 400 |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/relationship/add-customer.test.ts`

## Out of scope
- Adding a customer offline: the phone writes `customer_phone_number` and the server resolves it (SYNC module).
- OpenAPI registration of this route (REL-008).
