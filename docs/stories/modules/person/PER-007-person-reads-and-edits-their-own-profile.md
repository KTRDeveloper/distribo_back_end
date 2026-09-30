---
id: PER-007
title: Person reads and edits their own profile
module: person
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [PER-005]
read_first: [docs/stories/modules/person/contracts.md, src/modules/user/user.routes.ts]
design_refs: [identite-et-organisation/person]
constraints: ['Person:required', C-03]
asvs: [v5.0.0-8.2.3, v5.0.0-15.3.1, v5.0.0-15.3.3]
---

# PER-007 — Person reads and edits their own profile

## Story
As a customer, I want to see and change my own name, language and email so that my profile stays right.

## Context
- Exists: `GET` and `PATCH /api/v1/users/me` in the `user` module (before this story they return the account's id, email, name, email verified date and creation date).
- Changes: both routes now read and write `Person` through `src/modules/user/user.*`; response fields are `id, full_name, phone_number, phone_verified, email, email_verified, preferred_language, registered, scope_version, created_at`.
- PATCH accepts only `full_name` (1 to 100 characters, Q-027), `preferred_language` (FR or EN) and `email`; a changed email is stored at once and `email_verified_at` is emptied; `email: null` clears both.
- The verification code for an email is sent by the AUTH module.
- `Person` fields: `full_name` string, nullable; `email` string, nullable; `email_verified_at` datetime, nullable; `preferred_language` enum [FR / EN], nullable; `scope_version` int
- `Person:required`: NOT NULL: `created_at`, `status`, `scope_version`
- `C-03`: A registered person (`registered_at` set) who is not ANONYMIZED has `full_name` and `password_hash`, and `phone_verified_at` when `phone_number` is set; empty `phone_number` means empty `phone_verified_at`; empty `email` means empty `email_verified_at`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Read own profile
  Given a signed-in registered person
  When they GET /api/v1/users/me
  Then the response is 200 with the ten fields above and no `password_hash`
Scenario: AC-2 Update name and language
  When they PATCH full_name "Béatrice N." and preferred_language "EN"
  Then the response is 200 with the new values and the row is updated
Scenario: AC-3 Change email resets verification
  Given a person with a verified email
  When they PATCH email to another address
  Then email is the new address and email_verified is false
Scenario Outline: AC-4 Limits
  When they PATCH <field> with <value>
  Then the response is <status>
  Examples:
    | field              | value       | status |
    | full_name          | empty       | 400    |
    | full_name          | 100 chars   | 200    |
    | full_name          | 101 chars   | 400    |
    | preferred_language | ES          | 400    |
    | email              | not-an-email| 400    |
```

## Abuse cases
```gherkin
Scenario: AB-1 Server-owned fields (mass assignment)
  When a PATCH contains phone_number, status, scope_version, registered_at or password_hash
  Then the response is 400 and nothing is stored
Scenario: AB-2 Another person's profile (horizontal)
  When a PATCH contains an `id` of another person
  Then the response is 400 and the other profile is unchanged
Scenario: AB-3 No token (unauthenticated)
  When the request has no valid token
  Then the response is 401
```

## Implementation
- Create: `tests/integration/person/profile.test.ts`
- Modify: `src/modules/user/user.repository.ts`, `src/modules/user/user.service.ts`, `src/modules/user/user.schemas.ts`, `src/modules/user/user.types.ts`, `src/modules/user/user.openapi.ts`
- Pattern: `src/modules/user/user.service.ts`
- Signatures:
  - `getProfile(personId: string): Promise<Profile>`
  - `updateProfile(personId: string, input: UpdateProfileInput): Promise<Profile>`
- Types:
  - `UpdateProfileInput = { full_name?: string; preferred_language?: 'FR' | 'EN'; email?: string | null }`
- Errors: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `NOT_FOUND` 404
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-15.3.3: strict schema with three optional fields.
- v5.0.0-8.2.3: the row is selected and updated by the person id from the token only.
- v5.0.0-15.3.1: explicit response field list; `password_hash` is never selected.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| read | integration | AC-1 | GET → ten fields, no password_hash |
| update | integration | AC-2 | PATCH name and language → stored |
| email reset | integration | AC-3, C-03 | verified email replaced → email_verified false, date empty |
| limits | integration | AC-4, Person:required | each Examples row → status |
| mass assignment | security | AB-1, CWE-915 | forbidden fields → 400, row unchanged |
| own row only | security | AB-2, WSTG-ATHZ-04 | id in body → 400; other row unchanged |
| no token | security | AB-3, WSTG-ATHN-04 | no header → 401 |

Command: `npx vitest run tests/integration/person/profile.test.ts tests/integration/user.test.ts`

## Out of scope
- Sending the email verification code (AUTH module).
- Changing the phone number (AUTH module).
