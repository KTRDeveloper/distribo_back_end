---
id: AUTH-010
title: Visitor registers with the code
module: auth
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [AUTH-009, AUTH-008, AUTH-005]
read_first: [src/modules/auth/auth.service.ts, src/modules/person/person.repository.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-05, C-02, C-03]
asvs: [v5.0.0-6.2.1, v5.0.0-6.2.4, v5.0.0-7.2.4, v5.0.0-16.3.1]
---

# AUTH-010 — Visitor registers with the code

## Story
As a visitor, I want to register with my name, my password and the code so that I get an account and am signed in on my phone.

## Context
- Exists: `verifyCode` (AUTH-003), `validatePasswordRules`, `hashPassword` (AUTH-005), `issueSession` (AUTH-008), `findByActivePhone` (PER-005), `POST /auth/register/request` (AUTH-009).
- Adds: `POST /api/v1/auth/register` with body `{ phone_number, code, full_name, password, device }` (`device` as `DeviceInfo`, AUTH-008). Response 201 `{ access_token, refresh_token, expires_in, token_type: 'Bearer', person: { id, full_name } }`.
- Creates a registered person, or completes a guest that holds the number: `full_name`, `password_hash`, `registered_at` = now, `phone_verified_at` = now. No foreign key changes: relations and invitations already point to this person.
- A registered holder answers 409 `ACCOUNT_EXISTS`. Two registrations racing for one number: the loser gets 409 `ACCOUNT_EXISTS`.
- Logs `info` event `registered` with the person id.
- `CM-05`: Password: 8 to 64 characters, spaces allowed, no composition rules, refused when on the blocklist, hashed with Argon2id; 5 failed attempts force a wait.
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` is empty.
- `C-03`: A registered person (`registered_at` set) who is not ANONYMIZED has `full_name` and `password_hash`, and `phone_verified_at` when `phone_number` is set; empty `phone_number` means empty `phone_verified_at`; empty `email` means empty `email_verified_at`.

## Acceptance criteria
```gherkin
Scenario: AC-1 New person
  Given a valid code for an unused number
  When the visitor registers with name "Béatrice Ngono", a valid password and device info
  Then the response is 201 with tokens, the person is registered with a verified number, and the password hash is Argon2id
Scenario: AC-2 Guest completed
  Given a guest holds the number and has a relationship pointing to it
  When the visitor registers
  Then the guest row becomes the registered person with the same id, and nothing pointing to it changes
Scenario: AC-3 Registered holder
  When the number belongs to a registered person
  Then the response is 409 `ACCOUNT_EXISTS` and nothing changes
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status> and no person is created
  Examples:
    | problem                          | status                 |
    | a wrong code                     | 400 OTP_INVALID        |
    | an expired code                  | 400 OTP_EXPIRED        |
    | password 1234567                 | 400 WEAK_PASSWORD      |
    | password "12345678"              | 400 WEAK_PASSWORD      |
    | full_name empty                  | 400 VALIDATION_ERROR   |
    | full_name of 101 characters      | 400 VALIDATION_ERROR   |
    | device platform "WINDOWS"        | 400 VALIDATION_ERROR   |
```

## Abuse cases
```gherkin
Scenario: AB-1 Registering someone else's number (spoofing)
  When a visitor submits a number without having its code
  Then no person is created or completed
Scenario: AB-2 Server-owned fields in the body (mass assignment)
  When the body contains id, status, registered_at or scope_version
  Then the response is 400 and nothing is stored
Scenario: AB-3 Password in logs (information disclosure)
  When a registration succeeds or fails
  Then no log line contains the password or the code
```

## Implementation
- Create: `src/modules/auth/auth.repository.ts`, `tests/integration/auth/register.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.service.ts`
- Signatures:
  - `register(input: RegisterInput): Promise<SessionResponse>`
- Types:
  - `RegisterInput = { phone_number: string; code: string; full_name: string; password: string; device: DeviceInfo }`
  - `SessionResponse = { access_token: string; refresh_token: string; expires_in: number; token_type: 'Bearer'; person: { id: string; full_name: string | null } }`
- Errors: `ACCOUNT_EXISTS` 409, `OTP_INVALID` 400, `OTP_EXPIRED` 400, `WEAK_PASSWORD` 400, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `argon2`, `@prisma/client`

## Security
- v5.0.0-6.2.1: password 8 to 64 characters; rules from `validatePasswordRules`.
- v5.0.0-7.2.4: a new device and new tokens are created.
- v5.0.0-16.3.1: registration success and failure are logged with fixed event names and no personal data.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| new person | integration | AC-1, CM-05, C-03 | register → 201, registered row, argon2id hash |
| guest completed | integration | AC-2, C-02 | same id, dependants unchanged |
| registered holder | integration | AC-3 | 409, row unchanged |
| refusals | integration | AC-4 | each Examples row → status, no row |
| wrong owner | security | AB-1, WSTG-ATHN-04 | no code → no person |
| mass assignment | security | AB-2, CWE-915 | forbidden fields → 400 |
| no secrets in logs | security | AB-3, CWE-532 | logger output has no password or code |

Command: `npx vitest run tests/integration/auth/register.test.ts`

## Out of scope
- Recycled numbers (AUTH-011). Showing what is attached to the number (REL and ORG modules).
