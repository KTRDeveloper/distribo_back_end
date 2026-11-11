# Contracts: order

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### OrderCalculations (`src/modules/order/order.calculations.ts`, created by ORD-007)
- `lineAmountOf(line: { quantityMilli: bigint; deliveredQuantityMilli?: bigint | null; unitPriceApplied: bigint }): bigint`: uses `lineAmount` and the delivered quantity when set
- `orderTotal(amounts: bigint[], deliveryCost: bigint): bigint`
- Used by: `delivery`, `sync`
### OrderStateMachine (`src/modules/order/order.state.ts`, created by ORD-008)
- `transitionOrder(tx, orderId: string, to: OrderStatus, actor: { personId: string; party: 'CUSTOMER' | 'SUPPLIER' }, fields?: TransitionFields): Promise<Order>`: applies only a permitted step by a conditional update; DELIVERED wins over CANCELLED; frozen orders change only supplier_note; `fields.acceptedAt` records an acceptance and limits the step to PENDING (ORD-023)
- Used by: `delivery`, `sync`
### OrderDemand (`src/modules/order/order.repository.ts`, created by ORD-029)
- `countOrderedLinesByVariant(tx, supplierOrganizationId: string, since: Date): Promise<Map<string, number>>`: per variant id, the lines of the supplier's orders created since that date, cancelled and deleted ones left out
- Used by: `billing`
### VariantUsage (`src/modules/order/order.repository.ts`, created by ORD-030)
- `listOrderedVariantIds(tx, variantIds: string[]): Promise<Set<string>>`: the ids among those that an order line cites, whatever the state of the line or its order
- Used by: `catalog`, `sync`

## Consumes
- catalog: getReferencePrice, getActiveVariant, variantLabel (docs/stories/modules/catalog/contracts.md)
- relationship: ensureCustomerRelationship, visibleRelationsWhere, projectForSupplier (docs/stories/modules/relationship/contracts.md)
- organization: loadActor, assertOrganizationActive (docs/stories/modules/organization/contracts.md)
- notification: notify, recipientLanguage, retargetNotifications (docs/stories/modules/notification/contracts.md)
- access: requireAbility, abilityFor, idempotent (docs/stories/modules/access/contracts.md)
