---
id: FND-007
title: Stop Prisma from logging queries
module: foundation
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [FND-000]
read_first: [src/lib/db.ts]
design_refs: [donnees-personnelles-et-conservation/cadre-juridique-le-cameroun]
constraints: []
asvs: [v5.0.0-16.2.5]
---

# FND-007 — Stop Prisma from logging queries

## Story
Technical story: log only Prisma errors and warnings, so that phone numbers and other personal data in query text never reach the logs.

## Context
- Exists: `src/lib/db.ts` builds the client with `log` entries for `query`, `error` and `warn`, all to stdout.
- Changes: the `query` entry is removed.

## Acceptance criteria
```gherkin
Scenario: AC-1 No query logging
  When the Prisma client is constructed
  Then its `log` option contains `error` and `warn` and does not contain `query` or `info`
```

## Abuse cases
```gherkin
Scenario: AB-1 Personal data in logs (information disclosure)
  When a query with a phone number parameter runs
  Then no log line contains that number
```

## Implementation
- Create: `tests/unit/db-log-config.test.ts`
- Modify: `src/lib/db.ts`
- Pattern: `tests/unit/db.test.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-16.2.5: log configuration excludes query text.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| log config | unit | AC-1 | mock `@prisma/client`, import `src/lib/db.ts` → constructor options `log` has error and warn, no query |
| no number in logs | security | AB-1, CWE-532 | run one query with a fake phone while capturing stdout → the number is absent |

Command: `npx vitest run tests/unit/db-log-config.test.ts tests/unit/db.test.ts`

## Out of scope
- Other logging changes.
