---
id: FND-013
title: Image keys and public image addresses
module: foundation
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [FND-005]
read_first: [src/shared/ids.ts, src/config/env.ts]
design_refs: [images/stockage]
constraints: []
asvs: [v5.0.0-5.3.2, v5.0.0-13.2.4]
---

# FND-013 — Image keys and public image addresses

## Story
Technical story: the server builds the storage key of every image and turns a stored key into its public address, so that no module writes a key or an address by hand.

## Context
- Exists: `newId()` (UUIDv7, `src/shared/ids.ts`); `env` is validated once at startup in `src/config/env.ts`. No image code exists.
- A key is `<folder>/<UUIDv4>.webp` with folder `logos`, `avatars` or `products` (product photos and variant photos share `products`). A UUIDv4, never a UUIDv7, which carries its creation time; no organization, product or person id appears in a key.
- The database keeps keys only. The address is the base address plus `/` plus the key; the base address is set per deployment in `IMAGE_PUBLIC_BASE_URL`, so changing the storage provider touches no row.
- Adds: `src/lib/image-keys.ts`, the variable `IMAGE_PUBLIC_BASE_URL` (required, `http` or `https`, no trailing `/`, no query, no fragment), a placeholder line in `.env.example`.
- First usage: IMG-002 (stores files under these keys) and the views that return a photo address. The helpers ship here so that every module can use them without importing `images` (ADR-004).

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 A new key has a fixed shape
  When `newImageKey("<folder>")` is called
  Then the result is "<folder>/", then a lower-case UUIDv4, then ".webp"
  Examples:
    | folder |
    | logos |
    | avatars |
    | products |
Scenario: AC-2 A key reveals nothing and is never repeated
  When 1000 keys are created for the folder `products`
  Then the 1000 keys are all different
  And none of the 36-character identifiers passes `uuidV7Schema`
Scenario Outline: AC-3 Only canonical keys are accepted
  When `imageKeySchema` parses <key>
  Then the result is <result>
  Examples:
    | key | result |
    | products/3f8a2c4e-9b1d-4e6f-8a7b-1c2d3e4f5a6b.webp | accepted |
    | logos/3f8a2c4e-9b1d-4e6f-8a7b-1c2d3e4f5a6b.webp | accepted |
    | avatars/3f8a2c4e-9b1d-7e6f-8a7b-1c2d3e4f5a6b.webp | rejected |
    | products/3F8A2C4E-9B1D-4E6F-8A7B-1C2D3E4F5A6B.webp | rejected |
    | products/3f8a2c4e-9b1d-4e6f-8a7b-1c2d3e4f5a6b.png | rejected |
    | other/3f8a2c4e-9b1d-4e6f-8a7b-1c2d3e4f5a6b.webp | rejected |
Scenario: AC-4 The address is the base address plus the key
  Given `IMAGE_PUBLIC_BASE_URL` is "http://localhost:3000/images"
  When `imageUrl("products/3f8a2c4e-9b1d-4e6f-8a7b-1c2d3e4f5a6b.webp")` is called
  Then the result is "http://localhost:3000/images/products/3f8a2c4e-9b1d-4e6f-8a7b-1c2d3e4f5a6b.webp"
  And `imageUrl(null)` is null
Scenario Outline: AC-5 A wrong base address stops the application at startup
  When the environment is validated with `IMAGE_PUBLIC_BASE_URL` set to <value>
  Then validation fails and names `IMAGE_PUBLIC_BASE_URL`
  Examples:
    | value |
    | missing |
    | localhost:3000/images |
    | http://localhost:3000/images/ |
    | http://localhost:3000/images?size=1 |
    | javascript:alert(1) |
```

## Abuse cases
```gherkin
Scenario: AB-1 A crafted key points outside the image address (tampering)
  When `imageUrl` receives "../secret" or "products/../../secret" or "//other-host/x.webp"
  Then it throws a RangeError and builds no address
```

## Implementation
- Create: `src/lib/image-keys.ts`, `tests/unit/lib/image-keys.test.ts`
- Modify: `src/config/env.ts`, `.env.example`
- Pattern: `src/shared/ids.ts`
- Signatures:
  - `newImageKey(folder: ImageFolder): string`
  - `imageKeySchema: z.ZodString`
  - `buildImageUrl(baseUrl: string, key: string): string`
  - `imageUrl(key: string | null): string | null`
- Types:
  - `ImageFolder = 'logos' | 'avatars' | 'products'`
- Dependencies: `uuid`, `zod`

## Security
- v5.0.0-5.3.2: a key is always built by `newImageKey` from a random identifier; no client text becomes part of a key or an address.
- v5.0.0-13.2.4: images are served from one base address fixed at deployment and validated at startup; `imageUrl` accepts only canonical keys, so it cannot point elsewhere.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| key shape | unit | AC-1 | each folder → matches the pattern with a lower-case UUIDv4 |
| keys are mute and distinct | unit | AC-2 | 1000 keys → distinct, no UUIDv7 |
| canonical keys only | unit | AC-3 | each Examples row → accepted or rejected |
| address building | unit | AC-4 | `buildImageUrl` with a base address and `imageUrl` with the test base address → expected address; null → null |
| base address validation | unit | AC-5 | `vi.resetModules()`, set the variable, import `src/config/env.ts` → rejects with `IMAGE_PUBLIC_BASE_URL` in the error |
| crafted key | security | AB-1, CWE-22 | the three values → RangeError and no address |

Command: `npx vitest run tests/unit/lib/image-keys.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/setup.ts | the application now requires `IMAGE_PUBLIC_BASE_URL` at startup and the test environment does not set it | set the fake value http://localhost:3000/images with the other fake variables |

## Out of scope
- Storing, reading or deleting image files, and the limit `k` of photos per card: IMG-002 and IMG-004.
- The `*_key` columns: each owning module adds its own.
- The `ImageStorage` and `ImageProcessor` ports (ADR-005).
