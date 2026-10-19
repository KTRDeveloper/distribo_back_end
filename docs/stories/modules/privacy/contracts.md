# Contracts: privacy

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### AnonymizePerson (`src/modules/privacy/privacy.service.ts`, created by PRIV-002)
- `anonymizePerson(personId: string): Promise<void>`

## Consumes
- auth: revokeSessions, verifyPassword (docs/stories/modules/auth/contracts.md)
- organization: collaborations (docs/stories/modules/organization/contracts.md)
- person: PersonRepository setAvatarKey (docs/stories/modules/person/contracts.md)
- images: ImageFiles deleteImageFiles (docs/stories/modules/images/contracts.md)
