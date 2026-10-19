# Contracts: images

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### ImageFiles (`src/modules/images/image.service.ts`, created by IMG-002)
- `deleteImageFiles(keys: string[]): Promise<void>`: removes the files from storage; a missing file is not an error
- Used by: `privacy`
### ImageCopies (`src/modules/images/image-copy.service.ts`, created by IMG-006)
- `copyImage(tx: Prisma.TransactionClient, sourceKey: string): Promise<string | null>`: stores a re-encoded copy under a new key, inserts the `ImageCopy` row, returns the new key, or null when the source file is gone
- Used by: `catalog`

## Consumes
- foundation: newImageKey, imageUrl, httpError (docs/stories/modules/foundation/contracts.md)
- person: PersonRepository setAvatarKey (docs/stories/modules/person/contracts.md)
- organization: OrganizationLogo getLogoKey and setLogoKey, OrganizationActor (docs/stories/modules/organization/contracts.md)
- catalog: setProductImageKeys, setVariantImageKeys, lockProductImageKeys, readProductImageKeys, lockVariantImageKeys, readVariantImageKeys, releaseDeletedImageKeys (docs/stories/modules/catalog/contracts.md)
- access: requireAbility, idempotent (docs/stories/modules/access/contracts.md)
