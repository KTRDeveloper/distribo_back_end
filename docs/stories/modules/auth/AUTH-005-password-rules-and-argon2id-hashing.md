---
id: AUTH-005
title: Password rules and Argon2id hashing
module: auth
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [FND-000]
read_first: [docs/stories/CONVENTIONS.md, src/lib/crypto.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-05]
asvs: [v5.0.0-6.2.1, v5.0.0-6.2.4, v5.0.0-6.2.5, v5.0.0-6.2.8, v5.0.0-6.2.9, v5.0.0-11.4.2]
---

# AUTH-005 — Password rules and Argon2id hashing

## Story
Technical story: provide password hashing and the password rules of the design, so that every flow checks passwords the same way.

## Context
- Adds: `src/lib/password.ts` (`hashPassword`, `verifyPassword`, `validatePasswordRules`) and `src/lib/password-blocklist.ts` (`isBlockedPassword(plain)`), plus `data/common-passwords.txt` (one lower-case password per line; start with at least these 20: 123456, 12345678, password, motdepasse, azerty, azerty123, qwerty, qwerty123, 111111, 000000, abc123, iloveyou, admin, welcome, letmein, monkey, dragon, football, bonjour, cameroun). The real list is supplied before release (Q-004).
- Argon2id parameters: memory 19456 KiB, time 2, parallelism 1. The hash is verified against the password exactly as typed (no trim, no case change).
- Rules: length 8 to 64 characters counted in Unicode code points, spaces allowed, no composition rule, refused when the lower-cased password is in the blocklist. Broken rules are returned as codes `TOO_SHORT`, `TOO_LONG`, `BLOCKED`.
- `CM-05`: Password: 8 to 64 characters, spaces allowed, no composition rules, refused when on the blocklist, hashed with Argon2id; 5 failed attempts force a wait.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Rules
  When validatePasswordRules receives <password>
  Then the result is <result>
  Examples:
    | password                       | result        |
    | 1234567                        | TOO_SHORT     |
    | abcdefgh                       | valid         |
    | le riz aime la pluie           | valid         |
    | 64 characters                  | valid         |
    | 65 characters                  | TOO_LONG      |
    | Password                       | BLOCKED       |
    | 12345678                       | BLOCKED       |
    | 8 emoji characters             | valid         |
Scenario: AC-2 Hash and verify
  When hashPassword hashes "le riz aime la pluie" twice
  Then both hashes start with `$argon2id$`, differ from each other, and verifyPassword accepts the password against each
  And verifyPassword rejects "le riz aime la pluie " with a trailing space
Scenario: AC-3 Garbage hash
  When verifyPassword receives a hash that is not Argon2id
  Then it returns false and does not throw
```

## Abuse cases
```gherkin
Scenario: AB-1 Composition rules would push predictable passwords (design conflict)
  When a lower-case password of 8 letters that is not on the blocklist is validated
  Then it is valid
```

## Implementation
- Create: `src/lib/password.ts`, `src/lib/password-blocklist.ts`, `data/common-passwords.txt`, `tests/unit/auth/password.test.ts`
- Pattern: `src/lib/crypto.ts`
- Signatures:
  - `hashPassword(plain: string): Promise<string>`
  - `verifyPassword(hash: string, plain: string): Promise<boolean>`
  - `validatePasswordRules(plain: string): Promise<Array<'TOO_SHORT' | 'TOO_LONG' | 'BLOCKED'>>`
  - `isBlockedPassword(plain: string): Promise<boolean>`
- Dependencies: `argon2`

## Security
- v5.0.0-11.4.2: Argon2id with the stated parameters.
- v5.0.0-6.2.5: no rule about character types.
- v5.0.0-6.2.8: no trimming or normalization of the password.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| rules | unit | AC-1, CM-05 | each Examples row → result |
| hash and verify | unit | AC-2, CM-05 | two hashes differ, both verify; trailing space fails |
| garbage hash | unit | AC-3 | bcrypt-looking string → false, no throw |
| no composition | unit | AB-1 | 8 lower-case letters off the list → valid |

Command: `npx vitest run tests/unit/auth/password.test.ts`

## Out of scope
- The full blocklist file (Q-004). Lockout after failures (AUTH-014).
