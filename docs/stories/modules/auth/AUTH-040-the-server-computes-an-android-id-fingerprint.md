---
id: AUTH-040
title: The server computes an Android id fingerprint with its own key
module: auth
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [AUTH-039]
read_first: [src/config/env.ts, src/lib/crypto.ts]
design_refs: [a2-reconnaitre-un-telephone-android/ce-que-le-serveur-garde-champ-ajoute-a, a2-reconnaitre-un-telephone-android/le-principe]
constraints: []
asvs: [v5.0.0-11.2.1, v5.0.0-13.3.1]
---

# AUTH-040 — The server computes an Android id fingerprint with its own key

## Story
Technical story: compute the fingerprint of an Android id with a server key and the person id, so that it tells only whether two logins of the same person come from the same phone.

## Context
- New environment variable `ANDROID_ID_HASH_KEY`: required, at least 32 characters, declared like `JWT_SECRET` in `src/config/env.ts`; a missing or short key stops the app.
- Map it in `src/config/index.ts` (`config.auth.androidIdHashKey`); add a placeholder line to `.env.example` and a fake value in `tests/setup.ts` next to `JWT_SECRET`.
- New `src/lib/android-id.ts`: `hashAndroidId(personId, androidId)` = HMAC-SHA256 with `node:crypto`, keyed by the server key, over the person id and the Android id joined by `:`, as lowercase hex.
- The same Android id gives different fingerprints for two persons, so fingerprints never link two accounts.
- Never log the key, the Android id or the fingerprint.

## Acceptance criteria
```gherkin
Scenario: AC-1 Same person, same phone
  When the fingerprint of person P and Android id "a1b2c3d4e5f60718" is computed twice
  Then both results are equal, 64 lowercase hex characters
Scenario: AC-2 Two persons, same phone
  When the fingerprints of P and Q for the same Android id are computed
  Then they differ
Scenario: AC-3 Another key
  When the key changes
  Then the fingerprint of P and the same Android id differs from before
Scenario Outline: AC-4 The key is required
  Given ANDROID_ID_HASH_KEY is <value>
  When the configuration loads
  Then it <result>
  Examples:
    | value         | result |
    | absent        | fails  |
    | 31 characters | fails  |
    | 32 characters | loads  |
```

## Abuse cases
```gherkin
Scenario: AB-1 Recovering the id from the fingerprint
  Given a fingerprint taken from the database without the key
  When an attacker computes a plain SHA-256 of every 16-hex Android id with the person id
  Then none matches, because the fingerprint needs the server key
```

## Implementation
- Create: `src/lib/android-id.ts`, `tests/unit/lib/android-id.test.ts`
- Modify: `src/config/env.ts`, `src/config/index.ts`, `.env.example`, `tests/setup.ts`
- Pattern: `tests/unit/auth/attempt-counter.test.ts`
- Signatures:
  - `hashAndroidId(personId: string, androidId: string): string`
- Dependencies: none added

## Security
- v5.0.0-11.2.1: the fingerprint uses the HMAC of `node:crypto`, never a hand-made hash.
- v5.0.0-13.3.1: the key comes only from the environment, validated at startup, never logged.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| same input | unit | AC-1 | equal, 64 hex |
| two persons | unit | AC-2 | different |
| key change | unit | AC-3 | different |
| key required | unit | AC-4 | each Examples row → fails or loads |
| no key | security | AB-1, CWE-916 | plain SHA-256 differs from the fingerprint |

Command: `npx vitest run tests/unit/lib/android-id.test.ts`

## Out of scope
- Receiving the Android id at login (AUTH-041).
