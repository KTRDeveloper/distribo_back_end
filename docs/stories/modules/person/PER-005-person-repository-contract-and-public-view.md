---
id: PER-005
title: Person repository contract and public view
module: person
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [PER-002, FND-004, FND-005]
read_first: [docs/stories/modules/foundation/contracts.md, src/modules/user/user.repository.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-03, CM-20]
asvs: [v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# PER-005 — Person repository contract and public view

## Story
Technical story: provide the functions other modules use to find or create a person by number and to show a person to an organization, so that the closed-list rule is written once.

## Context
- Exists: `people` (PER-002); `normalizeE164` (FND-004); `newId` (FND-005).
- Adds: `src/modules/person/person.repository.ts` with `findByActivePhone`, `findOrCreateByPhone`, `toPublicPerson`, `bumpScopeVersion`.
- A guest has empty `registered_at`, `full_name`, `password_hash`; only the server creates one.
- Public view: `{ public_name, phone_number, registered }`; `public_name` is `full_name` or null; a person whose number is released has `phone_number` null.
- `CM-03`: `scope_version` is incremented by the server on every rights change.
- `CM-20`: An organization receives from a person only the public name, the number and whether they are registered.

## Acceptance criteria
```gherkin
Scenario: AC-1 Find by active number
  Given a person with active number +237677123456 and a person whose released number is +237699000111
  When findByActivePhone is called with each number
  Then the first returns its person and the second returns null
Scenario: AC-2 Find or create
  When findOrCreateByPhone is called twice with the same number
  Then one guest is created, both calls return the same id, `registered_at` is empty and `scope_version` is 0
Scenario: AC-3 Concurrent creation
  When two calls create the same number at the same time
  Then exactly one row exists and both calls return it
Scenario: AC-4 Public view is a closed list
  When toPublicPerson receives a registered person with email, language and password hash
  Then the result has exactly the keys `public_name`, `phone_number`, `registered`
Scenario: AC-5 Scope version
  When bumpScopeVersion is called twice for one person
  Then it returns 1 then 2 and the stored value is 2
```

## Abuse cases
```gherkin
Scenario: AB-1 Private fields leak through the public view (information disclosure)
  When toPublicPerson is applied to a person with every field set
  Then the serialized result contains none of email, password hash, dates or language
```

## Implementation
- Create: `src/modules/person/person.repository.ts`, `tests/integration/person/person-repository.test.ts`
- Pattern: `src/modules/tasks/tasks.repository.ts`
- Signatures:
  - `findByActivePhone(e164: string): Promise<Person | null>`
  - `findOrCreateByPhone(e164: string, tx?: Prisma.TransactionClient): Promise<Person>`
  - `toPublicPerson(person: Person): PublicPerson`
  - `bumpScopeVersion(personId: string, tx?: Prisma.TransactionClient): Promise<number>`
- Types:
  - `PublicPerson = { public_name: string | null; phone_number: string | null; registered: boolean }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.3: `toPublicPerson` builds the object from an explicit list of three fields.
- v5.0.0-15.3.1: `findOrCreateByPhone` uses an `INSERT ... ON CONFLICT DO NOTHING` then a read, so a race never creates two rows.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| find by active number | integration | AC-1 | active hit, released miss |
| find or create | integration | AC-2 | same id twice, one row, guest fields empty |
| concurrent create | integration | AC-3 | `Promise.all` of 5 calls → one row, one id |
| public view | unit | AC-4, CM-20 | full person → exactly 3 keys |
| scope version | integration | AC-5, CM-03 | two bumps → 1 then 2 |
| no private leak | security | AB-1, CWE-200 | JSON of the view contains none of the private values |

Command: `npx vitest run tests/integration/person/person-repository.test.ts`

## Out of scope
- Who may call these functions (each consumer story).
