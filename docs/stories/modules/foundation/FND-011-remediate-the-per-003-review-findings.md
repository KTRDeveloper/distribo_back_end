---
id: FND-011
title: Remediate the PER-003 review findings
module: foundation
kind: change
rev: 1
amends: [FND-000, FND-010, PER-003, PER-009]
size: M
risk: high
depends_on: [FND-010]
read_first: [prisma/migrations/20261002060000_per_003_person_checks/migration.sql, tests/unit/tooling/quality-gates.test.ts]
design_refs: [notes-de-conception, identite-et-organisation/person, contraintes-a-poser-au-niveau-base-de]
constraints: [C-01, C-02, C-03]
asvs: [v5.0.0-2.2.3, v5.0.0-13.4.2, v5.0.0-14.2.4]
---

# FND-011 — Remediate the PER-003 review findings

## Story
Technical story: remediate all PER-003 review findings so configuration, database rules, tests and metadata are safe and consistent.

## Context
- Exists: PER-003, FND-010 and PER-009 changes.
- Remove the tracked credential without reproducing it; revocation and replacement happen outside the repository.
- With no approved Person backfill, audit and abort with IDs only; enforce all changes in one transaction.
- Regenerate metadata from `STATUS.md`; edit no status line except FND-011.
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` is empty.
- `C-03`: A registered person (`registered_at` set) who is not ANONYMIZED has `full_name` and `password_hash`, and `phone_verified_at` when `phone_number` is set; empty `phone_number` means empty `phone_verified_at`; empty `email` means empty `email_verified_at`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Agent configuration is safe and valid
  When tracked files and this branch's commits are scanned
  Then neither the exposed nor replacement credential is present
  And the Haiku alias is exactly `cx/gpt-5.6-sol-low`
  And unconfirmed revocation blocks the story without recording a credential
Scenario: AC-2 CI uses allowed actions
  Then the workflow uses only `actions/checkout@v7` and `actions/setup-node@v7`
Scenario: AC-3 Dirty Person data fails before enforcement
  Given a row violates a new phone, completeness, verification or nonblank rule
  When the migration runs
  Then it aborts before enforcement, reports IDs without personal data and changes no row
Scenario: AC-4 Email uniqueness changes atomically
  Given verified emails collide under `lower(email)`
  When the migration runs
  Then it aborts before dropping the old unique constraint and rolls back all changes
  And clean data receives case-insensitive uniqueness for verified emails only
Scenario Outline: AC-5 Required text is usable
  When `full_name`, `password_hash` or verified `email` contains only <value>
  Then PostgreSQL rejects it with 23514
  Examples:
    | value |
    | ASCII spaces, tab or newline |
    | non-breaking or em space |
Scenario: AC-6 Fixtures cover identifier and email boundaries
  Then Person fixtures use `newId()` UUIDv7 values
  And duplicate unverified emails are accepted but verifying both is rejected with 23505
  And FND-011 owns the UUIDv7 fixture behavior hidden in FND-010
Scenario: AC-7 Metadata and gates agree
  Then generated metadata agrees with `STATUS.md`
  And validation, format, typecheck, lint and tests pass
```

## Abuse cases
```gherkin
Scenario: AB-1 Credential remains tracked (information disclosure)
  Then secret scanning finds no exposed or replacement credential
Scenario: AB-2 Migration partially weakens integrity (tampering)
  When a preflight or validation fails
  Then one transaction rolls back every constraint and index change
```

## Implementation
- Modify: `.claude/settings.json`, `.github/workflows/ci.yml`, `prisma/migrations/20261002060000_per_003_person_checks/migration.sql`, `tests/integration/person/person-checks.test.ts`, `tests/helpers/database.ts`, `tests/unit/tooling/quality-gates.test.ts`
- Pattern: `tests/unit/tooling/quality-gates.test.ts`
- Dependencies: none added

## Security
- v5.0.0-13.4.2: remove and revoke the credential without putting credentials in tracked content or output.
- v5.0.0-2.2.3: audit rows and apply checks and uniqueness changes in one transaction.
- v5.0.0-14.2.4: enforce exact policy model and CI action versions.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| configuration policy | security | AC-1, AC-2, AB-1, CWE-798 | tracked content and commits → no credential; exact alias and action versions |
| migration preflight | integration | AC-3, AB-2, C-02, C-03 | dirty row → IDs-only abort, no data or schema change |
| atomic email change | integration | AC-4, AB-2, C-03 | collision → old rule retained; clean data → partial index |
| whitespace boundaries | integration | AC-5, C-03 | whitespace-only → 23514; ordinary text → accepted |
| fixture boundaries | integration | AC-6, C-01, C-03 | UUIDv7 and duplicate unverified email → accepted; second verification → 23505 |
| backlog and gates | integration | AC-7 | validator and project gates → consistent and passing |

Command: `python3 .claude/skills/design-to-user-stories/scripts/validate.py --out docs/stories && npx vitest run tests/unit/tooling/quality-gates.test.ts tests/integration/person/person-checks.test.ts && npm run format:check && npm run typecheck && npm run lint && npm test`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/unit/tooling/quality-gates.test.ts | policy coverage missing | reject credentials and incorrect aliases or actions |
| tests/integration/person/person-checks.test.ts | migration boundaries missing | cover audit, rollback, whitespace, UUIDv7 and partial uniqueness |
| tests/helpers/database.ts | semantic change hidden by formatting | characterize the `newId()` default under FND-011 |

## Out of scope
- Repairing violating Person rows without a product rule.
- Storing credentials or rotation evidence.
