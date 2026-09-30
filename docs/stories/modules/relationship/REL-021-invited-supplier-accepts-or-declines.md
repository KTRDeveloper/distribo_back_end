---
id: REL-021
title: Invited supplier accepts or declines
module: relationship
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [REL-020, REL-006, REL-007, REL-008]
read_first: [src/modules/relationship/relationship.service.ts, src/modules/relationship/relationship.repository.ts]
design_refs: [relations-commerciales/customerrelationship/invitation-d-un-fournisseur-par-un]
constraints: [CM-25, C-08, C-07]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-2.3.3]
---

# REL-021 — Invited supplier accepts or declines

## Story
As a manager, I want to see the customers who invited me and accept them for my business so that they become my customers.

## Context
- Exists: PENDING relationships (REL-020); `getActiveCollaboration`.
- Adds: `GET /api/v1/supplier-invitations` (relationships with `supplier_person_id` = caller, PENDING; `id, supplier_label, customer` public view); `POST /api/v1/supplier-invitations/{id}/accept` with `{ organization_id }`; `POST /api/v1/supplier-invitations/{id}/decline`.
- Accept: the caller must be MANAGER or OWNER of `organization_id` (ACTIVE, not CLOSED or SUSPENDED). One transaction sets `supplier_person_id` empty, `supplier_organization_id` = the organization and status ACTIVE. If the organization already has a live relationship with that customer, the invitation is deleted (`deleted_at`) and the answer is 200 `{ merged: true }`.
- Decline: the row is deleted (`deleted_at`); the customer is notified `supplier.declined`.
- A customer notification `supplier.accepted` follows an acceptance.
- `CM-25`: Supplier invitation: acceptance replaces `supplier_person_id` by `supplier_organization_id` and sets ACTIVE, on behalf of an organization the person manages; refused, cancelled, contested or released-number invitations are deleted.
- `C-08`: `status` is PENDING if and only if `supplier_person_id` is set.
- `C-07`: At most one live relationship per (supplier, customer) pair, ignoring deleted and merged rows (partial unique indexes per column combination); `supplier_organization_id` differs from `customer_organization_id`; `merged_into_id` set means the row is deleted.

## Acceptance criteria
```gherkin
Scenario: AC-1 List
  Given two invitations addressed to the caller's number
  Then the list shows both with the customers' public view
Scenario: AC-2 Accept
  When the caller accepts for an organization they manage
  Then the relationship is ACTIVE with that organization as supplier and no supplier person
Scenario: AC-3 Existing relationship
  Given the organization already has a live relationship with that customer
  When the caller accepts
  Then the response is 200 `{ merged: true }` and the invitation is deleted
Scenario: AC-4 Decline
  When the caller declines
  Then the invitation is deleted and the customer is notified
Scenario Outline: AC-5 Refusals
  When the accept call has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                                       | status                      |
    | an organization the caller only sells for     | 403 FORBIDDEN               |
    | an organization they are not a member of      | 404 NOT_FOUND               |
    | a CLOSED organization                         | 409 ORGANIZATION_NOT_ACTIVE |
    | an invitation addressed to someone else       | 404 NOT_FOUND               |
```

## Abuse cases
```gherkin
Scenario: AB-1 Taking another person's invitation (horizontal)
  When person A accepts an invitation whose supplier person is B
  Then the response is 404 and it stays PENDING
Scenario: AB-2 Accepting for a business one does not manage (elevation)
  When a SELLER of the organization accepts
  Then the response is 403
```

## Implementation
- Create: `tests/integration/relationship/supplier-invitations.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.schemas.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `acceptSupplierInvitation(personId: string, invitationId: string, organizationId: string): Promise<{ merged: boolean; relationship?: SupplierRelationshipView }>`
  - `declineSupplierInvitation(personId: string, invitationId: string): Promise<void>`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `ORGANIZATION_NOT_ACTIVE` 409
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.1: only a MANAGER or OWNER of the target organization accepts.
- v5.0.0-8.2.2: the invitation is selected by id and `supplier_person_id` = caller.
- v5.0.0-2.3.3: the swap of supplier columns is one conditional update.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1 | two items |
| accept | integration | AC-2, CM-25, C-08 | ACTIVE with organization |
| existing relationship | integration | AC-3, C-07 | merged true, deleted |
| decline | integration | AC-4 | deleted, customer notified |
| refusals | integration | AC-5 | each Examples row → status |
| other person | security | AB-1, WSTG-ATHZ-04 | 404 |
| seller accepts | security | AB-2, WSTG-ATHZ-03 | 403 |

Command: `npx vitest run tests/integration/relationship/supplier-invitations.test.ts`

## Out of scope
- Orders on the new relationship (ORD module).
