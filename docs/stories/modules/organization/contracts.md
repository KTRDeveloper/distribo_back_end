# Contracts: organization

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### OrganizationActor (`src/middleware/load-actor.ts`, created by ORG-005)
- `loadActor: RequestHandler`: reads `req.params.organizationId` and `req.user.id`, sets `req.actor = { personId, organizationId, role }` from an ACTIVE collaboration, else 404 NOT_FOUND
- `getActiveCollaboration(personId: string, organizationId: string): Promise<Collaboration | null>`
- `assertOrganizationActive(organizationId: string, tx?): Promise<void>`: 409 ORGANIZATION_NOT_ACTIVE when SUSPENDED or CLOSED
- Used by: `relationship`, `catalog`, `order`, `finance`, `delivery`, `sync`
### AmountHeld (`src/modules/organization/organization.repository.ts`, created by ORG-003)
- `addAmountHeld(tx, personId: string, organizationId: string, delta: bigint): Promise<void>`: `SET amount_held = amount_held + delta`
- Used by: `finance`
### PublicContacts (`src/modules/organization/organization.repository.ts`, created by ORG-018)
- `findOrganizationsByPublicNumber(e164: string): Promise<Array<{ id: string; name: string; description: string | null }>>`
- Used by: `relationship`

## Consumes
- person: PersonRepository, require_registered_person (docs/stories/modules/person/contracts.md)
- access: requireAbility, idempotent, abilityFor (docs/stories/modules/access/contracts.md)
- notification: notify (docs/stories/modules/notification/contracts.md)
- auth: authMiddleware, revokeSessions (docs/stories/modules/auth/contracts.md)
