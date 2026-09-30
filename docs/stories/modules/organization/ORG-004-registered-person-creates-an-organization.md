---
id: ORG-004
title: Registered person creates an organization
module: organization
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [ORG-003, ACC-007, PER-005, NTF-002]
read_first: [docs/stories/modules/access/contracts.md, src/modules/tasks/tasks.routes.ts]
design_refs: [identite-et-organisation/organization, identite-et-organisation/collaboration]
constraints: ['Organization:required', C-05, CM-03]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-15.3.3]
---

# ORG-004 — Registered person creates an organization

## Story
As a customer, I want to create my business with a name so that I become its owner.

## Context
- Exists: `idempotent()` (ACC-007), tables (ORG-001, ORG-003), `bumpScopeVersion` (PER-005), `authMiddleware`.
- Adds: `POST /api/v1/organizations` with `{ id, name, description?, email? }`; `id` is a UUIDv7 made by the phone. Response 201 `{ id, name, description, email, status, created_at, role: 'OWNER' }`.
- One transaction creates the organization and the creator's collaboration: role OWNER, status ACTIVE, `is_public_contact` true (the creator has an active number), `accepted_at` = now; then bumps the creator's `scope_version`.
- `name` 1 to 100 characters; `description` up to 2000; `email` a valid address (Q-027). A repeat of the same `id` returns the first response.
- `Organization:required`: NOT NULL: `name`, `status`, `created_at`
- `C-05`: `Collaboration` is unique per (`person_id`, `organization_id`); an ACTIVE collaboration needs a registered person; every organization has exactly one ACTIVE OWNER at the end of each transaction; `is_public_contact` needs ACTIVE status and a person with an active number.
- `CM-03`: `Person.scope_version` is incremented by the server on every rights change.

## Acceptance criteria
```gherkin
Scenario: AC-1 Create
  When a signed-in person posts a name
  Then the response is 201, the organization is ACTIVE, and the caller has an ACTIVE OWNER collaboration with is_public_contact true
Scenario: AC-2 Scope version
  Then the caller's `scope_version` increased by 1
Scenario Outline: AC-3 Limits
  When the body has <field> = <value>
  Then the response is <status>
  Examples:
    | field       | value      | status |
    | name        | empty      | 400    |
    | name        | 100 chars  | 201    |
    | name        | 101 chars  | 400    |
    | description | 2001 chars | 400    |
    | email       | not-mail   | 400    |
    | id          | a UUIDv4   | 400    |
Scenario: AC-4 Repeat
  When the same body is posted twice
  Then one organization exists and both responses are equal
Scenario: AC-5 Atomic
  When the collaboration insert fails
  Then no organization exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Owner or status chosen by the client (mass assignment)
  When the body contains status, role, owner or person_id
  Then the response is 400 and nothing is stored
Scenario: AB-2 No token (unauthenticated)
  When the request has no valid token
  Then the response is 401
```

## Implementation
- Create: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `tests/integration/organization/create.test.ts`
- Modify: `src/app.ts`
- Pattern: `src/modules/tasks/tasks.routes.ts`
- Signatures:
  - `createOrganization(personId: string, input: CreateOrganizationInput): Promise<OrganizationView>`
- Types:
  - `CreateOrganizationInput = { id: string; name: string; description?: string; email?: string }`
  - `OrganizationView = { id: string; name: string; description: string | null; email: string | null; status: string; created_at: string; role: 'OWNER' }`
- Errors: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-15.3.3: strict schema with four fields.
- v5.0.0-2.3.3: organization, collaboration and scope bump are one transaction.
- v5.0.0-8.2.1: the owner is the person from the token, never from the body.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| create | integration | AC-1, Organization:required, C-05 | 201, org and OWNER row |
| scope version | integration | AC-2, CM-03 | +1 |
| limits | integration | AC-3 | each Examples row → status |
| repeat | integration | AC-4 | one row, equal responses |
| atomic | integration | AC-5 | forced failure → no org |
| mass assignment | security | AB-1, CWE-915 | forbidden fields → 400 |
| no token | security | AB-2, WSTG-ATHN-04 | 401 |

Command: `npx vitest run tests/integration/organization/create.test.ts`

## Out of scope
- The default counter 'Client de passage' (REL module).
- Renaming or editing an organization (Q-032).
- OpenAPI registration of this route (ORG-005).
