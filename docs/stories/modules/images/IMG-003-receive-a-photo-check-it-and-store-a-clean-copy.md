---
id: IMG-003
title: Receive a photo, check it and store a clean copy
module: images
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [IMG-002]
read_first: [src/modules/images/image.service.ts, src/modules/images/image.ports.ts]
design_refs: [images/stockage, images/ajouter-remplacer-retirer-une-photo]
constraints: [C-49]
asvs: [v5.0.0-5.2.1, v5.0.0-5.2.2, v5.0.0-5.2.6]
---

# IMG-003 — Receive a photo, check it and store a clean copy

## Story
Technical story: read a photo sent as raw bytes, check its size, type and pixels, and store a re-encoded copy under a new key, so that a stored photo never carries what the phone put in the file.

## Context
- Exists: the ports, the fake adapters, the settings `IMAGE_MAX_BYTES` and `IMAGE_MAX_PIXELS`, `deleteImageFiles` (IMG-002); `newImageKey` (FND-013).
- New `src/middleware/image-body.ts`: `imageBody()` accepts only `Content-Type` image/jpeg, image/png or image/webp. It refuses a `Content-Length` over `IMAGE_MAX_BYTES` before reading, reads at most that many bytes (`express.raw`) and maps the parser's "too large" error. It leaves a Buffer in `req.body`.
- `image.service.ts` gains `storeUploadedImage(folder, bytes): Promise<string>`. Order: size (1 to `IMAGE_MAX_BYTES`); `inspect` (unreadable or other format: 400 `UNSUPPORTED_IMAGE`); pixels `width × height` over `IMAGE_MAX_PIXELS` (400 `IMAGE_TOO_LARGE`); `reencode` with no variation; `put` under `newImageKey(folder)`; return the key. The received bytes are never stored.
- A bad file stores nothing. The extension and any file name are ignored.
- Callers (IMG-004, IMG-005) write the key on the card in one transaction, then call `deleteImageFiles` for the previous key; if that transaction fails they delete the new file at once.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.

## Acceptance criteria
```gherkin
Scenario: AC-1 A good photo
  When a PNG of 800 by 600 is received for the folder avatars
  Then the key matches `avatars/<UUIDv4>.webp` and storage holds WebP bytes under it
Scenario Outline: AC-2 Refusals
  When the body is <problem>
  Then the answer is <status> and storage holds no new file
  Examples:
    | problem                   | status                    |
    | 4 MB with the limit 3 MB  | 400 IMAGE_TOO_LARGE       |
    | 5000 by 5000 pixels       | 400 IMAGE_TOO_LARGE       |
    | a GIF                     | 400 UNSUPPORTED_IMAGE     |
    | text sent as image/png    | 400 UNSUPPORTED_IMAGE     |
    | an empty body             | 400 VALIDATION_ERROR      |
    | Content-Type text/html    | 400 UNSUPPORTED_IMAGE     |
Scenario: AC-3 Two uploads of one file
  When the same bytes are received twice
  Then the two keys differ
```

## Abuse cases
```gherkin
Scenario: AB-1 Hidden data survives (information disclosure)
  Given a JPEG whose extra bytes hold a GPS marker
  When it is received
  Then the stored bytes differ from the received bytes and hold no marker
Scenario: AB-2 A huge or disguised file (resource exhaustion)
  When a 100 MB body is announced, and then streamed with no length
  Then both are refused before the file is decoded and nothing is stored
```

## Implementation
- Create: `src/middleware/image-body.ts`, `tests/integration/images/image-intake.test.ts`
- Modify: `src/modules/images/image.service.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `imageBody(): RequestHandler`
  - `storeUploadedImage(folder: 'logos' | 'avatars' | 'products', bytes: Buffer): Promise<string>`
- Errors: `IMAGE_TOO_LARGE` 400, `UNSUPPORTED_IMAGE` 400, `VALIDATION_ERROR` 400
- Dependencies: `express`

## Security
- v5.0.0-5.2.1: the size is checked on the header and again while reading.
- v5.0.0-5.2.2: the content is inspected; the declared type and the name prove nothing.
- v5.0.0-5.2.6: the pixel count is checked before any decoding of pixels.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| good photo | integration | AC-1, C-49 | PNG 800x600 → key pattern, WebP bytes stored |
| refusals | integration | AC-2 | each Examples row → status, storage unchanged |
| two uploads | integration | AC-3 | same bytes twice → two keys |
| hidden data | security | AB-1, CWE-200 | JPEG with a GPS marker → stored bytes without it |
| huge or disguised | security | AB-2, CWE-400 | 100 MB announced, then streamed without length → refused, nothing stored |

Command: `npx vitest run tests/integration/images/image-intake.test.ts`

## Out of scope
- The routes that use it: IMG-004 and IMG-005.
- Quotas per person.
