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
- `findOrganizationsByPublicNumber(e164: string): Promise<Array<{ id: string; name: string; description: string | null }>>`: ACTIVE organizations with a verified PHONE contact holding the number
- Used by: `relationship`
### OrganizationLifecycleHooks (`src/modules/organization/lifecycle-hooks.ts`, created by ORG-034)
- `registerLifecycleHook(hook: { onClose?: (tx: Prisma.TransactionClient, organizationId: string, now: Date) => Promise<void>; onReopen?: (tx: Prisma.TransactionClient, organizationId: string, now: Date) => Promise<void> }): () => void`: hooks run inside the closing or reopening transaction, in registration order; the returned function removes the hook
- Used by: `billing`
### SubscriptionFields (`src/modules/organization/organization.repository.ts`, created by ORG-035)
- `writePlanFields(tx: Prisma.TransactionClient, organizationId: string, fields: PlanFields): Promise<void>`: after creation, the only writer of `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators`, `max_products`; the database refuses an impossible combination
- `listTeamSeats(tx: Prisma.TransactionClient, organizationId: string): Promise<TeamSeat[]>`: non-owner collaborations ACTIVE, INVITED or PAUSED, oldest invitation first; TeamSeat = { id, personId, role, status, invitedAt, acceptedAt }
- `setSeatPaused(tx: Prisma.TransactionClient, collaborationId: string, paused: boolean): Promise<boolean>`: PAUSED from ACTIVE or INVITED; back to ACTIVE, or INVITED when `accepted_at` is empty; never for the OWNER; a change bumps the person's scope version and returns true
- Used by: `billing`
### PaymentTargets (`src/modules/organization/organization.repository.ts`, created by ORG-044)
- `findOrganizationByPaymentCode(code: string, tx?: Prisma.TransactionClient): Promise<OrganizationSummary | null>`: exact match, non-deleted; no trimming or case change; OrganizationSummary = { id, name, status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' }
- `findOrganizationSummary(organizationId: string, tx?: Prisma.TransactionClient): Promise<OrganizationSummary | null>`: null when absent or deleted
- `findActiveOwnerId(tx: Prisma.TransactionClient, organizationId: string): Promise<string | null>`: person id of the ACTIVE OWNER
- Used by: `billing`
### PlanRefresh (`src/modules/organization/organization.repository.ts`, created by ORG-045)
- `readPlanFields(tx: Prisma.TransactionClient, organizationId: string): Promise<PlanFields | null>`: the five plan fields of a non-deleted business, else null
- `listOrganizationsEnding(from: Date, to: Date, limit: number, afterId?: string): Promise<string[]>`: ids of non-deleted businesses, ascending, whose plan is not FREE and whose `plan_ends_at` is in [from, to); reads only
- `listOrganizationsToRefresh(now: Date, limit: number, afterId?: string): Promise<string[]>`: ids of non-deleted businesses, ascending, whose plan is not FREE and whose grace or plan end is past, or whose ACTIVE and INVITED non-owner seats exceed `max_collaborators`; reads only
- Used by: `billing`
### OrganizationLogo (`src/modules/organization/organization.repository.ts`, created by ORG-038)
- `getLogoKey(organizationId: string): Promise<string | null>`
- `setLogoKey(tx: Prisma.TransactionClient, organizationId: string, key: string | null): Promise<string | null>`: the only writer of `logo_key`; returns the previous key; a key outside `logos/` throws a RangeError
- Used by: `images`

## Consumes
- person: PersonRepository, require_registered_person, registerPhoneReleasedHandler (docs/stories/modules/person/contracts.md)
- access: requireAbility, idempotent, abilityFor (docs/stories/modules/access/contracts.md)
- notification: notify (docs/stories/modules/notification/contracts.md)
- auth: authMiddleware, revokeSessions, OtpService issueCode and verifyCode (docs/stories/modules/auth/contracts.md)
- foundation: generatePaymentCode, PLANS (docs/stories/modules/foundation/contracts.md)
