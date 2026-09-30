---
id: AUTH-026
title: Drop the bcrypt dependency
module: auth
kind: technical
rev: 1
amends: []
size: XS
risk: low
depends_on: [AUTH-002, AUTH-005, PER-002]
read_first: [package.json]
design_refs: [identite-et-organisation/person]
constraints: []
asvs: [v5.0.0-15.2.1, v5.0.0-11.4.2]
---

# AUTH-026 — Drop the bcrypt dependency

## Story
Technical story: remove `bcrypt` and its types, now that codes and passwords use Argon2id, so that only one hashing library remains.

## Context
- Exists: `bcrypt` and `@types/bcrypt` in `package.json`; every use was replaced by `argon2` (AUTH-002, AUTH-005, PER-002, PER-001).
- Changes: `package.json` and the lockfile lose both packages.

## Acceptance criteria
```gherkin
Scenario: AC-1 No bcrypt left
  When the source, tests and scripts are searched for `bcrypt`
  Then nothing is found and `package.json` does not list it
Scenario: AC-2 Build and suite pass
  When `npm ci`, `npm run typecheck` and `npm test` run
  Then all succeed
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/unit/tooling/no-bcrypt.test.ts`
- Modify: `package.json`
- Pattern: `tests/unit/tooling/quality-gates.test.ts`
- Dependencies: none added

## Security
- v5.0.0-15.2.1: one hashing library, fewer components to audit.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| no bcrypt | unit | AC-1 | read package.json and grep `src`, `tests`, `scripts` → no `bcrypt` |
| build and suite | unit | AC-2 | `npm run typecheck` exits 0 |

Command: `npx vitest run tests/unit/tooling/no-bcrypt.test.ts`

## Out of scope
- Any other dependency.
