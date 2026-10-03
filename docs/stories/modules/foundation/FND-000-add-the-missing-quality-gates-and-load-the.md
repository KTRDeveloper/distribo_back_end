---
id: FND-000
title: Add the missing quality gates and load the conventions
module: foundation
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: []
read_first: [docs/stories/CONVENTIONS.md, package.json]
design_refs: [notes-de-conception]
constraints: []
asvs: [v5.0.0-15.2.1, v5.0.0-13.4.2]
---

# FND-000 — Add the missing quality gates and load the conventions

## Story
Technical story: add CI, security lint rules, secret scanning and a dependency audit, and make CLAUDE.md load CONVENTIONS.md, so that every later story is checked the same way.

## Context
- Exists: `src/modules/health/health.routes.ts` with `tests/integration/health.test.ts`; scripts `lint`, `typecheck`, `test` in `package.json`; `.eslintrc.json` in the legacy format; `CLAUDE.md`. There is no `.github/` folder.
- Adds: `.github/workflows/ci.yml`, `eslint-plugin-security` in the lint configuration, one `CLAUDE.md` line. Configuration changes only; existing source changes only to clear lint errors.

## Acceptance criteria
```gherkin
Scenario: AC-1 The baseline scripts pass
  When `npm run typecheck` and `npm run lint` run on a clean checkout
  Then both exit 0
  And if ESLint 9.39.1 rejects the legacy `.eslintrc.json`, its rules are moved unchanged to `eslint.config.js` first
Scenario: AC-2 Security lint rules fail the build
  Given a file that calls `eval` on a variable
  When ESLint runs on it
  Then rule `security/detect-eval-with-expression` reports an error and the exit code is 1
  And a file without that call exits 0
Scenario: AC-3 The pipeline has every gate
  Then `.github/workflows/ci.yml` runs on push and on pull request
  And it has a job that starts service `postgres:16-alpine` and runs `npm ci`, `npm run typecheck`, `npm run lint` and `npm test`
  And it has a job running `npm audit --audit-level=high`
  And it has a job running `semgrep scan --config p/default --error --metrics=off` in image `semgrep/semgrep:1.178.0`
  And it has a job running `gitleaks detect` in image `zricethezav/gitleaks:v8.30.1`
Scenario: AC-4 The conventions are loaded
  Then `CLAUDE.md` contains the line `@docs/stories/CONVENTIONS.md` exactly once
```

## Abuse cases
```gherkin
Scenario: AB-1 A vulnerable or unlisted dependency reaches main
  When a pull request adds a dependency with a high-severity advisory
  Then the audit job fails and blocks the merge
```

## Implementation
- Create: `.github/workflows/ci.yml`, `tests/unit/tooling/quality-gates.test.ts`, `tests/fixtures/lint/unsafe-eval.ts`, `tests/fixtures/lint/safe.ts`
- Modify: `eslint.config.js`, `package.json`, `CLAUDE.md`
- Pattern: `tests/integration/health.test.ts`
- Dependencies: `eslint-plugin-security`, `eslint`, `vitest`

## Security
- v5.0.0-15.2.1: the audit runs on every push and pull request with `--audit-level=high`.
- v5.0.0-13.4.2: CI never prints environment variables; no secret appears in the workflow file.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| baseline scripts | integration | AC-1 | execSync `npm run typecheck` then `npm run lint` with a 300000 ms timeout → both exit 0 |
| eval is rejected | integration | AC-2 | `npx eslint --no-ignore tests/fixtures/lint/unsafe-eval.ts` → exit 1 and output names `security/detect-eval-with-expression`; `safe.ts` → exit 0 |
| pipeline gates | unit | AC-3, AB-1 | read `ci.yml` as text → contains `postgres:16-alpine`, `npm audit --audit-level=high`, `semgrep/semgrep:1.178.0`, `zricethezav/gitleaks:v8.30.1`, `pull_request` |
| conventions loaded | unit | AC-4 | read `CLAUDE.md` → the line `@docs/stories/CONVENTIONS.md` appears once |

Command: `npx vitest run tests/unit/tooling/quality-gates.test.ts`

## Out of scope
- Fixing lint errors in more than 15 files: set the story to blocked with the count.
- Remediation of the in-memory global rate limiter in `src/app.ts` (approval pending in PROJECT_PROFILE.md).
