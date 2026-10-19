# Model: images

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## ImageCopy
Design: `images/imagecopy`

| field | type | constraints |
|---|---|---|
| copy_key | string, PK | C-56 |
| source_key | string | C-56 |
| root_key | string | C-56 |
| copied_at | datetime |  |

- `ImageCopy:required`: NOT NULL: `source_key`, `root_key`, `copied_at`
- `C-56`: `ImageCopy` has `copy_key` as primary key; `root_key` equals the source's `root_key` when the source is itself a copy, else the source key; written by the server only, in the transaction that stores the copy's key; never synchronized; never updated, deleted or purged.
- `C-39`: `ImageCopy` is an immutable table: the application account has only INSERT and SELECT.
