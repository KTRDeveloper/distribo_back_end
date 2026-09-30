---
id: FND-004
title: Shared phone number normalization
module: foundation
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [FND-000]
read_first: [docs/stories/CONVENTIONS.md, tests/helpers/phone.ts]
design_refs: [legende, identite-et-organisation/person]
constraints: []
asvs: [v5.0.0-2.2.1]
---

# FND-004 — Shared phone number normalization

## Story
Technical story: normalize every entered phone number to E.164 with one function, so that two spellings of a number never become two people.

## Context
- Exists: `tests/helpers/phone.ts` with `uniquePhone()` that returns Senegalese numbers.
- Adds: `src/shared/phone.ts` using `libphonenumber-js`; `uniquePhone()` now returns valid Cameroon mobile numbers (`+2376` then a digit 5 to 9 then 7 digits).

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Normalization
  When normalizeE164 is called with <input>
  Then the result is <output>
  Examples:
    | input               | output        |
    | 6 77 12 34 56       | +237677123456 |
    | +237 677 12 34 56   | +237677123456 |
    | 00237677123456      | +237677123456 |
    | 237677123456        | +237677123456 |
    | +237222123456       | null          |
    | 12345               | null          |
    | abc                 | null          |
Scenario: AC-2 Only Cameroon mobiles receive messages
  Then isCameroonMobile returns true for `+237677123456` and false for a valid mobile number of another country
Scenario: AC-3 Schema
  When phoneNumberSchema parses "6 77 12 34 56"
  Then it returns `+237677123456`
  And it fails on an invalid number with a message that does not echo the input
Scenario: AC-4 E.164 shape
  Then every result matches `^\+[1-9][0-9]{7,14}$`
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/shared/phone.ts`, `tests/unit/shared/phone.test.ts`
- Modify: `tests/helpers/phone.ts`
- Pattern: `tests/unit/crypto.test.ts`
- Signatures:
  - `normalizeE164(input: string): string | null`
  - `isCameroonMobile(e164: string): boolean`
- Types:
  - `phoneNumberSchema: z.ZodEffects<z.ZodString, string, string>`
- Dependencies: `libphonenumber-js`, `zod`

## Security
- v5.0.0-2.2.1: refuse landlines and non-numbers; a Zod error message never contains the entered value.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| normalization | unit | AC-1, AC-4 | each Examples row → output |
| cameroon only | unit | AC-2 | +237677123456 → true; a valid Senegal mobile number → false |
| schema | unit | AC-3 | valid → E.164; invalid → ZodError without the input in the message |
| test helper | unit | AC-1 | `uniquePhone()` 50 times → all valid, all distinct |

Command: `npx vitest run tests/unit/shared/phone.test.ts`

## Out of scope
- The database CHECK on `Person.phone_number` (PER-001).
