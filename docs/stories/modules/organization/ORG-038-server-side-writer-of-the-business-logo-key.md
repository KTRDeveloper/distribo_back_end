---
id: ORG-038
title: Server-side writer of the business logo key
module: organization
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [ORG-020, FND-013]
read_first: [src/modules/organization/organization.repository.ts, docs/stories/modules/foundation/contracts.md]
design_refs: [identite-et-organisation/organization, images/stockage]
constraints: [C-49]
asvs: [v5.0.0-15.3.3, v5.0.0-2.2.3]
---

# ORG-038 — Server-side writer of the business logo key

## Story
Technical story: provide the two functions that read and write a business logo key, the write handing back the previous key, so that the images module can delete the old file after the commit.

## Context
- Exists: the column `logo_key`, unique (ORG-020); `imageKeySchema` and the folder `logos` (FND-013).
- Adds to `organization.repository.ts`: `getLogoKey(organizationId)` (null when empty or the organization is absent or deleted) and `setLogoKey(tx, organizationId, key)`: in the caller's transaction it locks the organization row, reads the previous key, writes the new one (`null` clears it) and returns the previous key.
- Only the server calls them: the logo routes of the images module (IMG). No organization schema accepts a key.
- A key must match `imageKeySchema` and start with `logos/`; otherwise a RangeError is thrown and nothing is written. A key already held by another business is refused by the unique index and the error is not caught.
- First usage: IMG (logo upload and removal). It ships here because the images module may import `organization` only through its contract (ADR-004).
- `Organization` fields: `logo_key` string, nullable
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (database limit); the application allows `k` of them (5 at most, set at deployment); a key is cited by one card only, across all tables; `image_keys`, `Organization.logo_key` and `Person.avatar_key` are written by the server only.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Set, replace and clear
  Given a business whose logo key is <before>
  When `setLogoKey` is called with <given>
  Then it returns <returned> and `getLogoKey` returns <given>
  Examples:
    | before | given | returned |
    | empty  | key A | null     |
    | key A  | key B | key A    |
    | key B  | null  | key B    |
Scenario: AC-2 Unknown or deleted business
  When `setLogoKey` is called with such an id
  Then it fails with 404 `NOT_FOUND` and `getLogoKey` returns null
Scenario: AC-3 One file, one business
  Given business X holds key A
  When `setLogoKey` gives key A to business Y
  Then it fails with unique violation 23505 and Y's key is unchanged
Scenario: AC-4 Same transaction as the caller
  Given the caller's transaction is rolled back after `setLogoKey`
  Then the stored key is the one from before
Scenario: AC-5 Two replacements at once
  Given a business holds key A
  When two calls replace it with key B and key C at the same time
  Then one returns key A and the other returns the key the first wrote
```

## Abuse cases
```gherkin
Scenario: AB-1 A key from another folder or a crafted key (tampering)
  When `setLogoKey` receives `avatars/<uuid>.webp`, `logos/../x.webp` or an uppercase UUID
  Then it throws a RangeError and the stored key is unchanged
Scenario: AB-2 An owner sends a key in a request (tampering)
  When the creation request carries `logo_key`
  Then the answer is 400 VALIDATION_ERROR and no business is created
```

## Implementation
- Create: `tests/integration/organization/logo-key-writer.test.ts`
- Modify: `src/modules/organization/organization.repository.ts`
- Pattern: `src/modules/person/person.repository.ts`
- Signatures:
  - `getLogoKey(organizationId: string): Promise<string | null>`
  - `setLogoKey(tx: Prisma.TransactionClient, organizationId: string, key: string | null): Promise<string | null>`
- Errors: `NOT_FOUND` 404
- Dependencies: `@prisma/client`

## Security
- v5.0.0-15.3.3: the logo key has exactly one writer, and it validates the key.
- v5.0.0-2.2.3: the row is locked before the previous key is read, so two writers never return the same previous key.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| set replace clear | integration | AC-1 | each Examples row → returned and stored values |
| unknown business | integration | AC-2 | random and deleted ids → 404, null |
| shared file | integration | AC-3, C-49 | key A on Y → 23505, key unchanged |
| same transaction | integration | AC-4 | rollback after the call → previous key stored |
| concurrent | integration | AC-5 | `Promise.all` of two replacements → A and the first writer's key |
| crafted key | security | AB-1, CWE-22 | the three values → RangeError and key unchanged |
| key in the body | security | AB-2, CWE-915 | 400, no row |

Command: `npx vitest run tests/integration/organization/logo-key-writer.test.ts`

## Out of scope
- Receiving, re-encoding and storing the file, and deleting the previous file: IMG.
- Checking that the key is not cited by another card: IMG.
