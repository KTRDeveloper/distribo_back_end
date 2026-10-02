---
id: FND-010
title: Restore the TypeScript formatting baseline
module: foundation
kind: change
rev: 1
amends: [FND-000]
size: M
risk: medium
depends_on: [FND-000]
read_first: [package.json, .github/workflows/ci.yml]
design_refs: [notes-de-conception]
constraints: []
asvs: [v5.0.0-14.2.4]
---

# FND-010 — Restore the TypeScript formatting baseline

## Story
Technical story: format the existing TypeScript baseline and enforce the formatter in CI so that every later change starts from a clean, repeatable formatting gate.

## Context
- Exists: `npm run format` and `npm run format:check` (FND-000), scoped to `src/**/*.ts` and `tests/**/*.ts`; `.github/workflows/ci.yml` runs typecheck, lint and tests but not the formatter gate.
- The current working tree reports 88 pre-existing formatting failures: 59 source files and 29 test files. Recount before writing and record any difference without widening the configured scope.
- Changes are mechanical Prettier output only. The story adds `npm run format:check` to the existing CI test job and changes no formatter option, dependency or glob.

## Acceptance criteria
```gherkin
Scenario: AC-1 The TypeScript baseline is formatted
  Given the existing format scripts select `src/**/*.ts` and `tests/**/*.ts`
  When `npm run format` runs once
  Then a following `npm run format:check` exits 0
  And every changed TypeScript file was reported by the initial format check
Scenario: AC-2 Formatting is behavior-neutral
  When the TypeScript diff is reviewed
  Then no executable statement, API, import source, fixture value, test name, assertion, snapshot or skip state changes
  And no test is deleted, weakened or disabled
Scenario: AC-3 CI enforces the formatter gate
  When the test job runs on a push or pull request
  Then it executes `npm run format:check` after installing dependencies
  And misformatted TypeScript makes that step fail
Scenario: AC-4 Existing quality gates remain green
  When typecheck, lint and the full test suite run after formatting
  Then all three exit 0
```

## Abuse cases
```gherkin
Scenario: AB-1 Semantic changes hidden in a mechanical diff (tampering)
  When the formatting baseline is reviewed
  Then every TypeScript change is attributable only to the existing Prettier configuration
```

## Implementation
- Modify: `.github/workflows/ci.yml`, `src`, `tests`
- Pattern: `.github/workflows/ci.yml`
- Dependencies: none added

## Security
- v5.0.0-14.2.4: CI applies the same checked-in formatting command used by local development, without downloading an unpinned formatter.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| formatted baseline | integration | AC-1 | initial failure list, `npm run format`, then `npm run format:check` → exit 0 and no extra TypeScript paths |
| behavior-neutral diff | security | AC-2, AB-1, CWE-710 | changed TypeScript files → layout-only diff, tests and assertions unchanged |
| CI formatter gate | integration | AC-3 | workflow test job → contains `npm run format:check` after `npm ci` |
| existing gates | integration | AC-4 | typecheck, lint and full suite → exit 0 |

Command: `npm run format:check && npm run typecheck && npm run lint && npm test`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/**/*.ts | pre-existing test and support files fail the existing TypeScript formatting gate | formatting-only changes; inputs, fixtures, names, assertions, snapshots, skip state, coverage and runtime behavior remain unchanged |

## Out of scope
- Changing the formatting globs, `.prettierrc`, `.prettierignore`, the Prettier version or dependencies.
- Formatting JavaScript, JSON, YAML, Markdown, generated files, documentation, Prisma files, migrations, root configuration files or scripts outside the existing globs.
- Semantic refactors, import reordering, ESLint autofixes and unrelated typecheck, lint or test failures.
- The `tests/helpers/database.ts` behavior blocking PER-009.
