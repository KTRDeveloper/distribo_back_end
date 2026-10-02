---
id: PER-009
title: Restore the test baseline after the unified Person integrity changes
module: person
kind: change
rev: 1
amends: [PER-003]
size: S
risk: medium
depends_on: [PER-002]
read_first: [tests/integration/person/person-table.test.ts, tests/integration/data-model/identity.test.ts]
design_refs: [identite-et-organisation/person, contraintes-a-poser-au-niveau-base-de]
constraints: [C-02, C-03]
asvs: [v5.0.0-2.2.3, v5.0.0-14.2.4]
---

# PER-009 — Restore the test baseline after the unified Person integrity changes

## Story
Technical story: reconcile the legacy identity tests with the unified Person schema and its integrity checks so that the full test baseline verifies the current design instead of removed models.

## Context
- Exists: the unified `people` table (PER-002) and its integrity constraints (PER-003); PER-003's dedicated tests pass.
- `person-table.test.ts` still uses non-E.164 values in successful inserts and leaves unrelated Person fields invalid in enum rejection cases.
- `identity.test.ts` still creates removed `Account` rows and unavailable `Organization` and `Customer` rows; `db.test.ts` still expects removed Prisma delegates.
- This story changes tests only. It does not restore removed models or alter production code, the Prisma schema or migrations.
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` is empty.
- `C-03`: A registered person (`registered_at` set) who is not ANONYMIZED has `full_name` and `password_hash`, and `phone_verified_at` when `phone_number` is set; empty `phone_number` means empty `phone_verified_at`; empty `email` means empty `email_verified_at`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Existing Person fixtures satisfy the integrity checks
  Given the PER-003 constraints are installed
  When the successful cases in `person-table.test.ts` insert a Person
  Then every active phone number is valid E.164
  And exactly one of `phone_number` and `released_phone_number` is set
Scenario: AC-2 Negative tests fail for their intended reason
  When the invalid status and invalid language cases run
  Then every unrelated Person field satisfies the current integrity constraints
  And each case is rejected for its invalid enum value rather than a phone or completeness check
Scenario: AC-3 Legacy identity expectations match the unified Person model
  When `identity.test.ts` runs
  Then no retained test creates or queries `Account`, `Organization` or `Customer`
  And obsolete or not-yet-available model scenarios are retired rather than restoring those models
  And current Person invariants remain covered without duplicating equivalent tests
Scenario: AC-4 Prisma delegate inventory matches the current schema
  When `db.test.ts` checks the generated Prisma client
  Then every model in the current schema has a delegate
  And removed `Account`, `OtpChallenge`, `EmailVerificationRequest` and `RefreshToken` delegates are not required
Scenario: AC-5 The test baseline is restored
  When the PER-003 tests and the full quality gates run
  Then the story tests, full suite, typecheck, lint and format check all pass
```

## Abuse cases
```gherkin
Scenario: AB-1 Weakening integrity tests to hide failures (tampering)
  When the legacy tests are reconciled
  Then no PER-003 constraint or assertion is disabled, bypassed or weakened
```

## Implementation
- Modify: `tests/integration/person/person-table.test.ts`, `tests/integration/data-model/identity.test.ts`, `tests/unit/db.test.ts`
- Pattern: `tests/integration/person/person-checks.test.ts`
- Dependencies: none added

## Security
- v5.0.0-2.2.3: fixtures satisfy every unrelated database invariant so negative tests prove the intended constraint.
- v5.0.0-14.2.4: tests verify only the identity models present in the current generated client.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| valid Person fixtures | integration | AC-1, C-02, C-03 | successful inserts use E.164 and exactly one phone column |
| isolated enum failures | integration | AC-2, C-02, C-03 | otherwise-valid rows with invalid status or language → intended rejection |
| unified identity tests | integration | AC-3 | retained suite uses Person only; removed or future model scenarios retired |
| current delegates | unit | AC-4 | generated client → current delegates present, removed delegates not required |
| full baseline | integration | AC-5 | targeted tests and all quality gates → pass |
| constraints preserved | security | AB-1, CWE-20 | PER-003 tests remain enabled and pass unchanged |

Command: `npx vitest run tests/integration/person/person-checks.test.ts tests/integration/person/person-table.test.ts tests/integration/data-model/identity.test.ts tests/unit/db.test.ts && npm test && npm run typecheck && npm run lint && npm run format:check`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/person/person-table.test.ts | successful fixtures use non-E.164 values and enum cases are not otherwise valid under PER-003 | use `uniquePhone()` or explicit valid E.164 values and make enum cases satisfy unrelated constraints |
| tests/integration/data-model/identity.test.ts | exercises removed Account and unavailable Organization/Customer models | retain only non-duplicated current Person invariants and retire obsolete or future-model cases |
| tests/unit/db.test.ts | expects Prisma delegates removed by PER-002 | assert delegates represented by the current schema and stop requiring removed identity/auth delegates |

## Out of scope
- Production code, Prisma schema and migration changes.
- Restoring Account, Organization, Customer or any other removed or not-yet-implemented model.
- Renaming the intentionally retained `Task.accountId` field or unrelated account-named test helpers.
