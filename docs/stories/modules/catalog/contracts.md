# Contracts: catalog

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### ReferencePrice (`src/modules/catalog/catalog.repository.ts`, created by CAT-003)
- `getReferencePrice(tx, relationshipId: string, variantId: string): Promise<{ price: bigint; negotiated: boolean; changedAt: Date }>`: negotiated price when a live one exists, else the variant price (CAT-017)
- `getActiveVariant(tx, organizationId: string, variantId: string): Promise<ActiveVariant>`: 404 unless the variant is ACTIVE, owned by the organization and its product is not deleted or paused; carries the product name, variant name, unit, price, `priceUpdatedAt` and `minOrderQuantity` (CAT-019)
- Used by: `order`, `sync`
### VariantText (`src/shared/variant.ts`, created by CAT-016)
- `variantLabel(productName: string, variantName: string | null, unit: string): string`: the label frozen on an order line
- `simplifyText(text: string | null): string`: the comparison form used for variants of one product
- Used by: `order`, `sync`
### ProductPause (`src/modules/catalog/catalog.repository.ts`, created by CAT-020)
- `listProductsOnSale(tx, organizationId: string): Promise<SaleProduct[]>`: the products not deleted, not paused and with an ACTIVE variant, newest first; each with its id, creation date and all its variant ids
- `listPausedProducts(tx, organizationId: string): Promise<SaleProduct[]>`: the paused products that would be on sale again if resumed, same shape and order
- `setProductsPaused(tx, organizationId: string, productIds: string[], paused: boolean, now: Date): Promise<string[]>`: sets or clears `paused_at` on the organization's own products that are not in that state, returns the ids it changed
- Used by: `billing`
### ImageKeyWriters (`src/modules/catalog/catalog.repository.ts`, created by CAT-032)
- `setProductImageKeys(tx, organizationId: string, productId: string, keys: string[]): Promise<string[]>`: replaces the photo keys of a product of the organization, returns the previous keys, 404 if the product is not found
- `setVariantImageKeys(tx, organizationId: string, variantId: string, keys: string[]): Promise<string[]>`: same for a variant
- Used by: `images`
### ImageKeyReaders (`src/modules/catalog/catalog.repository.ts`, created by CAT-044)
- `lockProductImageKeys(tx, organizationId: string, productId: string): Promise<string[]>`: reads the photo keys of a product of the organization under a row lock, 404 if the product is not found
- `lockVariantImageKeys(tx, organizationId: string, variantId: string): Promise<{ productId: string; keys: string[] }>`: same for a variant
- `readProductImageKeys(tx, organizationId: string, productId: string): Promise<string[]>`: the same read of a product without a lock
- `readVariantImageKeys(tx, organizationId: string, variantId: string): Promise<{ productId: string; keys: string[] }>`: the same read without a lock
- Used by: `images`
### ImageKeyRelease (`src/modules/catalog/catalog.repository.ts`, created by CAT-046)
- `releaseDeletedImageKeys(tx, deletedBefore: Date, limit: number): Promise<string[]>`: empties the photo keys of products and variants deleted before the date and returns the released keys
- Used by: `images`
### CatalogSyncWriters (`src/modules/catalog/catalog.sync-writers.ts`, created by CAT-033)
- `applyProductFromSync(tx, organizationId: string, input: ProductSyncInput, now: Date): Promise<ProductSyncResult>`: creates or edits a product sent by a phone (CAT-033)
- `applyVariantFromSync(tx, organizationId: string, input: VariantSyncInput, now: Date): Promise<VariantSyncResult>`: creates or edits a variant (CAT-034); a duplicate is folded into the first one (CAT-035)
- `deleteVariantFromSync(tx, organizationId: string, variantId: string, now: Date): Promise<DeleteSyncResult>`: deletes an unused variant, takes a used one off sale (CAT-036)
- `deleteProductFromSync(tx, organizationId: string, productId: string, now: Date): Promise<DeleteSyncResult>`: same for a product and its variants (CAT-036)
- `resolveVariantForLine(tx, organizationId: string, variantId: string, now: Date): Promise<ResolvedVariant | null>`: the live variant a sale or a negotiated price cites, following a merge or bringing a deleted variant back off sale (CAT-037)
- `applyPriceFromSync(tx, organizationId: string, input: PriceSyncInput, now: Date): Promise<PriceSyncResult>`: writes a negotiated price sent by a phone; a price entered twice keeps the last (CAT-039)
- `deletePriceFromSync(tx, organizationId: string, priceId: string, now: Date): Promise<'DELETED' | 'ALREADY' | 'NOT_FOUND'>`: removes a negotiated price sent by a phone (CAT-039)
- Used by: `sync`

## Consumes
- organization: loadActor, assertOrganizationActive, PlanRefresh (docs/stories/modules/organization/contracts.md)
- relationship: visibleRelationsWhere, projectForSupplier (docs/stories/modules/relationship/contracts.md)
- access: requireAbility, abilityFor, idempotent (docs/stories/modules/access/contracts.md)
- order: VariantUsage (docs/stories/modules/order/contracts.md)
- foundation: ImageKeys (docs/stories/modules/foundation/contracts.md)
- images: ImageCopies copyImage (docs/stories/modules/images/contracts.md)
