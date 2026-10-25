# Contracts: relationship

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### RelationshipVisibility (`src/modules/relationship/relationship.visibility.ts`, created by REL-005)
- `visibleRelationsWhere(viewer: { personId: string; organizationIds: string[] }): Prisma.CustomerRelationshipWhereInput`
- `projectForSupplier(row): SupplierRelationshipView`: includes customer_label, supplier_notes, credit_limit, balance, contested_at; never supplier_label
- `projectForCustomer(row): CustomerRelationshipView`: includes supplier_label, credit_limit, balance, contested_at; never customer_label or supplier_notes
- `projectForDriver(row): DriverRelationshipView`: id, customer public name, available_credit only
- Used by: `catalog`, `order`, `finance`, `delivery`, `sync`
### RelationshipRepository (`src/modules/relationship/relationship.repository.ts`, created by REL-007)
- `ensureCustomerRelationship(tx, input: { supplierOrganizationId: string; customerPersonId?: string; customerOrganizationId?: string; createdById: string }): Promise<{ relationship: CustomerRelationship; created: boolean }>`
- `addToBalance(tx, relationshipId: string, delta: bigint): Promise<void>`: `SET balance = balance + delta`
- `resolveMergedRelation(id: string, tx?): Promise<string>`: follows merged_into_id
- Used by: `order`, `finance`, `delivery`, `sync`

## Consumes
- organization: loadActor, assertOrganizationActive, findOrganizationsByPublicNumber (docs/stories/modules/organization/contracts.md)
- person: findOrCreateByPhone, toPublicPerson, bumpScopeVersion (docs/stories/modules/person/contracts.md)
- access: requireAbility, idempotent (docs/stories/modules/access/contracts.md)
