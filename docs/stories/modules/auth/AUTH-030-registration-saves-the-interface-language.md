---
id: AUTH-030
title: Registration saves the interface language
module: auth
kind: change
rev: 1
amends: [AUTH-010]
size: XS
risk: high
depends_on: [AUTH-010]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/auth.repository.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-05]
asvs: [v5.0.0-2.2.1, v5.0.0-6.2.1]
---

# AUTH-030 — Registration saves the interface language

## Story
As a visitor, I want my language saved when I register so that the app and the messages I receive use it on every phone.

## Context
- Exists: `POST /api/v1/auth/register` takes `{ phone_number, code, full_name, password, device }`; `register` refuses a weak password before it spends the code; `completeRegistration(tx, { phone, fullName, passwordHash })`.
- Adds the optional body field `preferred_language` (`FR` or `EN`). When present it is stored in `Person.preferred_language` for a new person and for a guest who is completed; when absent the column stays empty, as for people who registered before. The language of the code message does not change here.
- A weak password keeps the code: the person corrects it and sends again with the same code, with no new SMS. It already holds; this story pins it with a test.
- `CM-05`: password rules.
- `Person` fields: `preferred_language` enum [FR / EN], nullable
- `CM-05`: Password: 8 to 64 characters, spaces allowed, no composition rules, refused when on the common or leaked password blocklist; hashed with Argon2id; 5 failed attempts force a wait (design lines 63, 108-111)

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Language stored
  When a visitor registers with preferred_language <sent>
  Then the person has preferred_language <stored>
  Examples:
    | sent   | stored |
    | EN     | EN     |
    | FR     | FR     |
    | absent | empty  |
Scenario: AC-2 Guest completed
  Given a guest holds the number
  When the visitor registers with preferred_language "EN"
  Then the same row becomes the registered person with language EN
Scenario Outline: AC-3 Invalid language
  When preferred_language is <value>
  Then the response is 400 `VALIDATION_ERROR` and no person is created
  Examples:
    | value                |
    | "fr"                 |
    | "DE"                 |
    | ""                   |
    | a string of 1000 characters |
Scenario: AC-4 Weak password keeps the code
  When a visitor posts password "1234567" with a valid code, then a valid password with the same code
  Then the first answers 400 `WEAK_PASSWORD` and the second 201
```

## Abuse cases
```gherkin
Scenario: AB-1 A free-text language reaches storage (tampering)
  When preferred_language is "<script>alert(1)</script>"
  Then the response is 400 and nothing is stored
```

## Implementation
- Create: `tests/integration/auth/register-language.test.ts`
- Modify: `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.repository.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/otp.service.ts`
- Signatures:
  - `completeRegistration(tx: Prisma.TransactionClient, input: { phone: string; fullName: string; passwordHash: string; preferredLanguage?: 'FR' | 'EN' }): Promise<Person | null>`
- Types:
  - `RegisterInput = RegisterInput & { preferred_language?: 'FR' | 'EN' }`
- Errors: `VALIDATION_ERROR` 400, `WEAK_PASSWORD` 400
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-2.2.1: the language is an enum, so no other text reaches the column.
- v5.0.0-6.2.1: the password is checked before the code is spent.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| language stored | integration | AC-1 | each Examples row → stored value |
| guest completed | integration | AC-2 | same id, language EN |
| invalid language | integration | AC-3 | each Examples row → 400, no row |
| weak password keeps the code | integration | AC-4, CM-05 | 400, then 201 with the same code |
| free text | security | AB-1, CWE-20 | script text → 400 |

Command: `npx vitest run tests/integration/auth/register-language.test.ts tests/integration/auth/register.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/auth/register.test.ts | the register body gains an optional field | unchanged: bodies without `preferred_language` still pass and the column stays empty |

## Out of scope
- Changing the language afterwards in the settings (person module).
- Sending the code message in the visitor's language.
