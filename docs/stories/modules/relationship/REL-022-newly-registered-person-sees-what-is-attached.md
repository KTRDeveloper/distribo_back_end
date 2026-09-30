---
id: REL-022
title: Newly registered person sees what is attached to their number
module: relationship
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [REL-021, ORG-008, REL-006, REL-007, REL-008]
read_first: [src/modules/relationship/relationship.service.ts, src/modules/organization/organization.repository.ts]
design_refs: [identite-et-organisation/person, relations-commerciales/customerrelationship/entree-en-relation-le-numero-comme]
constraints: [CM-19]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# REL-022 — Newly registered person sees what is attached to their number

## Story
As a customer, I want to see everything attached to my number after registering so that I accept or contest each item.

## Context
- Exists: customer relationships (REL-016), team invitations (ORG-008), supplier invitations (REL-021).
- Adds: `GET /api/v1/people/me/attachments`, response 200 `{ relationships: [...], team_invitations: [...], supplier_invitations: [...] }`. `relationships` are the caller's ACTIVE and ENDED relationships as customer (`projectForCustomer`, with the supplier's public name and balance), `team_invitations` and `supplier_invitations` as in their own lists.
- Each list is capped at 100 items.
- `CM-19`: `customer_label` and `supplier_notes` are never sent to the customer; `supplier_label` is never sent to the supplier; each party writes only its own fields.

## Acceptance criteria
```gherkin
Scenario: AC-1 Everything attached
  Given a guest completed by registration who had 2 relationships as customer, 1 team invitation and 1 supplier invitation
  When the person calls the route
  Then all four items appear in their lists
Scenario: AC-2 Nothing attached
  When the person has none
  Then the three lists are empty
Scenario: AC-3 Views
  Then relationships have no customer_label or supplier_notes
Scenario: AC-4 Cap
  When there are 150 relationships
  Then 100 are returned
```

## Abuse cases
```gherkin
Scenario: AB-1 Another number's attachments (horizontal)
  When the request is made with the token of person B
  Then only B's items appear
Scenario: AB-2 No token (unauthenticated)
  Then the response is 401
```

## Implementation
- Create: `tests/integration/relationship/attachments.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `getAttachments(personId: string): Promise<{ relationships: CustomerRelationshipView[]; team_invitations: TeamInvitationView[]; supplier_invitations: SupplierInvitationView[] }>`
- Errors: `UNAUTHORIZED` 401
- Dependencies: `express`

## Security
- v5.0.0-8.2.2: every query filters on the person id from the token.
- v5.0.0-15.3.1: customer projections only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| attached | integration | AC-1 | four items |
| none | integration | AC-2 | empty lists |
| views | integration | AC-3, CM-19 | private fields absent |
| cap | integration | AC-4 | 100 of 150 |
| other person | security | AB-1, WSTG-ATHZ-04 | only own items |
| no token | security | AB-2, WSTG-ATHN-04 | 401 |

Command: `npx vitest run tests/integration/relationship/attachments.test.ts`

## Out of scope
- The accept or contest gestures (REL-017, REL-023, ORG-008).
