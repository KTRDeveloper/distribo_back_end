# Contracts: person

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### PersonRepository (`src/modules/person/person.repository.ts`, created by PER-005)
- `findByActivePhone(e164: string): Promise<Person | null>`: reads only the active number
- `findOrCreateByPhone(e164: string, tx?): Promise<Person>`: server only; creates a guest (`registered_at` empty)
- `toPublicPerson(person: Person): { public_name: string | null; phone_number: string | null; registered: boolean }`
- `bumpScopeVersion(personId: string, tx?): Promise<number>`: increments and returns the new value
- `findByVerifiedEmail(email: string): Promise<Person | null>`: added by AUTH-015
- Used by: `auth`, `organization`, `relationship`, `admin`, `sync`
### RegisteredGuard (`prisma/migrations`, created by PER-008)
- `SQL function require_registered_person('col', ...) for BEFORE INSERT OR UPDATE triggers on author columns`
- Used by: `notification`, `organization`, `relationship`, `order`, `finance`, `delivery`, `admin`

## Consumes
- foundation: normalizeE164, newId, httpError (docs/stories/modules/foundation/contracts.md)
