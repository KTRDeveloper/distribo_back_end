---
id: SYNC-038
title: The phone receives logo and profile photo addresses
module: sync
kind: change
rev: 1
amends: [SYNC-003]
size: S
risk: medium
depends_on: [SYNC-037, FND-013, IMG-004, IMG-005]
read_first: [src/modules/sync/adapters/identity.adapter.ts, tests/integration/sync/pull-identity.test.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, identite-et-organisation/person]
constraints: [C-49]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# SYNC-038 — The phone receives logo and profile photo addresses

## Story
As a seller, I want the logo of my business and the photos of the people I work with on my phone, so that I recognize them.

## Context
- Exists: `organizationsAdapter` and `peopleAdapter` (SYNC-003, SYNC-037); `imageUrl(key)` (FND-013); `Organization.logo_key` and `Person.avatar_key`, chosen online and stored by the server (IMG-004, IMG-005).
- `organizations` rows gain `logo_url` and `people` rows gain `avatar_url`, each `imageUrl(key)` or null. Both are public data (design 1.1, 2.1): every person that `peopleAdapter` already lists receives the photo, which keeps the keys out of the rows.
- A new, changed or removed photo moves the row's `server_updated_at`, so it arrives as `updated`. The keys are never sent, and a phone cannot send them: the pushes stay refused.
- `C-49`: the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.

## Acceptance criteria
```gherkin
Scenario: AC-1 The logo
  Given the business has a logo
  When its SELLER pulls
  Then the organization row has `logo_url` of the stored file and no `logo_key`
Scenario: AC-2 A profile photo
  Given a collaborator and a customer person have a photo
  When a SELLER pulls
  Then both people rows carry `avatar_url`, and a person without a photo has null
Scenario: AC-3 A change
  When the logo is replaced after the last pull
  Then the organization is in `updated` with the new address
Scenario: AC-4 An anonymized person
  Given a person was anonymized and had a photo
  Then their row has `avatar_url` null
```

## Abuse cases
```gherkin
Scenario: AB-1 A key reaches the phone (information disclosure)
  When any role pulls organizations and people
  Then no row has a key field, and the people rows carry no other new field than `avatar_url`
```

## Implementation
- Create: `tests/integration/sync/pull-images.test.ts`
- Modify: `src/modules/sync/adapters/identity.adapter.ts`
- Pattern: `src/modules/sync/sync.changes.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: the people list is the one already scoped to the viewer's collaborations and relationships.
- v5.0.0-15.3.1: only the address is sent; the storage key stays on the server.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| logo | integration | AC-1, C-49 | address, no key |
| profile photos | integration | AC-2 | two rows, one null |
| logo replaced | integration | AC-3 | updated |
| anonymized | integration | AC-4 | null |
| no key | security | AB-1, CWE-200 | key fields absent |

Command: `npx vitest run tests/integration/sync/pull-images.test.ts tests/integration/sync/pull-identity.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/pull-identity.test.ts | the people row has exactly the keys full_name, id and phone_number | it has full_name, id, phone_number and avatar_url |

## Out of scope
- The logo of the business on the other side of a relationship: not synchronized.
