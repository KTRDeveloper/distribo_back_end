---
id: ORG-019
title: Team list
module: organization
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORG-008]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.routes.ts]
design_refs: [identite-et-organisation/collaboration, finances/handover]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# ORG-019 — Team list

## Story
As an owner, I want to see my team with roles and statuses so that I know who can do what and who holds money.

## Context
- Exists: collaborators (ORG-007 to ORG-010); `loadActor`.
- Adds: `GET /api/v1/organizations/{organizationId}/collaborators` (paginated; `id, person: { public_name, phone_number, registered }, role, status, is_public_contact, invited_at, accepted_at`, and `amount_held`). OWNER and MANAGER may read the list; SELLER and DRIVER get 403.
- `amount_held` is present for the OWNER caller, and for a caller's own row; absent for others. REVOKED rows are listed so that money held by former members stays visible.

## Acceptance criteria
```gherkin
Scenario: AC-1 Owner sees all
  When the owner lists a team of owner, manager, seller and a revoked driver holding 5000
  Then four items are returned including the revoked driver with amount_held 5000
Scenario: AC-2 Manager sees no money of others
  When the manager lists
  Then only the manager's own item has amount_held
Scenario Outline: AC-3 Roles
  When the caller is <role>
  Then the response is <status>
  Examples:
    | role    | status |
    | OWNER   | 200    |
    | MANAGER | 200    |
    | SELLER  | 403    |
    | DRIVER  | 403    |
Scenario: AC-4 Pagination
  Given 5 collaborators
  When the owner lists with limit 2 and the returned cursor
  Then the pages hold 2, 2 and 1 items
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's team (horizontal)
  When a member of A lists the team of B
  Then the response is 404
Scenario: AB-2 Private fields (information disclosure)
  When the list is read
  Then no email, language or password data of any person appears
```

## Implementation
- Create: `tests/integration/organization/team-list.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `listCollaborators(actor: Actor, query: { limit: number; cursor?: string }): Promise<{ items: CollaborationView[]; next_cursor: string | null }>`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.3: `amount_held` is field-level restricted to the owner and the row's own person.
- v5.0.0-15.3.1: person data goes through `toPublicPerson`.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| owner list | integration | AC-1 | four items, revoked driver with 5000 |
| manager list | integration | AC-2 | only own amount_held |
| roles | integration | AC-3 | each Examples row → status |
| paging | integration | AC-4 | 2, 2, 1 |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |
| private fields | security | AB-2, CWE-200 | no email or language |

Command: `npx vitest run tests/integration/organization/team-list.test.ts`

## Out of scope
- Showing held money to the collaborator only (FIN module screens).
