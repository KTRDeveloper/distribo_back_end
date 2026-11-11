---
id: PRIV-006
title: Account deletion also clears the phones' Android fingerprints
module: privacy
kind: change
rev: 1
amends: [PRIV-002]
size: S
risk: medium
depends_on: [PRIV-002, AUTH-039]
read_first: [src/modules/privacy/privacy.repository.ts, tests/integration/privacy/anonymize-avatar.test.ts]
design_refs: [a2-reconnaitre-un-telephone-android/ce-que-le-serveur-garde-champ-ajoute-a]
constraints: []
asvs: [v5.0.0-14.2.4]
---

# PRIV-006 — Account deletion also clears the phones' Android fingerprints

## Story
As a customer, I want deleting my account to erase my phones' fingerprints, so that nothing keeps linking a phone to me.

## Context
- In the anonymization transaction (`privacy.repository.ts`), the update that clears `push_token` on the person's devices also sets `android_id_hash` to null, revoked devices included.
- Nothing else changes in the deletion.

## Acceptance criteria
```gherkin
Scenario: AC-1 The fingerprints are erased
  Given person P with an open device and a revoked device, both with a fingerprint
  When P deletes their account
  Then both devices have android_id_hash and push_token empty
```

## Abuse cases
```gherkin
Scenario: AB-1 Another person's devices
  Given person Q with a device that has a fingerprint
  When P deletes their account
  Then Q's device keeps its fingerprint
```

## Implementation
- Create: `tests/integration/privacy/anonymize-android-id.test.ts`
- Modify: `src/modules/privacy/privacy.repository.ts`
- Pattern: `tests/integration/auth/devices.test.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-14.2.4: the fingerprint is personal data and is erased with the account, like the push token.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| erased | integration | AC-1 | both devices without fingerprint or push token |
| other person | security | AB-1, CWE-639 | Q's fingerprint kept |

Command: `npx vitest run tests/integration/privacy/anonymize-android-id.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/privacy/anonymize.test.ts | one more device field is cleared | unchanged: passes without edits |

## Out of scope
- Writing the fingerprint (AUTH-041).
