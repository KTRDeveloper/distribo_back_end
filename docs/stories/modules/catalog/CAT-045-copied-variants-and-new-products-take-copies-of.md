---
id: CAT-045
title: Copied variants and new products take copies of the photos
module: catalog
kind: change
rev: 1
amends: [CAT-031]
size: M
risk: high
depends_on: [CAT-031, CAT-032, CAT-044, IMG-006]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [images/ajouter-a-mon-catalogue, images/imagecopy]
constraints: [C-56, C-49]
asvs: [v5.0.0-8.2.2, v5.0.0-2.3.3]
---

# CAT-045 — Copied variants and new products take copies of the photos

## Story
As a manager, I want the photos of the articles I copy into my catalog to come with them so that my customers see what I sell without my taking new pictures.

## Context
- Exists: `copyProduct` (CAT-031) creates or reuses the destination product and creates the variants in one transaction; `setProductImageKeys`, `setVariantImageKeys` (CAT-032); `readProductImageKeys`, `readVariantImageKeys` (CAT-044); `copyImage(tx, sourceKey)` returns a new key or null when the source file is gone (IMG-006).
- Change in `copyProduct`, in that same transaction and once the rows exist: a variant that is created takes a copy of every photo of its source variant, and a new product also takes a copy of every photo of the source product, in the same order. The source cards are read with the supplier's organization id.
- An existing destination product, and a variant listed in `already_in_catalog`, keep their photos: nothing is copied for them.
- Each key goes through `copyImage`; a null is skipped, so a card may end with fewer photos. The new keys are written with the setters. A storage or database error fails the whole copy (500, nothing created); files already stored wait for the nightly cleanup (IMG-007).
- The answer shows the copies' `image_urls` only. No key of the supplier and no registry row is ever returned.
- `C-56`: `ImageCopy` has `copy_key` as primary key; `root_key` equals the source's `root_key` when the source is itself a copy, else the source key; written by the server only, in the transaction that stores the copy's key; never synchronized; never updated, deleted or purged.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.

## Acceptance criteria
```gherkin
Scenario: AC-1 New product
  Given a supplier product "Riz" with one photo and a variant "sac 25 kg" with one photo
  When a reseller copies the variant into a new product
  Then the new product and the new variant each have one photo, under keys different from the supplier's, and the supplier's keys are unchanged
Scenario: AC-2 Existing destination
  Given the reseller's product "Riz" already has two photos
  When a variant is copied into it
  Then its two photos are unchanged and the new variant has a copy of its source photos
Scenario: AC-3 Variant already there
  When a variant listed in `already_in_catalog` is copied again
  Then its photos are unchanged
Scenario: AC-4 A source file is gone
  Given one of two source photos is missing in storage
  Then the copy answers 201 and the card holds one photo
Scenario: AC-5 The registry
  Then each copied photo has one `image_copies` row with its source and root keys
```

## Abuse cases
```gherkin
Scenario: AB-1 Two resellers copy the same photo (information disclosure, T5)
  When two resellers copy the same variant
  Then the two files differ from the source and from each other
Scenario: AB-2 The supplier's key reaches the reseller (information disclosure)
  When the answer and the rows of the reseller are read
  Then no key of the supplier appears in them
```

## Implementation
- Create: `tests/integration/catalog/copy-photos.test.ts`
- Modify: `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `copyProduct(actor: Actor, input: CopyProductInput): Promise<CopyProductResult>`
- Dependencies: none added

## Security
- v5.0.0-8.2.2: the source cards are read through the caller's customer relationship, never by an id alone.
- v5.0.0-2.3.3: the cards, their keys and the registry rows are written in one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| new product | integration | AC-1, C-49 | product and variant photos copied, new keys |
| existing destination | integration | AC-2 | old photos kept, new variant has copies |
| already there | integration | AC-3 | no change |
| file gone | integration | AC-4 | 201, one photo |
| registry | integration | AC-5, C-56 | one row per copy with root key |
| same source twice | security | AB-1, CWE-200 | files differ from the source and each other |
| supplier key | security | AB-2, CWE-200 | no supplier key in the answer or the rows |

Command: `npx vitest run tests/integration/catalog/copy-photos.test.ts tests/integration/catalog/copy-variants.test.ts`

## Out of scope
- Copying a photo between two variants of one product: IMG-011.
