---
id: CAT-037
title: A sale sent for a deleted or merged variant finds its variant again
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [CAT-036]
read_first: [src/modules/catalog/catalog.sync-writers.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/productvariant, catalogue/product]
constraints: [C-48, C-47, C-36]
asvs: [v5.0.0-8.2.2, v5.0.0-2.3.3]
---

# CAT-037 — A sale sent for a deleted or merged variant finds its variant again

## Story
Technical story: give the catalog the function that finds, or brings back, the variant that a sale or a negotiated price sent by a phone cites, so that no sale is lost because its article was deleted or merged in the meantime.

## Context
- Exists: deletion by synchronization (CAT-036) and merged duplicates (CAT-034).
- `resolveVariantForLine(tx, organizationId, variantId, now)` answers `{ variantId, productId, label, restored, redirectedFrom }` or `null`.
- A variant not deleted answers itself. A variant of another organization or an unknown id answers `null`.
- A deleted variant with `merged_into_id` answers the live variant at the end of that link, with `redirectedFrom` set to the id asked; the link is followed at most 5 times, and a link that leads to no live variant is treated as a deleted variant without a link.
- A deleted variant without a link is brought back (C-48): `deleted_at` is emptied, `status` becomes INACTIVE (off sale), its product is brought back too when deleted, and `restored` is true. When a live variant of the same product now has the same simplified name and unit (C-47), that live one is answered instead, `redirectedFrom` set, nothing restored.
- A brought-back variant and its product move their `server_updated_at`. Brought back off sale, it never counts as a product on sale.
- `C-48`: A variant cited by an order line or a negotiated price is never deleted, only taken off sale (`INACTIVE`); a deletion received for a cited variant becomes a withdrawal from sale, and a line received for a deleted variant restores it, off sale.
- `C-47`: Two variants of one product that are not deleted never share both the same simplified name and the same simplified unit (capitals and extra spaces ignored, an empty name counts as empty text); `merged_into_id` set implies the variant is deleted.
- `C-36`: No uniqueness rule makes a sync fail; every possible duplicate has a written behavior, and a line no rule can write is set aside.

## Acceptance criteria
```gherkin
Scenario: AC-1 A live variant
  When the id of a live variant is resolved
  Then the same id is answered with `restored` false and `redirectedFrom` empty
Scenario: AC-2 A merged duplicate
  Given variant B was merged into variant A
  When B is resolved
  Then A is answered with `redirectedFrom` B
Scenario: AC-3 A deleted variant comes back
  Given a deleted variant of a deleted product
  When it is resolved
  Then it is INACTIVE and not deleted, its product is not deleted, and `restored` is true
Scenario: AC-4 Its place was taken
  Given a deleted variant and a live variant of the same product with the same simplified name and unit
  When the deleted one is resolved
  Then the live one is answered with `redirectedFrom` set and nothing is restored
Scenario Outline: AC-5 Nothing found
  When the id is <id>
  Then the answer is null and nothing is written
  Examples:
    | id                                     |
    | unknown                                |
    | a variant of another organization      |
Scenario: AC-6 A broken chain
  Given a merged variant whose target is itself deleted without a link
  When the merged one is resolved
  Then the target is brought back and answered
```

## Abuse cases
```gherkin
Scenario: AB-1 Reviving another business's article (broken access control)
  When business A resolves the id of a deleted variant of business B
  Then the answer is null and B's variant stays deleted
```

## Implementation
- Create: `tests/integration/catalog/sync-resolve-variant.test.ts`
- Modify: `src/modules/catalog/catalog.sync-writers.ts`, `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `resolveVariantForLine(tx: Prisma.TransactionClient, organizationId: string, variantId: string, now: Date): Promise<ResolvedVariant | null>`
- Types:
  - `ResolvedVariant = { variantId: string; productId: string; label: string; restored: boolean; redirectedFrom: string | null }`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: the variant and every link are read through the organization id.
- v5.0.0-2.3.3: the restoration of a variant and of its product run in the caller's transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| live | integration | AC-1 | same id |
| merged | integration | AC-2, C-47 | redirected id |
| restored | integration | AC-3, C-48 | INACTIVE, product back |
| place taken | integration | AC-4, C-47 | live twin answered |
| nothing found | integration | AC-5 | each Examples row → null |
| broken chain | integration | AC-6, C-36 | target restored |
| other business | security | AB-1, CWE-639 | null, still deleted |

Command: `npx vitest run tests/integration/catalog/sync-resolve-variant.test.ts`

## Out of scope
- Writing the order line with the resolved variant, and the information line: the synchronization.
