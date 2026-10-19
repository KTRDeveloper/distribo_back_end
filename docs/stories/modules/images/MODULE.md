# Module Images (`images`)

Owns the upload, replacement and removal of photos (profile photo, logo, product and variant photos), the storage and re-encoding ports, the registry of copied photos and the nightly cleanup of orphan files.

- Story prefix: `IMG` · ASVS L2: Uploaded files come from untrusted phones and may carry hidden personal data (GPS position, date, device model); copies could reveal who buys from whom; photos are the one binary input of the API.
- Depends on: `foundation`, `person`, `notification`, `access`, `organization`, `catalog`
- Contracts: `contracts.md` · Model: `model.md`

## Owned entities
- `ImageCopy` (design `images/imagecopy`)

## Data classification
| data | class | handling |
|---|---|---|
| Person.avatar_key | PII | the file shows a person; the key is returned only inside the profile views already defined for the person; never logged |
| Organization.logo_key, Product.image_keys, ProductVariant.image_keys | public | the keys are rebuilt into URLs for anyone who can see the business or its catalog |
| ImageCopy.copy_key, ImageCopy.source_key, ImageCopy.root_key | confidential | never returned by any phone route and never synchronized; only the administration area may read the registry; a leak of the whole database would show who copied from whom |

## Threats (lightweight STRIDE)
| ID | STRIDE | threat | mitigation | abuse cases |
|---|---|---|---|---|
| T1 | E | A person or a member of another business changes a photo that is not theirs | the person, the organization and the role come from the session; the role is checked against the rules table before the file is read | IMG-004 AB-1, IMG-005 AB-1, IMG-005 AB-2, IMG-008 AB-1, IMG-008 AB-2, IMG-009 AB-1, IMG-010 AB-1, IMG-011 AB-1 |
| T2 | T | A client writes a storage key straight into a card | no route accepts a key from the client; the server builds the key and writes it in the same transaction as the card | IMG-004 AB-2, IMG-008 AB-3 |
| T3 | I | A photo leaks the GPS position, the date or the device model of its author | every received photo is decoded and re-encoded by the server; the stored file is never the received file | IMG-003 AB-1 |
| T4 | D | A huge or disguised file exhausts memory or storage | the body size, the type and the pixel count are checked before decoding; a refused file stores nothing | IMG-003 AB-2 |
| T5 | I | Two copies of the same photo prove that two shops buy from the same supplier | a copy gets a new random key and a slightly varied re-encoding; the registry is never synchronized or returned to a phone | IMG-006 AB-1, CAT-045 AB-1 |
| T6 | T | One file cited by two cards, deleted with the first one | a key belongs to one card only; the server refuses a key already cited | IMG-002 AB-1, IMG-006 AB-2 |
| T7 | D | The nightly cleanup deletes the photo of a card that is still live | only the keys of cards deleted more than 24 hours ago are emptied | IMG-012 AB-1 |

## Pointers
- Decision: `docs/stories/decisions/ADR-004-modules-for-design-v16.md`
- Decision (proposed): `docs/stories/decisions/ADR-005-image-and-storage-dependencies.md`
