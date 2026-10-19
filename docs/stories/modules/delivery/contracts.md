# Contracts: delivery

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### DeliverOrder (`src/modules/delivery/delivery.service.ts`, created by DLV-007)
- `deliverOrder(actor: Actor, orderId: string, input: DeliverInput, options?: { viaSync?: boolean }): Promise<DeliverResult>`: the one closing gesture: order DELIVERED, SALE and optional PAYMENT entries, credit rule, partial rest
- `deleteUnstartedDeliveries(tx, orderId: string): Promise<number>`: removes deliveries not yet departed
- Used by: `sync`
### AbandonedRests (`src/modules/delivery/delivery.repository.ts`, created by DLV-012)
- `findAbandonedRests(tx, organizationId: string, period: { from: Date; toExclusive: Date }, excludePersonId: string): Promise<Map<string, { count: number; amount: bigint }>>`: per deliverer, the lines of DELIVERED orders without a child order whose delivered quantity is below the ordered one, valued at the applied price
- Used by: `finance`
### OpenDeliveries (`src/modules/delivery/delivery.repository.ts`, created by DLV-015)
- `findDriversWithOpenDeliveries(tx, organizationId: string, personIds: string[]): Promise<Set<string>>`: of those people, the ones assigned a delivery of the organization's orders that has left and neither arrived nor failed
- Used by: `billing`

## Consumes
- order: transitionOrder, lineAmountOf, orderTotal, projectOrderForSupplier (docs/stories/modules/order/contracts.md)
- finance: appendLedgerEntry (docs/stories/modules/finance/contracts.md)
- relationship: projectForDriver, visibleRelationsWhere, addToBalance (docs/stories/modules/relationship/contracts.md)
- organization: loadActor (docs/stories/modules/organization/contracts.md)
- access: requireAbility, abilityFor, idempotent (docs/stories/modules/access/contracts.md)
