---
id: ADM-004
title: Two-factor codes for administrators
module: admin
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [ADM-001]
read_first: [src/lib/crypto.ts, docs/stories/CONVENTIONS.md]
design_refs: [gouvernance-de-la-plateforme/administrator]
constraints: []
asvs: [v5.0.0-6.3.3, v5.0.0-6.5.1, v5.0.0-11.3.2]
---

# ADM-004 — Two-factor codes for administrators

## Story
Technical story: provide TOTP secret creation, encryption and code verification with replay protection, so that administrator login can require a second factor.

## Context
- Exists: `encrypt`, `decrypt` (AES-256-GCM) in `src/lib/crypto.ts`; Redis client and `checkAndConsume`.
- Adds: `src/lib/totp.ts` using `otplib`: `createTotpSecret()` returns `{ secret, otpauthUri }` (issuer "Distribo", 6 digits, 30 seconds), `encryptSecret`/`decryptSecret` wrappers, and `verifyTotp(administratorId, secret, code)` accepting the current step and one step either side, and refusing a step already used by that administrator (key `totp:used:<administratorId>:<step>`, 90 seconds).

## Acceptance criteria
```gherkin
Scenario: AC-1 Secret and URI
  Then createTotpSecret returns a base32 secret and a URI starting `otpauth://totp/` that contains the issuer
Scenario: AC-2 Verify
  When a code for the current step is verified
  Then it is accepted; a code from one step earlier or later is accepted; two steps away is refused
Scenario: AC-3 No reuse
  When an accepted code is presented again
  Then it is refused
Scenario: AC-4 Encryption
  Then the encrypted secret differs from the secret and decrypts back to it
Scenario Outline: AC-5 Malformed codes
  When the code is <code>
  Then verification returns false
  Examples:
    | code       |
    | 12345      |
    | 1234567    |
    | abcdef     |
    | empty      |
```

## Abuse cases
```gherkin
Scenario: AB-1 Replay of an observed code (spoofing)
  When an attacker replays a valid code within its window
  Then it is refused
```

## Implementation
- Create: `src/lib/totp.ts`, `tests/unit/admin/totp.test.ts`
- Pattern: `src/lib/crypto.ts`
- Signatures:
  - `createTotpSecret(): { secret: string; otpauthUri: string }`
  - `verifyTotp(administratorId: string, secret: string, code: string): Promise<boolean>`
- Dependencies: `otplib`, `ioredis`

## Security
- v5.0.0-6.5.1: a code is used once.
- v5.0.0-11.3.2: the secret is stored with AES-GCM.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| secret and uri | unit | AC-1 | formats |
| verify window | unit | AC-2 | ±1 accepted, ±2 refused |
| no reuse | unit | AC-3 | second use refused |
| encryption | unit | AC-4 | round trip |
| malformed | unit | AC-5 | false |
| replay | security | AB-1, WSTG-ATHN-04, CWE-294 | refused |

Command: `npx vitest run tests/unit/admin/totp.test.ts`

## Out of scope
- Using it at login (ADM-006).
