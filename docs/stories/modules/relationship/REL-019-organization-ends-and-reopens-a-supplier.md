---
id: REL-019
title: Organization ends and reopens a supplier
module: relationship
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [REL-018, ACC-007, REL-006, REL-007, REL-008]
read_first: [src/modules/relationship/relationship.service.ts, src/modules/relationship/relationship.routes.ts]
design_refs: [relations-commerciales/customerrelationship/fin-de-relation]
constraints: [C-09]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.1]
---

# REL-019 — Organization ends and reopens a supplier

## Story
As a manager, I want my business to leave a supplier and come back so that its list stays current.

## Context
- Exists: `GET .../suppliers`, label edit (REL-018); end and reopen rules for MANAGER online (ACC-002); `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/suppliers/{relationshipId}/end` and `.../reopen` with `{ id }`; response 200 `projectForCustomer`. Same rules as REL-017: `ended_by_party` CUSTOMER; reopen only if the customer side ended it.
- `C-09`: `ended_by_party` is set if and only if `status` is ENDED; only that party may reopen the relationship.

## Acceptance criteria
```gherkin
Scenario: AC-1 End and reopen
  When a MANAGER ends and then reopens a supplier relationship
  Then the states are ENDED with CUSTOMER, then ACTIVE
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                                   | status                   |
    | reopening a block by the supplier         | 409 ENDED_BY_OTHER_PARTY |
    | a SELLER or DRIVER caller                 | 403 FORBIDDEN            |
    | a relationship of another business        | 404 NOT_FOUND            |
Scenario: AC-3 Repeat
  When the same id is sent twice
  Then the answers are equal
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller ends a supplier (vertical)
  When a SELLER posts end
  Then the response is 403 and nothing changes
```

## Implementation
- Create: `tests/integration/relationship/org-end-reopen.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `orgEndSupplier(actor: Actor, relationshipId: string): Promise<CustomerRelationshipView>`
  - `orgReopenSupplier(actor: Actor, relationshipId: string): Promise<CustomerRelationshipView>`
- Errors: `ENDED_BY_OTHER_PARTY` 409, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager and online only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| end and reopen | integration | AC-1, C-09 | states as described |
| refusals | integration | AC-2 | each Examples row → status |
| repeat | integration | AC-3 | equal answers |
| seller | security | AB-1, WSTG-ATHZ-03 | 403 |

Command: `npx vitest run tests/integration/relationship/org-end-reopen.test.ts`

## Out of scope
- Refusing orders on ended relationships (ORD module).
