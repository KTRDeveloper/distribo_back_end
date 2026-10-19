---
id: PER-011
title: The public view of a person carries the photo address
module: person
kind: change
rev: 1
amends: [PER-005, PER-006]
size: S
risk: medium
depends_on: [PER-010, FND-013]
read_first: [src/modules/person/person.repository.ts, docs/stories/modules/foundation/contracts.md]
design_refs: [identite-et-organisation/person, images/stockage]
constraints: [CM-20]
asvs: [v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# PER-011 — The public view of a person carries the photo address

## Story
As a seller, I want to see a customer's name and photo when I type their number so that I catch typing mistakes.

## Context
- Exists: `toPublicPerson` returns `{ public_name, phone_number, registered }` (PER-005); `GET /api/v1/people/lookup` returns that view or the unregistered answer (PER-006); `imageUrl(key)` turns a key into an address (FND-013); `Person.avatar_key` (PER-010).
- Changes: the view gains `avatar_url: string | null`, the address built by `imageUrl` from the stored key; null when there is no key. The key itself is never in the view.
- The unregistered answer (unknown number, guest, released number) becomes `{ phone_number, registered: false, public_name: null, avatar_url: null }`: the three cases stay identical.
- Every caller of `toPublicPerson` (team lists, relation views, reports) now returns the new key; their response documents change in their own modules' stories.
- `CM-20`: An organization receives from a person only the public name, the profile photo address, the number and whether they are registered.

## Acceptance criteria
```gherkin
Scenario: AC-1 The view carries the address
  Given a registered person with a photo key
  When `toPublicPerson` is applied
  Then the result has exactly the keys `public_name`, `phone_number`, `registered`, `avatar_url`
  And `avatar_url` is the base address, a slash and the key
Scenario: AC-2 No photo, no address
  When `toPublicPerson` is applied to a registered person without a key, to a guest and to a person whose number is released
  Then `avatar_url` is null in each result
Scenario: AC-3 Lookup shows name and photo
  Given a registered person named "Béatrice Ngono" with a photo
  When a signed-in person looks up the number
  Then the response is 200 with the name and the photo address
Scenario: AC-4 Unknown numbers stay identical
  When a signed-in person looks up an unknown number, a guest's number and a released number
  Then each response is 200 with registered false, public_name null and avatar_url null
```

## Abuse cases
```gherkin
Scenario: AB-1 Private fields leak through the view (information disclosure)
  When `toPublicPerson` is applied to a person with every field set
  Then the serialized result contains none of email, password hash, dates, language or the raw key
Scenario: AB-2 A guest reveals a photo (information disclosure)
  When a lookup hits a guest or an unknown number
  Then the body is the same for both and holds no address
```

## Implementation
- Create: `tests/integration/person/public-person-avatar.test.ts`
- Modify: `src/modules/person/person.repository.ts`, `src/modules/person/person.routes.ts`, `src/modules/person/person.schemas.ts`, `src/modules/person/person.openapi.ts`
- Pattern: `tests/integration/person/person-repository.test.ts`
- Signatures:
  - `toPublicPerson(person: Person): PublicPerson`
- Types:
  - `PublicPerson = { public_name: string | null; phone_number: string | null; registered: boolean; avatar_url: string | null }`
- Dependencies: `@prisma/client`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.3: `toPublicPerson` builds the object from an explicit list of four fields.
- v5.0.0-15.3.1: the lookup response schema lists the four fields and rejects any other.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| view with photo | integration | AC-1, CM-20 | person with a key → exactly four keys; address = base + "/" + key |
| view without photo | integration | AC-2 | no key, guest, released number → avatar_url null |
| lookup with photo | integration | AC-3 | registered person with a key → 200 with the address (in person-lookup.test.ts) |
| unknown numbers | integration | AC-4 | unknown, guest, released → identical four-key bodies (in person-lookup.test.ts) |
| no private leak | security | AB-1, CWE-200 | JSON holds none of the private values and no avatar_key |
| guest and unknown | security | AB-2, WSTG-ATHZ-02 | both bodies deep-equal apart from the echoed number (in person-lookup.test.ts) |

Command: `npx vitest run tests/integration/person tests/integration/relationship tests/integration/organization/team-list.test.ts tests/integration/admin/list-reports.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/person/person-repository.test.ts | closed list has three keys | four keys, avatar_url added |
| tests/integration/person/person-lookup.test.ts | answers and key list have three fields | add avatar_url |
| tests/integration/organization/team-list.test.ts | person key list has three entries | add avatar_url |
| tests/integration/admin/list-reports.test.ts | reporter key list has three entries | add avatar_url |
| tests/integration/relationship/visibility.test.ts | fixture `person()` lacks `avatarKey`; views list three fields | add `avatarKey: null` and avatar_url |
| tests/integration/relationship/supplier-invitations.test.ts | customer person equals three fields | add avatar_url |

## Out of scope
- Response documents and types of the other modules that return the view: ORG-036, the relationship, administration and synchronization change stories.
- Uploading a photo (IMG-003) and the profile view (PER-012).
