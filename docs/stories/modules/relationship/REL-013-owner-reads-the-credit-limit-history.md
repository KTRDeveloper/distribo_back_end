---
id: REL-013
title: Owner reads the credit limit history
module: relationship
kind: feature
rev: 1
amends: []
size: XS
risk: medium
depends_on: [REL-012, FND-009]
read_first: [src/modules/relationship/relationship.routes.ts, src/modules/relationship/relationship.repository.ts]
design_refs: [relations-commerciales/creditlimitchange]
constraints: []
asvs: [v5.0.0-8.2.2, v5.0.0-16.3.3]
---

# REL-013 — Owner reads the credit limit history

## Story
As an owner, I want to read the history of a customer's credit limit so that I know who decided what and when.

## Context
- Exists: journal rows (REL-004, REL-012).
- Adds: `GET /api/v1/organizations/{organizationId}/customers/{relationshipId}/credit-limit-changes` (OWNER and MANAGER; paginated, newest first; `previous_limit, new_limit, set_by_id, set_at`). SELLER and DRIVER get 403.

## Acceptance criteria
```gherkin
Scenario: AC-1 History
  Given three changes on one relationship
  When the owner reads the history
  Then three items are returned newest first
Scenario Outline: AC-2 Roles
  When the caller is <role>
  Then the response is <status>
  Examples:
    | role    | status |
    | OWNER   | 200    |
    | MANAGER | 200    |
    | SELLER  | 403    |
    | DRIVER  | 403    |
Scenario: AC-3 Pagination
  Given 5 changes
  Then limit 2 with cursors returns pages of 2, 2 and 1
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's history (horizontal)
  When a member of A requests the history of a relationship of B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/relationship/credit-limit-history.test.ts`
- Modify: `src/modules/relationship/relationship.routes.ts`, `src/modules/relationship/relationship.service.ts`, `src/modules/relationship/relationship.repository.ts`, `src/modules/relationship/relationship.openapi.ts`
- Pattern: `src/modules/relationship/relationship.routes.ts`
- Signatures:
  - `listCreditLimitChanges(actor: Actor, relationshipId: string, query: { limit: number; cursor?: string }): Promise<{ items: CreditLimitChangeView[]; next_cursor: string | null }>`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: the relationship is loaded through the visibility predicate first.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| history | integration | AC-1 | three items newest first |
| roles | integration | AC-2 | each Examples row → status |
| paging | integration | AC-3 | 2, 2, 1 |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/relationship/credit-limit-history.test.ts`

## Out of scope
- Notifications (kept 24 months) are not the history.
