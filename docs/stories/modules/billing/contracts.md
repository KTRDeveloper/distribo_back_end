# Contracts: billing

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### SubscriptionRights (`src/modules/billing/rights.service.ts`, created by BIL-013)
- `recomputeRights(tx: Prisma.TransactionClient, organizationId: string, now: Date): Promise<OrganizationRights>`: recalculates plan, expiry, grace and limits from the subscription rows and writes them to the organization
### SubscriptionLimits (`src/modules/billing/limits.service.ts`, created by BIL-020)
- `enforceLimits(tx: Prisma.TransactionClient, organizationId: string, rights: OrganizationRights, now: Date): Promise<{ seats: SeatEnforcement; productsPaused: number; productsResumed: number }>`: pauses or resumes the team seats and the products so that they fit the rights, following the owner's latest choice, and notifies; call it after `recomputeRights`

## Consumes
- foundation: PLANS and priceFor from src/shared/plans.ts, generatePaymentCode, httpError (docs/stories/modules/foundation/contracts.md)
- person: PersonRepository (docs/stories/modules/person/contracts.md)
- notification: notify, recipientLanguage (docs/stories/modules/notification/contracts.md)
- access: requireAbility, idempotent, abilityFor (docs/stories/modules/access/contracts.md)
- auth: authMiddleware (docs/stories/modules/auth/contracts.md)
- organization: OrganizationActor, SubscriptionFields, PaymentTargets, PlanRefresh, OrganizationLifecycleHooks (docs/stories/modules/organization/contracts.md)
- catalog: ProductPause (docs/stories/modules/catalog/contracts.md)
- order: OrderDemand (docs/stories/modules/order/contracts.md)
- delivery: findDriversWithOpenDeliveries (docs/stories/modules/delivery/contracts.md)
- admin: adminAuthMiddleware, requireAdminRole, recordAdminAction (docs/stories/modules/admin/contracts.md)
