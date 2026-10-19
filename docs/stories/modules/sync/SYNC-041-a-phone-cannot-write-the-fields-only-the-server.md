---
id: SYNC-041
title: A phone cannot write the fields only the server writes
module: sync
kind: test
rev: 1
amends: []
size: S
risk: medium
depends_on: [SYNC-032, SYNC-036, SYNC-037, SYNC-038]
read_first: [src/modules/sync/sync.judge.ts, tests/integration/sync/forbidden-sends.test.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, catalogue/productvariant]
constraints: [C-41, C-46, C-49]
asvs: [v5.0.0-15.3.3, v5.0.0-8.3.1]
---

# SYNC-041 — A phone cannot write the fields only the server writes

## Story
As an owner, I want the plan, the limits, the photos and the verification of my business to stay what the server decided, so that no phone can raise a limit or publish a contact nobody verified.

## Context
- Exists: the pushes of products, variants and prices (SYNC-031 to SYNC-034), the read-only pushes of `organizations`, `people` and `organization_contacts` (SYNC-036 to SYNC-038), and `SYNC_UNKNOWN_TABLE` for a name that is not a sync table.
- Characterization tests only, no production code. The server fields added in v16: `ProductVariant.price_updated_at` and `merged_into_id`, `Product.image_keys`, `ProductVariant.image_keys`, `Organization.logo_key`, `Person.avatar_key`, `OrganizationContact.verified_at` and `verification_method`, the plan fields of `Organization`, `Product.paused_at`, and the collaboration status PAUSED.
- A catalog line that carries a server field is judged as if the field were absent. A line of a read-only table is forbidden `SYNC_TABLE_READ_ONLY`. The collaboration status has no sync table, so a batch naming one is refused `SYNC_UNKNOWN_TABLE`.
- `C-41`: `Organization.plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products` are written by the server only and sent to the team of the business only.
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.

## Acceptance criteria
```gherkin
Scenario: AC-1 Catalog fields from a phone are dropped
  When the owner creates a product with `paused_at` and `image_keys`, and a variant with `price_updated_at`, `merged_into_id` and `image_keys`
  Then both are accepted, with `paused_at` null, no image keys, `merged_into_id` null and `price_updated_at` of the server
Scenario: AC-2 Stored values stay
  Given a paused product with image keys and a variant with its `price_updated_at`
  When the owner pushes an update of their names carrying other values for those fields
  Then the names change and the paused date, the keys and the price date are unchanged
Scenario: AC-3 Read-only tables
  When a phone pushes an organization with `logo_key`, `payment_code`, `plan`, `plan_ends_at`, `grace_ends_at`, `max_collaborators` and `max_products`, a person with `avatar_key`, and a contact with `verified_at` and `verification_method`
  Then each line is forbidden `SYNC_TABLE_READ_ONLY` and the stored rows are unchanged
Scenario: AC-4 No table for the seat status
  When a batch has a table `collaborations` with `status` PAUSED
  Then the batch is refused 400 `SYNC_UNKNOWN_TABLE` and nothing is stored
```

## Abuse cases
```gherkin
Scenario: AB-1 A phone lifts its limits (mass assignment)
  Given a business on the FREE plan with a paused product
  When the owner's phone pushes `max_products` 999, `plan` ENTERPRISE and the paused product with `paused_at` null
  Then the plan and the limits are unchanged and the product is still paused
```

## Implementation
- Create: `tests/integration/sync/server-fields.test.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-15.3.3: each writable field is listed per operation, so the server fields stay outside every list.
- v5.0.0-8.3.1: the server decides these values; a phone's own state is never trusted.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| dropped fields | integration | AC-1, C-46, C-49 | stored values |
| stored values stay | integration | AC-2, C-46, C-49 | unchanged |
| read-only tables | integration | AC-3, C-41 | forbidden, rows unchanged |
| no seat table | integration | AC-4 | 400, nothing stored |
| limits | security | AB-1, CWE-915 | plan, limits and pause unchanged |

Command: `npx vitest run tests/integration/sync/server-fields.test.ts`

## Out of scope
- Changing the judge or an adapter: a failing case goes back to the story that built it (SYNC-030 to SYNC-038).
