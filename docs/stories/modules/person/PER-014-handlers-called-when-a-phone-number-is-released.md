---
id: PER-014
title: Handlers called when a phone number is released
module: person
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [PER-005]
read_first: [src/modules/person/person.repository.ts, docs/stories/modules/person/contracts.md]
design_refs: [identite-et-organisation/person]
constraints: [C-02]
asvs: [v5.0.0-2.2.1, v5.0.0-16.2.5]
---

# PER-014 — Handlers called when a phone number is released

## Story
Technical story: provide the registry where other modules attach what must happen when a phone number changes holder, so that the person module calls them without importing any of them.

## Context
- Exists: nothing for this; `findByActivePhone` and the other repository functions (PER-005).
- Adds `src/modules/person/phone-released.ts` with `registerPhoneReleasedHandler(handler)` and `firePhoneReleased(phoneNumber, tx)`.
- A handler is `(event: { phoneNumber: string }, tx: Prisma.TransactionClient) => Promise<void>`. Registering the same function twice keeps one entry. Handlers run one after the other, in registration order, inside the caller's transaction.
- A number is released by a recycled-number claim (AUTH) and by the administrators' `RELEASE_PHONE` gesture (ADM); both call `firePhoneReleased` in the transaction that frees the number. The organization module registers a handler (ORG-037).
- A failing handler stops the chain and its error reaches the caller, which rolls back: a number is never freed while a handler has not done its part (fail closed).
- `firePhoneReleased` logs nothing about the number.
- First usages: AUTH recycled-number claim, ADM `RELEASE_PHONE` and ORG-037. It ships here because the person module cannot import them (ADR-004).
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` and `avatar_key` are empty.

## Acceptance criteria
```gherkin
Scenario: AC-1 Handlers run in order with the caller's transaction
  Given two handlers registered in order
  When `firePhoneReleased` is called with a number and a transaction
  Then both run once, the first before the second, each with that number and that transaction
Scenario: AC-2 Same function twice
  When one handler is registered twice
  Then it runs once per call to `firePhoneReleased`
Scenario: AC-3 No handler
  When `firePhoneReleased` is called and none is registered
  Then it resolves and does nothing
Scenario: AC-4 A failing handler stops the chain
  Given the first of two handlers throws
  When `firePhoneReleased` is called
  Then the call rejects with that error and the second handler does not run
Scenario: AC-5 Not a phone number
  When `firePhoneReleased` receives "0677123456"
  Then it throws a RangeError and no handler runs
```

## Abuse cases
```gherkin
Scenario: AB-1 A release leaves a handler undone (tampering)
  Given one handler writes a row and the next handler throws, inside one transaction
  When `firePhoneReleased` is called and the transaction is rolled back
  Then the row of the first handler is not stored
```

## Implementation
- Create: `src/modules/person/phone-released.ts`, `tests/integration/person/phone-released.test.ts`
- Pattern: `src/modules/person/person.repository.ts`
- Signatures:
  - `registerPhoneReleasedHandler(handler: PhoneReleasedHandler): void`
  - `firePhoneReleased(phoneNumber: string, tx: Prisma.TransactionClient): Promise<void>`
- Types:
  - `PhoneReleasedHandler = (event: { phoneNumber: string }, tx: Prisma.TransactionClient) => Promise<void>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.1: the number is checked against the E.164 pattern of C-02 before any handler sees it.
- v5.0.0-16.2.5: the registry writes no log entry, so a phone number never reaches the logs.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| order and transaction | integration | AC-1 | two handlers → call order and the same tx object |
| same function twice | integration | AC-2 | register twice → one run |
| no handler | integration | AC-3 | empty registry → resolves |
| failing handler | integration | AC-4 | first throws → rejection, second not called |
| not E.164 | integration | AC-5, C-02 | "0677123456" → RangeError, no handler call |
| rollback with the caller | security | AB-1, CWE-662 | write then throw in a real transaction → no row stored |

Command: `npx vitest run tests/integration/person/phone-released.test.ts`

## Out of scope
- Releasing the number itself and the recycled-number claim (AUTH), the `RELEASE_PHONE` gesture (ADM).
- What the organization module does with a released number (ORG-037).
