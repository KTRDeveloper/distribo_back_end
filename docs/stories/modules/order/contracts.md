# Contracts: order

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### OrderCalculations (`src/modules/order/order.calculations.ts`, created by ORD-007)
- `lineAmountOf(line: { quantityMilli: bigint; deliveredQuantityMilli?: bigint | null; unitPriceApplied: bigint }): bigint`: uses `lineAmount` and the delivered quantity when set
- `orderTotal(amounts: bigint[], deliveryCost: bigint): bigint`
- Used by: `delivery`, `sync`
### OrderStateMachine (`src/modules/order/order.state.ts`, created by ORD-008)
- `transitionOrder(tx, orderId: string, to: OrderStatus, actor: { personId: string; party: 'CUSTOMER' | 'SUPPLIER' }, fields?: TransitionFields): Promise<Order>`: applies only a permitted step by a conditional update; DELIVERED wins over CANCELLED; frozen orders change only supplier_note
- Used by: `delivery`, `sync`

## Consumes
- catalog: getReferencePrice, getActiveProduct (docs/stories/modules/catalog/contracts.md)
- relationship: ensureCustomerRelationship, visibleRelationsWhere, projectForSupplier (docs/stories/modules/relationship/contracts.md)
- organization: loadActor, assertOrganizationActive (docs/stories/modules/organization/contracts.md)
- access: requireAbility, abilityFor, idempotent (docs/stories/modules/access/contracts.md)
