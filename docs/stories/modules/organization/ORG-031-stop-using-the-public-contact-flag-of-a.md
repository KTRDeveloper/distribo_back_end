---
id: ORG-031
title: Stop using the public-contact flag of a collaborator
module: organization
kind: removal
rev: 1
amends: [ORG-004, ORG-011, ORG-019]
size: S
risk: medium
depends_on: [ORG-028, ORG-029, ORG-040]
read_first: [src/modules/organization/organization.routes.ts, src/modules/organization/organization.service.ts]
design_refs: [identite-et-organisation/collaboration, identite-et-organisation/organizationcontact]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.1]
---

# ORG-031 — Stop using the public-contact flag of a collaborator

## Story
As an owner, I want the business contacts to be the only way my business is published so that a collaborator's own number is never shown for it.

## Context
- Exists: `PATCH /api/v1/organizations/{organizationId}/collaborators/me` with `setPublicContact`, `updatePublicContact` and `setPublicContactSchema` (ORG-011); the owner row is created with `is_public_contact` true (ORG-004); the team list item carries `is_public_contact` (ORG-019). Nothing reads the flag any more (ORG-029).
- Remove the `me` route, its service, repository function, schema and `organization.openapi.ts` path. Then `PATCH …/collaborators/me` falls to the role route: the OWNER gets 400 VALIDATION_ERROR (`me` is not a collaboration id), anyone else 403 FORBIDDEN; no row changes.
- The owner row is created with the flag false (its default). Remove `is_public_contact` from the team list item, its type and its openapi schema.
- Keep every `isPublicContact: false` written by revoke, re-invite and close: until the column is dropped (ORG-043) the database refuses a flag that is true on a row that is not ACTIVE.
- The column and its trigger stay in the database; ORG-043 removes them.

## Acceptance criteria
```gherkin
Scenario: AC-1 The route is gone
  When an OWNER sends PATCH `…/collaborators/me` with `{ "is_public_contact": true }`
  Then the answer is 400 VALIDATION_ERROR
  And a MANAGER gets 403 FORBIDDEN
  And no collaboration row changes
Scenario: AC-2 A new business has no flagged owner
  When a person creates a business
  Then the OWNER collaboration has `is_public_contact` false
Scenario: AC-3 The team list has no flag
  When the OWNER reads the team
  Then no item has an `is_public_contact` key
Scenario: AC-4 Revoking still clears a flag left from before
  Given an ACTIVE collaborator whose stored flag is true
  When the OWNER revokes them
  Then the row is REVOKED with the flag false and no database error occurs
```

## Abuse cases
```gherkin
Scenario: AB-1 A collaborator publishes their own number for the business (spoofing)
  When a MANAGER, a SELLER or a DRIVER sends `{ "is_public_contact": true }` to `…/collaborators/me`
  Then the answer is 403 FORBIDDEN and the stored flag stays false
```

## Implementation
- Create: `tests/integration/organization/public-contact-removed.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/middleware/require-ability.ts`
- Types:
  - `CollaboratorItem loses is_public_contact`
- Errors: `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: none added

## Security
- v5.0.0-8.2.1: the only writer of the published numbers is the OWNER, through the contact routes.
- v5.0.0-15.3.1: the team item is an explicit list without the flag.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| route gone | integration | AC-1 | OWNER → 400, MANAGER → 403, rows unchanged |
| new owner | integration | AC-2 | created owner row → flag false |
| team list | integration | AC-3 | no item has the key |
| revoke clears | integration | AC-4 | flag true seeded, revoke → REVOKED, flag false |
| self publication | security | AB-1, CWE-285 | MANAGER, SELLER, DRIVER → 403, flag false |

Command: `npx vitest run tests/integration/organization tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/organization/public-contact.test.ts | every case calls the removed route | file deleted; public-contact-removed.test.ts covers the refused route |
| tests/integration/organization/team-list.test.ts | the OWNER item expects `is_public_contact: true` | the item has no `is_public_contact` key |
| tests/integration/organization/create.test.ts | expects the OWNER collaboration created with `isPublicContact: true` | `isPublicContact: false` |
| tests/integration/api-docs/catalog.test.ts | lists the path `…/collaborators/me` | the path is removed from the list and checked absent |

## Out of scope
- Dropping the column, the trigger and the database rule: ORG-043.
- Sending the flag to phones: ORG-039.
