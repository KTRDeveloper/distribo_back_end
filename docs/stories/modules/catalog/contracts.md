# Contracts: catalog

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### ReferencePrice (`src/modules/catalog/catalog.repository.ts`, created by CAT-003)
- `getReferencePrice(tx, relationshipId: string, productId: string): Promise<{ price: bigint; negotiated: boolean; changedAt: Date }>`: negotiated price when a live one exists, else the product price
- `getActiveProduct(tx, organizationId: string, productId: string): Promise<Product>`: 404 unless ACTIVE and owned by the organization
- Used by: `order`, `sync`

## Consumes
- organization: loadActor, assertOrganizationActive (docs/stories/modules/organization/contracts.md)
- relationship: visibleRelationsWhere, projectForSupplier (docs/stories/modules/relationship/contracts.md)
- access: requireAbility, abilityFor, idempotent (docs/stories/modules/access/contracts.md)
