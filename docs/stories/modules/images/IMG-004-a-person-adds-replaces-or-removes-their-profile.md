---
id: IMG-004
title: A person adds, replaces or removes their profile photo
module: images
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [IMG-003, PER-012, PER-013]
read_first: [src/modules/images/image.service.ts, src/modules/person/person.repository.ts]
design_refs: [images/ajouter-remplacer-retirer-une-photo, identite-et-organisation/person]
constraints: [C-49, C-50]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# IMG-004 — A person adds, replaces or removes their profile photo

## Story
As a customer, I want to add, replace or remove my profile photo so that the people I trade with recognize me.

## Context
- Exists: `imageBody`, `storeUploadedImage`, `deleteImageFiles` (IMG-002, IMG-003); `setAvatarKey(personId, key, tx?)` returns the previous key (PER-013); `GET /api/v1/users/me` shows `avatar_url` (PER-012); `authMiddleware`.
- New `src/modules/images/images.routes.ts` and `images.openapi.ts`, mounted in `app.ts`: `PUT /api/v1/users/me/avatar` (authenticated, body the raw photo) answers 200 `{ avatar_url }`; `DELETE /api/v1/users/me/avatar` answers 204. The person is always the one of the session; there is no id in the path or the body. A repeat of PUT replaces the photo again; a repeat of DELETE changes nothing.
- PUT: `storeUploadedImage('avatars', bytes)`, then in one transaction `setAvatarKey`, then `deleteImageFiles([previous])`. A guest or anonymized person: the database refuses (PER-010) and the answer is 409 `AVATAR_NOT_ALLOWED`. DELETE clears the key the same way.
- Logs `info` `avatar_changed` with the person id only. Add both paths to `tests/integration/api-docs/catalog.test.ts` and `per-001.test.ts`.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.
- `C-50`: A photo file is deleted from storage as soon as its key leaves its card or its card is deleted; a nightly cleanup deletes every file older than 24 hours that no card cites.

## Acceptance criteria
```gherkin
Scenario: AC-1 Add and replace
  Given a registered person with no photo
  When they send a PNG, then a JPEG
  Then both answers are 200 with an `avatar_url` that ends with the key, and the first file is gone from storage
Scenario: AC-2 Remove
  When the person calls DELETE
  Then the answer is 204, the key is empty, the file is gone, and a second DELETE also answers 204
Scenario: AC-3 Refusals
  When a guest sends a photo, or the body is a GIF, or there is no token
  Then the answers are 409 `AVATAR_NOT_ALLOWED`, 400 `UNSUPPORTED_IMAGE` and 401 `UNAUTHORIZED`, and nothing changes
Scenario: AC-4 Failure leaves nothing behind
  Given the database write fails
  When a person sends a photo
  Then the answer is 500, the key is unchanged and the new file is removed from storage
```

## Abuse cases
```gherkin
Scenario: AB-1 A body that names another person (elevation)
  When the request carries a header or a query `person_id` of another person
  Then only the photo of the session person changes
Scenario: AB-2 A key sent by the client (tampering)
  When the body is JSON `{"avatar_key": "avatars/x.webp"}`
  Then the answer is 400 `UNSUPPORTED_IMAGE` and no key is written
```

## Implementation
- Create: `src/modules/images/images.routes.ts`, `src/modules/images/images.openapi.ts`, `src/modules/images/avatar.service.ts`, `tests/integration/images/avatar.test.ts`
- Modify: `src/app.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `replaceAvatar(personId: string, bytes: Buffer): Promise<{ avatar_url: string }>`
  - `removeAvatar(personId: string): Promise<void>`
- Errors: `AVATAR_NOT_ALLOWED` 409, `UNSUPPORTED_IMAGE` 400, `IMAGE_TOO_LARGE` 400, `UNAUTHORIZED` 401
- Dependencies: `express`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.2: the person comes from the session; no identifier from the client is read.
- v5.0.0-15.3.3: the route accepts one writable thing, the photo bytes; a key from the client is never read.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| add and replace | integration | AC-1, C-49, C-50 | PNG then JPEG → 200, urls, first file gone |
| remove | integration | AC-2, C-50 | DELETE twice → 204 both, key empty, file gone |
| refusals | integration | AC-3 | guest, GIF, no token → 409, 400, 401 |
| failure | integration | AC-4 | forced write error → 500, key kept, new file removed |
| other person | security | AB-1, CWE-639 | person_id of another person → only the session person changes |
| client key | security | AB-2, CWE-915 | JSON body with a key → 400, nothing written |

Command: `npx vitest run tests/integration/images/avatar.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the avatar paths | add PUT and DELETE /api/v1/users/me/avatar, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the avatar paths | add PUT and DELETE /api/v1/users/me/avatar, remove nothing |

## Out of scope
- The profile view that shows the address: PER-012.
- Clearing the key when an account is anonymized: the privacy module.
