# Contracts: access

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### AccessRules (`src/shared/access/ability.ts`, created by ACC-001)
- `ROLES, atLeast(role: string, min: string): boolean`: false for an unknown role or minimum
- `abilityFor(role: string, ctx: AccessContext): MongoAbility`: deny by default
- `AccessContext = { onServer: boolean; online: boolean; daysSinceSync: number }`
- Used by: `organization`, `relationship`, `catalog`, `order`, `finance`, `delivery`, `sync`
### RequireAbility (`src/middleware/require-ability.ts`, created by ACC-006)
- `requireAbility(action: string, subjectType: string): RequestHandler`: reads `req.actor`, context `{ onServer: false, online: true, daysSinceSync: 0 }`, answers 403 FORBIDDEN
- Used by: `organization`, `relationship`, `catalog`, `order`, `finance`, `delivery`
### Idempotent (`src/middleware/idempotent.ts`, created by ACC-007)
- `idempotent(): RequestHandler`: first request runs, a repeat returns the stored status and body
- Used by: `organization`, `relationship`, `catalog`, `order`, `finance`, `delivery`

## Consumes
- person: `people` table (docs/stories/modules/person/contracts.md)
