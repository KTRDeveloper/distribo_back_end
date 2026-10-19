# Contracts: person

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### PersonRepository (`src/modules/person/person.repository.ts`, created by PER-005)
- `findByActivePhone(e164: string): Promise<Person | null>`: reads only the active number
- `findOrCreateByPhone(e164: string, tx?): Promise<Person>`: server only; creates a guest (`registered_at` empty)
- `toPublicPerson(person: Person): { public_name: string | null; phone_number: string | null; registered: boolean; avatar_url: string | null }`: avatar_url added by PER-011
- `bumpScopeVersion(personId: string, tx?): Promise<number>`: increments and returns the new value
- `setAvatarKey(personId: string, key: string | null, tx?): Promise<string | null>`: server only; writes or clears the profile photo key and returns the previous key; added by PER-013
- Used by: `auth`, `organization`, `relationship`, `admin`, `sync`, `images`, `privacy`
### RegisteredGuard (`prisma/migrations`, created by PER-008)
- `SQL function require_registered_person('col', ...) for BEFORE INSERT OR UPDATE triggers on author columns`
- Used by: `notification`, `organization`, `relationship`, `order`, `finance`, `delivery`, `admin`
### PhoneReleasedHandlers (`src/modules/person/phone-released.ts`, created by PER-014)
- `registerPhoneReleasedHandler(handler: (event: { phoneNumber: string }, tx: Prisma.TransactionClient) => Promise<void>): void`: registers once per function
- `firePhoneReleased(phoneNumber: string, tx: Prisma.TransactionClient): Promise<void>`: runs the handlers in registration order inside the caller's transaction; a failing handler aborts the release
- Used by: `auth`, `organization`, `admin`

## Consumes
- foundation: normalizeE164, newId, httpError, imageKeySchema, imageUrl (docs/stories/modules/foundation/contracts.md)
