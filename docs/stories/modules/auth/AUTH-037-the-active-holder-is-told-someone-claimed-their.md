---
id: AUTH-037
title: The active holder is told someone claimed their number
module: auth
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [AUTH-031, NTF-002]
read_first: [src/modules/auth/number-claim.service.ts, src/lib/rate-limit.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-07]
asvs: [v5.0.0-2.4.1, v5.0.0-16.3.1]
---

# AUTH-037 — The active holder is told someone claimed their number

## Story
As a customer, I want to be told when someone claims my number so that I can change it before I lose my account.

## Context
- Exists: `requestNumberClaim` and `claimRefusal` (AUTH-031), `notify` and `recipientLanguage` (NTF-002), `checkAndConsume(key, limit, windowSeconds)`.
- When a claim is refused as `RECENTLY_ACTIVE`, the holder gets one in-app notification `phone.claimed`. French: "Quelqu'un indique détenir votre numéro. Si vous ne l'utilisez plus, changez-le dans votre profil." English: "Someone says they hold your number. If you no longer use it, change it in your profile." The language comes from `recipientLanguage`.
- At most one per holder per 24 hours: `checkAndConsume('phone-claimed:<personId>', 1, 86400)`; a second claim in the day sends nothing.
- A holder refused as `SUSPENDED` is never warned, and neither is a holder whose claim is allowed. The claimant's answer does not change: the same 409 body.
- `CM-07`: Sending limits: 3 codes per hour per number, 1 minute before a resend, caps per device and per IP address, a global daily cap that alerts the team; SMS only to +237 mobiles.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Active holder warned
  Given an active holder who synchronized yesterday and whose language is <language>
  When a visitor claims the number
  Then the response is 409 and the holder has one unread notification `phone.claimed` in <language>
  Examples:
    | language |
    | FR       |
    | EN       |
Scenario: AC-2 One warning a day
  When 3 claims arrive within 24 hours, then one more after the 24-hour window has passed
  Then the holder has 1 notification after the first three and 2 after the last
Scenario Outline: AC-3 No warning
  Given the holder is <holder>
  When a visitor claims the number
  Then the holder has no notification
  Examples:
    | holder                                            |
    | suspended, last synchronization yesterday         |
    | active, last synchronization 7 months ago         |
```

## Abuse cases
```gherkin
Scenario: AB-1 Claims used to bury the holder in notices (denial of service)
  When 100 claims name the number of an active holder within one day
  Then the holder has at most one notification
```

## Implementation
- Create: `tests/integration/auth/number-claim-warning.test.ts`
- Modify: `src/modules/auth/number-claim.service.ts`
- Pattern: `src/modules/auth/otp.service.ts`
- Signatures:
  - `warnHolderOfClaim(holderId: string): Promise<void>`
- Dependencies: `ioredis`

## Security
- v5.0.0-2.4.1: one warning per holder per day, so claims cannot be used to flood a person.
- v5.0.0-16.3.1: the warning is stored for the holder only; logs carry ids, never the number.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| holder warned | integration | AC-1, CM-07 | each Examples row → 409; one notification in the language |
| one a day | integration | AC-2 | 1 notification, then 2 after the window |
| no warning | integration | AC-3 | each Examples row → zero notifications |
| burying | security | AB-1, CWE-799 | 100 claims → one notification |

Command: `npx vitest run tests/integration/auth/number-claim-warning.test.ts tests/integration/auth/number-claim.test.ts`

## Out of scope
- Who else is told (the shop owner of a contact on this number is told by ORG-037, when the number is released).
- An email or SMS to the holder: the notice is in the app only.
