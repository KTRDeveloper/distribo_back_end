---
id: PRIV-002
title: Person deletes their account by anonymization
module: privacy
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [PRIV-001, AUTH-008, AUTH-005]
read_first: [src/modules/privacy/privacy.service.ts, src/modules/auth/session.service.ts]
design_refs: [identite-et-organisation/person, donnees-personnelles-et-conservation/durees-de-conservation]
constraints: [CM-01, CM-02, C-02, C-03]
asvs: [v5.0.0-6.2.3, v5.0.0-7.4.2, v5.0.0-14.2.4, v5.0.0-16.3.1]
---

# PRIV-002 — Person deletes their account by anonymization

## Story
As a customer, I want to delete my account so that my personal data is erased while the businesses keep their history.

## Context
- Exists: `deletionCheck` (PRIV-001), `verifyPassword`, `revokeSessions`.
- Adds: `DELETE /api/v1/users/me` with `{ password }`; response 204. Refused with 409 `DELETION_BLOCKED` and the blockers when `deletionCheck` finds any; a wrong password answers 401 `INVALID_CREDENTIALS` (attempts counted with the login counter for the person's number).
- `anonymizePerson(personId)` in one transaction: `full_name`, `email`, `email_verified_at`, `preferred_language` and `password_hash` set to null; `phone_number` moved to `released_phone_number`, `phone_verified_at` null; `status` ANONYMIZED, `anonymized_at` now; every session revoked; every ACTIVE or INVITED collaboration REVOKED with `is_public_contact` false (their held money stays visible to the owner); their notifications, one-time codes and device push tokens deleted or cleared; their `Task` rows deleted. Relationships, orders, ledger entries and journals stay and keep pointing to the person.
- Logs `info` event `account_anonymized` with the person id.
- `CM-01`: Anonymization erases full_name, email, email_verified_at, preferred_language and password_hash, releases the number (moves it to released_phone_number), sets status ANONYMIZED and anonymized_at.
- `CM-02`: Account deletion is refused while the person has a positive balance on a relation where they are the customer, or owns an organization that is neither transferred nor closed.
- `C-02`: `phone_number` is unique, E.164; exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` is empty.
- `C-03`: A registered person (`registered_at` set) who is not ANONYMIZED has `full_name` and `password_hash`, and `phone_verified_at` when `phone_number` is set; empty `phone_number` means empty `phone_verified_at`; empty `email` means empty `email_verified_at`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Anonymize
  When a person with nothing blocking deletes their account with the right password
  Then the response is 204 and the row has the personal columns empty, phone_number empty, released_phone_number holding the old number, status ANONYMIZED and anonymized_at set
Scenario: AC-2 Sessions and traces
  Then every device is revoked, notifications and one-time codes of the person are gone, push tokens are empty
Scenario: AC-3 Team and history
  Then their collaborations are REVOKED with the flag false, and their orders, entries and relationships still point to them
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                                   | status                     |
    | a positive balance as customer            | 409 DELETION_BLOCKED |
    | an owned ACTIVE organization              | 409 DELETION_BLOCKED       |
    | a wrong password                          | 401 INVALID_CREDENTIALS    |
    | no password                               | 400 VALIDATION_ERROR       |
Scenario: AC-5 Cannot sign in afterwards
  Then a login with the old number answers 404 ACCOUNT_NOT_FOUND, as for any unknown number (AUTH-028)
Scenario: AC-6 Atomic
  When any step fails
  Then the person is unchanged
```

## Abuse cases
```gherkin
Scenario: AB-1 Deleting someone else's account (spoofing)
  When a request has a valid token but a wrong password
  Then nothing is deleted
Scenario: AB-2 Personal data left behind (information disclosure)
  When the person row and their dependent rows are read after deletion
  Then no name, email, hash, language, notification or code remains
```

## Implementation
- Create: `tests/integration/privacy/anonymize.test.ts`
- Modify: `src/modules/privacy/privacy.routes.ts`, `src/modules/privacy/privacy.service.ts`, `src/modules/privacy/privacy.repository.ts`, `src/modules/privacy/privacy.schemas.ts`
- Pattern: `src/modules/privacy/privacy.service.ts`
- Signatures:
  - `anonymizePerson(personId: string): Promise<void>`
  - `deleteAccount(personId: string, input: { password: string }): Promise<void>`
- Errors: `DELETION_BLOCKED` 409, `INVALID_CREDENTIALS` 401, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `@prisma/client`, `argon2`

## Security
- v5.0.0-6.2.3: the password is required.
- v5.0.0-7.4.2: every session ends.
- v5.0.0-14.2.4: personal columns and dependents are erased in one transaction.
- v5.0.0-16.3.1: the event is logged without personal data.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| anonymize | integration | AC-1, CM-01, C-02, C-03 | columns |
| sessions and traces | integration | AC-2 | gone |
| team and history | integration | AC-3 | as described |
| refusals | integration | AC-4, CM-02 | each Examples row → status |
| no sign in | integration | AC-5 | 404 ACCOUNT_NOT_FOUND |
| atomic | integration | AC-6, CWE-362 | unchanged |
| wrong password | security | AB-1, CWE-620 | nothing deleted |
| data left behind | security | AB-2, CWE-212 | nothing remains |

Command: `npx vitest run tests/integration/privacy/anonymize.test.ts`

## Out of scope
- Erasing backups (deployment).
