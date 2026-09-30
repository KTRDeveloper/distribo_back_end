---
id: ORG-005
title: Actor loading and reading my organizations
module: organization
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ORG-004, ACC-006]
read_first: [src/middleware/require-ability.ts, src/modules/organization/organization.routes.ts]
design_refs: [identite-et-organisation/collaboration, identite-et-organisation/organization]
constraints: ['Collaboration.role:enum']
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-8.4.1, v5.0.0-15.3.1]
---

# ORG-005 — Actor loading and reading my organizations

## Story
As an owner, I want to see my organizations and their details so that I know where I work and with which role.

## Context
- Exists: `requireAbility` and the `Actor` type (ACC-006); `POST /organizations` (ORG-004).
- Adds: `src/middleware/load-actor.ts` (`loadActor`, `getActiveCollaboration`, `assertOrganizationActive`), and `organization.openapi.ts` documenting `POST /organizations` (ORG-004) and the two routes below; `organization.routes.ts` imports it for its side effect (`import './organization.openapi.js'`) so that `src/app.ts` needs no change; `GET /api/v1/organizations` (my ACTIVE collaborations: `id, name, status, role`, paginated) and `GET /api/v1/organizations/{organizationId}` (`id, name, description, email, status, created_at, role`).
- `loadActor` sets `req.actor` from the caller's ACTIVE collaboration in `req.params.organizationId`; without one it answers 404 `NOT_FOUND` (never 403, so an id is never confirmed).
- `assertOrganizationActive` throws 409 `ORGANIZATION_NOT_ACTIVE` when the status is SUSPENDED or CLOSED.
- `Collaboration.role:enum`: one of OWNER, MANAGER, SELLER, DRIVER

## Acceptance criteria
```gherkin
Scenario: AC-1 My organizations
  Given a person with two ACTIVE collaborations, one INVITED and one REVOKED
  When they GET /api/v1/organizations
  Then two items are returned, each with its role, newest first
Scenario: AC-2 Details
  When a member GETs an organization of theirs
  Then the response is 200 with the seven fields and their role
Scenario Outline: AC-3 Not a member
  When the caller is <case>
  Then GET /api/v1/organizations/{id} answers 404 `NOT_FOUND`
  Examples:
    | case                                  |
    | not a collaborator                    |
    | INVITED only                          |
    | REVOKED                               |
    | asking for an unknown id              |
Scenario: AC-4 Actor
  Given a SELLER of organization A
  When any route behind loadActor is called for A
  Then `req.actor` is `{ personId, organizationId: A, role: 'SELLER' }`
Scenario: AC-5 Inactive organization
  Then assertOrganizationActive throws ORGANIZATION_NOT_ACTIVE for SUSPENDED and CLOSED and passes for ACTIVE
```

## Abuse cases
```gherkin
Scenario: AB-1 Reading another business (horizontal)
  When a member of A requests business B by id
  Then the response is 404 and nothing of B is returned
Scenario: AB-2 Organization id in the body or header (tampering)
  When a request carries another organization id in the body
  Then the actor is still loaded from the path only
```

## Implementation
- Create: `src/middleware/load-actor.ts`, `src/modules/organization/organization.openapi.ts`, `tests/integration/organization/actor-and-read.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`
- Pattern: `src/middleware/auth.ts`
- Signatures:
  - `loadActor: RequestHandler`
  - `getActiveCollaboration(personId: string, organizationId: string): Promise<Collaboration | null>`
  - `assertOrganizationActive(organizationId: string, tx?: Prisma.TransactionClient): Promise<void>`
- Errors: `NOT_FOUND` 404, `ORGANIZATION_NOT_ACTIVE` 409, `UNAUTHORIZED` 401
- Dependencies: `express`, `@prisma/client`

## Security
- v5.0.0-8.2.2: membership is looked up with the person id from the token and the id from the path.
- v5.0.0-8.4.1: a non-member gets 404 for any organization.
- v5.0.0-15.3.1: explicit field lists.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| my organizations | integration | AC-1 | two ACTIVE items with roles |
| details | integration | AC-2, Collaboration.role:enum | seven fields and role |
| not a member | integration | AC-3 | each Examples row → 404 |
| actor | integration | AC-4 | req.actor as stated |
| inactive | integration | AC-5 | 409 for SUSPENDED and CLOSED |
| other business | security | AB-1, WSTG-ATHZ-04 | 404, no data |
| body id | security | AB-2, CWE-639 | actor from path only |

Command: `npx vitest run tests/integration/organization/actor-and-read.test.ts`

## Out of scope
- Team routes (ORG-008 onward).
