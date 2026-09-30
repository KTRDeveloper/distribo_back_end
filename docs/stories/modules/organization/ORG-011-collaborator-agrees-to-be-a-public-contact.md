---
id: ORG-011
title: Collaborator agrees to be a public contact
module: organization
kind: feature
rev: 1
amends: []
size: XS
risk: medium
depends_on: [ORG-008]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.routes.ts]
design_refs: [identite-et-organisation/collaboration]
constraints: [C-05]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# ORG-011 — Collaborator agrees to be a public contact

## Story
As a seller, I want to choose whether my number is published as a contact of my business so that I control who can find me.

## Context
- Exists: `is_public_contact` with its database rules (ORG-003); `loadActor`.
- Adds: `PATCH /api/v1/organizations/{organizationId}/collaborators/me` with `{ is_public_contact }`, for any ACTIVE member; response 200 with `{ is_public_contact }`. The OWNER starts with true (ORG-004), others with false.
- Without an active number the answer is 409 `NO_ACTIVE_NUMBER` when turning it on.
- `C-05`: `Collaboration` is unique per (`person_id`, `organization_id`); an ACTIVE collaboration needs a registered person; every organization has exactly one ACTIVE OWNER at the end of each transaction; `is_public_contact` needs ACTIVE status and a person with an active number.

## Acceptance criteria
```gherkin
Scenario: AC-1 Turn on and off
  When an ACTIVE seller patches true, then false
  Then the answers are 200 and the stored flag follows
Scenario: AC-2 No active number
  Given the caller's number was released
  When they patch true
  Then the response is 409 `NO_ACTIVE_NUMBER`
Scenario: AC-3 Only the flag
  When the body has any other key
  Then the response is 400 `VALIDATION_ERROR`
```

## Abuse cases
```gherkin
Scenario: AB-1 Publishing someone else's number (spoofing)
  When the owner or a manager tries to patch another collaborator's flag
  Then no route allows it and the other flag is unchanged
```

## Implementation
- Create: `tests/integration/organization/public-contact.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `setPublicContact(actor: Actor, value: boolean): Promise<{ is_public_contact: boolean }>`
- Errors: `NO_ACTIVE_NUMBER` 409, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: the row is the caller's own, selected by person id and organization id.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| toggle | integration | AC-1, C-05 | true then false stored |
| no number | integration | AC-2 | 409 |
| strict body | integration | AC-3 | extra key → 400 |
| others' flags | security | AB-1, WSTG-ATHZ-04 | no route changes another's flag |

Command: `npx vitest run tests/integration/organization/public-contact.test.ts`

## Out of scope
- Finding an organization by number (ORG-018).
