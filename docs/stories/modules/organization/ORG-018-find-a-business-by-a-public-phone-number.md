---
id: ORG-018
title: Find a business by a public phone number
module: organization
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORG-011, PER-006]
read_first: [src/modules/person/person.routes.ts, src/modules/organization/organization.repository.ts]
design_refs: [identite-et-organisation/organization, relations-commerciales/customerrelationship]
constraints: [CM-26]
asvs: [v5.0.0-2.4.1, v5.0.0-15.3.1, v5.0.0-8.2.1]
---

# ORG-018 — Find a business by a public phone number

## Story
As a customer, I want to find a business by one of its public numbers so that I can order from it.

## Context
- Exists: `is_public_contact` (ORG-011); the lookup limit key `lookup:<personId>`, 60 per hour, shared with `GET /people/lookup` (PER-006).
- Adds: `GET /api/v1/organizations/lookup?phone=<number>` for any signed-in person. Response 200 `{ items: [{ id, name, description }] }`: ACTIVE organizations that have an ACTIVE collaborator with `is_public_contact` true whose active number is that number. Otherwise an empty list. `findOrganizationsByPublicNumber(e164)` in `organization.repository.ts`.
- The same 60 per hour limit is consumed from the same key; over it answers 429 `RATE_LIMITED`.
- `CM-26`: Finding an organization by number returns only ACTIVE organizations whose public-contact collaborators hold that active number; a number that is not a public organization number leads to an invitation for every person.

## Acceptance criteria
```gherkin
Scenario: AC-1 Found
  Given a public-contact owner with number +237677123456
  When a signed-in person looks up "6 77 12 34 56"
  Then the response lists that organization with id, name and description only
Scenario Outline: AC-2 Not found
  When the number belongs to <case>
  Then the response is 200 with an empty list
  Examples:
    | case                                                    |
    | a collaborator with is_public_contact false             |
    | an INVITED or REVOKED collaborator                      |
    | a CLOSED or SUSPENDED organization                      |
    | a private person who is not a collaborator              |
    | an unknown number                                       |
Scenario: AC-3 Several businesses
  When one person is a public contact of two ACTIVE organizations
  Then both are listed
Scenario: AC-4 Shared limit
  When 60 person lookups and organization lookups are made in one hour
  Then the 61st answers 429 `RATE_LIMITED`
```

## Abuse cases
```gherkin
Scenario: AB-1 Finding someone under a number that is not theirs (spoofing)
  When a person's number is released
  Then the organizations no longer list it
Scenario: AB-2 Enumeration (anti-automation)
  When one person looks up 61 numbers in an hour
  Then the 61st answers 429
Scenario: AB-3 Private data (information disclosure)
  When a business is found
  Then no collaborator name, id, role or number appears
```

## Implementation
- Create: `tests/integration/organization/lookup.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/modules/person/person.routes.ts`
- Signatures:
  - `findOrganizationsByPublicNumber(e164: string): Promise<Array<{ id: string; name: string; description: string | null }>>`
- Errors: `VALIDATION_ERROR` 400, `RATE_LIMITED` 429, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`, `ioredis`

## Security
- v5.0.0-2.4.1: shared per-person limit.
- v5.0.0-15.3.1: three fields per business.
- v5.0.0-8.2.1: route behind `authMiddleware`.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| found | integration | AC-1, CM-26 | organization with three fields |
| not found | integration | AC-2 | each Examples row → empty list |
| several | integration | AC-3 | both listed |
| shared limit | integration | AC-4 | 61st → 429 |
| released number | security | AB-1, CWE-290 | not listed |
| enumeration | security | AB-2, WSTG-BUSL-07 | 429 |
| private data | security | AB-3, CWE-200 | no collaborator data |

Command: `npx vitest run tests/integration/organization/lookup.test.ts`

## Out of scope
- Inviting a supplier by a non-public number (REL module).
