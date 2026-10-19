---
id: PER-012
title: Own profile shows the photo address
module: person
kind: change
rev: 1
amends: [PER-007]
size: XS
risk: low
depends_on: [PER-010, FND-013]
read_first: [src/modules/user/user.repository.ts, src/modules/user/user.types.ts]
design_refs: [identite-et-organisation/person]
constraints: [C-49]
asvs: [v5.0.0-15.3.1, v5.0.0-15.3.3]
---

# PER-012 — Own profile shows the photo address

## Story
As a customer, I want my profile to show my photo so that I see what others see when they type my number.

## Context
- Exists: `GET` and `PATCH /api/v1/users/me` return ten fields (PER-007); PATCH accepts only `full_name`, `preferred_language` and `email`, with a strict schema.
- Changes: both responses gain `avatar_url: string | null`, built by `imageUrl` (FND-013) from the stored key; null without a photo. The key is never returned.
- PATCH stays strict: `avatar_key` and `avatar_url` are unknown fields and are refused, because only the server writes the photo (C-49; the route is IMG-003).
- Wording only (no code): the email is added from the profile and never at registration; `preferred_language` is the interface language kept on the account, the same on every phone.
- `Person` fields: `avatar_key` string, nullable
- `C-49`: A guest has no `avatar_key`; a key is cited by one card only, across all tables; `Person.avatar_key` is written by the server only. The rules for product and variant keys belong to the images and catalog modules.

## Acceptance criteria
```gherkin
Scenario: AC-1 Read own profile with a photo
  Given a registered person with a photo key
  When they GET /api/v1/users/me
  Then the response is 200 with eleven fields, among them `avatar_url` holding the address
  And no field named `avatar_key` and no `password_hash`
Scenario: AC-2 No photo
  When a registered person without a key reads the profile
  Then `avatar_url` is null
Scenario: AC-3 PATCH response
  Given a registered person with a photo
  When they PATCH full_name
  Then the response carries the same `avatar_url` and the new name
Scenario Outline: AC-4 The photo cannot be written here
  When they PATCH <field> with a text
  Then the response is 400 `VALIDATION_ERROR` and nothing is stored
  Examples:
    | field      |
    | avatar_key |
    | avatar_url |
```

## Abuse cases
```gherkin
Scenario: AB-1 A client writes a storage key (tampering)
  When a PATCH carries `avatar_key` with a well-formed key of another person's photo
  Then the response is 400, the stored key is unchanged and no file is touched
Scenario: AB-2 The key leaks in a body (information disclosure)
  When any profile response is read
  Then its field names do not include `avatar_key`
```

## Implementation
- Modify: `src/modules/user/user.repository.ts`, `src/modules/user/user.types.ts`, `src/modules/user/user.openapi.ts`
- Pattern: `src/modules/user/user.repository.ts`
- Signatures:
  - `getProfile(personId: string): Promise<Profile>`
- Types:
  - `Profile gains avatar_url: string | null`
- Errors: `VALIDATION_ERROR` 400
- Dependencies: `@prisma/client`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-15.3.1: the profile select lists `avatarKey` only to build the address; the key is not copied into the response.
- v5.0.0-15.3.3: the PATCH schema keeps its three writable fields.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| read with photo | integration | AC-1 | person with a key → eleven fields, address present, no avatar_key |
| read without photo | integration | AC-2 | no key → avatar_url null |
| patch response | integration | AC-3 | PATCH full_name → same address, new name |
| photo not writable | integration | AC-4, C-49 | each Examples row → 400 |
| client key refused | security | AB-1, CWE-915 | avatar_key of another person → 400, stored key unchanged |
| no key in bodies | security | AB-2, CWE-200 | GET and PATCH bodies → no field named avatar_key |

Command: `npx vitest run tests/integration/person/profile.test.ts tests/integration/user.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/person/profile.test.ts | AC-1 lists ten response fields | eleven fields, `avatar_url` added |

## Out of scope
- Uploading or removing the photo (IMG-003).
- The screen text « Visible de quiconque saisit votre numéro »: the phone's.
