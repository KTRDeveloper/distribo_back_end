---
id: PRIV-004
title: Account deletion also clears and removes the profile photo
module: privacy
kind: change
rev: 1
amends: [PRIV-002]
size: S
risk: high
depends_on: [PRIV-002, PER-013, IMG-002]
read_first: [src/modules/privacy/privacy.service.ts]
design_refs: [identite-et-organisation/person, donnees-personnelles-et-conservation/durees-de-conservation]
constraints: [CM-43, C-02]
asvs: [v5.0.0-14.2.4, v5.0.0-2.3.3]
---

# PRIV-004 — Account deletion also clears and removes the profile photo

## Story
As a customer, I want my profile photo to disappear when I delete my account so that my face is not kept after my personal data is erased.

## Context
- Exists: `anonymizePerson(personId)` in one transaction (PRIV-002); `setAvatarKey(personId, key, tx?)` returns the previous key (PER-013); `deleteImageFiles(keys)` never fails its caller and skips a key a card still cites (IMG-002).
- Why: the database refuses an anonymized person that still has a photo key (PER-010), so without this change a person with a photo could not delete their account.
- Change in `anonymizePerson`: inside the transaction, first `setAvatarKey(personId, null, tx)` and keep the previous key, then the existing steps. After the commit, when there was a previous key, call `deleteImageFiles([previous])`. A rolled-back transaction leaves the key and the file as they were.
- A storage error is logged by `deleteImageFiles` and does not undo the deletion: the nightly cleanup (IMG-007) removes the file within a day.
- The log `account_anonymized` is unchanged and still carries the person id only.
- `CM-43`: Anonymization also clears the profile photo key in the same transaction and, once it is committed, deletes the photo file from storage; a file that cannot be deleted is removed by the nightly cleanup.
- `C-02`: `phone_number` is unique, E.164; exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` and `avatar_key` are empty.

## Acceptance criteria
```gherkin
Scenario: AC-1 Photo removed
  Given a person with a profile photo key and its file in storage
  When they delete their account
  Then the answer is 204, `avatar_key` is empty and the file is gone from storage
Scenario: AC-2 No photo
  Given a person without a photo
  When they delete their account
  Then the answer is 204 and storage is not called
Scenario: AC-3 Atomic
  Given a later step of the anonymization fails
  Then the person keeps the key and the file stays in storage
Scenario: AC-4 Storage trouble
  Given storage refuses to delete the file
  When the person deletes their account
  Then the answer is 204 and the key is empty
```

## Abuse cases
```gherkin
Scenario: AB-1 Photo left behind (information disclosure)
  When the cards and the storage are read after the deletion
  Then no card cites the key and the file is not in storage
Scenario: AB-2 Another person's photo (tampering)
  When person A deletes their account
  Then the photo key and the file of person B are unchanged
```

## Implementation
- Create: `tests/integration/privacy/anonymize-avatar.test.ts`
- Modify: `src/modules/privacy/privacy.service.ts`
- Pattern: `src/modules/privacy/privacy.service.ts`
- Signatures:
  - `anonymizePerson(personId: string): Promise<void>`
- Dependencies: none added

## Security
- v5.0.0-14.2.4: the photo key and its file are removed with the other personal data.
- v5.0.0-2.3.3: the key is cleared in the same transaction as the other columns.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| photo removed | integration | AC-1, CM-43, C-02 | person with key and file → 204, key empty, file absent |
| no photo | integration | AC-2 | no key → 204, storage delete not called |
| atomic | integration | AC-3, CWE-362 | revokeSessions throws → key and file kept |
| storage trouble | integration | AC-4 | storage delete rejects → 204, key empty |
| photo left behind | security | AB-1, CWE-212 | key cited nowhere, file absent |
| other photos | security | AB-2, CWE-284 | neighbour keeps key and file |

Command: `npx vitest run tests/integration/privacy/anonymize-avatar.test.ts tests/integration/privacy/anonymize.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/privacy/anonymize.test.ts | none expected: its people hold no photo, so the new step changes nothing for them | no assertion changes; the run confirms it |

## Out of scope
- The photo routes (IMG-004). The nightly cleanup of files no card cites (IMG-007).
