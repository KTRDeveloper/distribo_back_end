---
id: IMG-005
title: The owner adds, replaces or removes the business logo
module: images
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [IMG-004, ORG-038, ACC-008]
read_first: [src/modules/images/images.routes.ts, src/shared/access/ability.ts]
design_refs: [images/ajouter-remplacer-retirer-une-photo, identite-et-organisation/organization]
constraints: [C-50, C-49]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# IMG-005 — The owner adds, replaces or removes the business logo

## Story
As an owner, I want to add, replace or remove the logo of my business so that customers and suppliers recognize it.

## Context
- Exists: `imageBody`, `storeUploadedImage`, `deleteImageFiles`, the images router (IMG-003, IMG-004); `getLogoKey` and `setLogoKey(tx, organizationId, key)`, which returns the previous key (ORG-038); `loadActor`, `requireAbility`, `assertOrganizationActive`.
- Adds one row to `RULES` in `ability.ts`: OWNER, `ONLINE_FOR_ALL`, action `change_logo`, subject `Organization`. Nobody else holds it, and an owner without network does not either.
- New routes in the images router: `PUT /api/v1/organizations/{organizationId}/logo` (raw photo, answer 200 `{ logo_url }`) and `DELETE` (answer 204). Order: `loadActor`, `requireAbility('change_logo', 'Organization')`, then `imageBody()`, so the role is judged before the body is read. A repeat of PUT replaces again; a repeat of DELETE changes nothing.
- `logo.service.ts`: `assertOrganizationActive` (409 `ORGANIZATION_NOT_ACTIVE`), `storeUploadedImage('logos', bytes)`, one transaction with `setLogoKey`, then `deleteImageFiles([previous])`. If the transaction fails the new file is removed at once.
- Logs `info` `logo_changed`, organization id and person id. Add both paths to the route lists of `catalog.test.ts` and `per-001.test.ts`.
- `C-50`: A photo file is deleted from storage as soon as its key leaves its card or its card is deleted; a nightly cleanup deletes every file older than 24 hours that no card cites.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.

## Acceptance criteria
```gherkin
Scenario: AC-1 Add and replace the logo
  Given an owner whose business has no logo
  When they send a PNG, then a JPEG
  Then both answers are 200 with a `logo_url` that ends with the key, and the first file is gone
Scenario: AC-2 Remove
  When the owner calls DELETE twice
  Then both answers are 204, the key is empty and the file is gone
Scenario Outline: AC-3 Refusals
  When <who> calls PUT with a good photo
  Then the answer is <status> and nothing changes
  Examples:
    | who | status |
    | a manager or a seller | 403 FORBIDDEN |
    | someone outside the business | 404 NOT_FOUND |
    | the owner of a suspended business | 409 ORGANIZATION_NOT_ACTIVE |
    | no token | 401 UNAUTHORIZED |
Scenario: AC-4 Failure leaves nothing behind
  Given the database write fails
  When the owner sends a logo
  Then the answer is 500, the key is unchanged and the new file is removed
```

## Abuse cases
```gherkin
Scenario: AB-1 A manager sends a huge body (elevation, resource exhaustion)
  When a manager sends 3 MB of photo
  Then the answer is 403 and the processor and the storage were not called
Scenario: AB-2 An owner changes another business's logo (access control)
  When the owner of business A calls PUT on the id of business B
  Then the answer is 404 and the logo of B is unchanged
```

## Implementation
- Create: `src/modules/images/logo.service.ts`, `tests/integration/images/logo.test.ts`
- Modify: `src/modules/images/images.routes.ts`, `src/modules/images/images.openapi.ts`, `src/shared/access/ability.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `replaceLogo(actor: OrganizationActorContext, bytes: Buffer): Promise<{ logo_url: string }>`
  - `removeLogo(actor: OrganizationActorContext): Promise<void>`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `ORGANIZATION_NOT_ACTIVE` 409, `UNSUPPORTED_IMAGE` 400, `IMAGE_TOO_LARGE` 400
- Dependencies: `express`, `@casl/ability`

## Security
- v5.0.0-8.2.1: the rules table decides, and the check runs before the body is read.
- v5.0.0-8.2.2: the business comes from the active collaboration of the session; a stranger gets 404.
- v5.0.0-15.3.3: the only writable thing is the photo; the key is built by the server.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| add and replace | integration | AC-1, C-49, C-50 | PNG then JPEG → 200, urls, first file gone |
| remove | integration | AC-2, C-50 | DELETE twice → 204 both, key empty |
| refusals | integration | AC-3 | each Examples row → status, nothing changes |
| failure | integration | AC-4 | forced write error → 500, key kept, new file removed |
| manager | security | AB-1, CWE-269 | manager with 3 MB body → 403, fake storage and processor untouched |
| other business | security | AB-2, WSTG-ATHZ-02 | owner A on business B → 404, logo of B unchanged |

Command: `npx vitest run tests/integration/images/logo.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the logo paths | add PUT and DELETE /api/v1/organizations/{organizationId}/logo, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the logo paths | add PUT and DELETE /api/v1/organizations/{organizationId}/logo, remove nothing |

## Out of scope
- Showing the logo in the business views and in the synchronization: the sync stories.
- Closing a business: the files of a closed business stay until it is anonymized.
