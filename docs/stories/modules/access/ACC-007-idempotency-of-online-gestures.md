---
id: ACC-007
title: Idempotency of online gestures
module: access
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [ACC-006, FND-005, FND-002, PER-002]
read_first: [docs/stories/modules/foundation/contracts.md, src/middleware/auth.ts]
design_refs: [acces-et-securite/la-couche-d-acces-et-la-table-des-regles, contraintes-a-poser-au-niveau-base-de]
constraints: [C-38]
asvs: [v5.0.0-2.3.3, v5.0.0-2.3.4]
---

# ACC-007 — Idempotency of online gestures

## Story
Technical story: make an online gesture that arrives twice count once, so that a lost response and a retry never move money twice.

## Context
- Exists: `uuidV7Schema` (FND-005); `req.user.id` (authMiddleware).
- Adds: table `idempotency_keys` (`person_id` uuid foreign key to `people`, `key` uuid, `status_code` int null, `response_body` jsonb null, `created_at` timestamptz), primary key (`person_id`, `key`); middleware `idempotent()` in `src/middleware/idempotent.ts`; repository `src/modules/access/idempotency.repository.ts` (Q-023).
- The gesture id is `req.body.id`, a UUIDv7 created by the phone. Flow: insert the key with `ON CONFLICT DO NOTHING`; new key: run the handler, store status and body; existing key with a stored response: send it again with header `Idempotent-Replay: true`; existing key without a response yet: 409 `REQUEST_IN_PROGRESS`; a handler that ends with status 500 or higher deletes its key.
- `C-38`: Every online route that changes data carries the client-created id; an id already received changes nothing and returns the first result.

## Acceptance criteria
```gherkin
Scenario: AC-1 First request runs
  When a POST with a new id reaches a guarded route
  Then the handler runs once and the response is stored
Scenario: AC-2 Repeat returns the first response
  When the same person sends the same id again
  Then the handler does not run, the status and body equal the first response, and header `Idempotent-Replay: true` is set
Scenario: AC-3 Same id, other person
  When another person sends the same id
  Then the handler runs for that person
Scenario: AC-4 Two at once
  When two requests with one id arrive together
  Then the handler runs once and the other answers 409 `REQUEST_IN_PROGRESS` or the stored response
Scenario Outline: AC-5 Invalid id
  When the body id is <id>
  Then the response is 400 `VALIDATION_ERROR`
  Examples:
    | id                |
    | missing           |
    | 123               |
    | a UUIDv4          |
Scenario: AC-6 Failure can be retried
  When the handler ends with a 500
  Then the key is removed and a retry runs the handler again
```

## Abuse cases
```gherkin
Scenario: AB-1 Double spend by retry (tampering)
  When a refund request is sent twice with one id
  Then the side effect happens once and both responses are equal
Scenario: AB-2 Replaying another person's response (information disclosure)
  When person B sends an id used by person A
  Then B never receives A's stored response
```

## Implementation
- Create: `src/middleware/idempotent.ts`, `src/modules/access/idempotency.repository.ts`, `prisma/migrations/<timestamp>_acc_007_idempotency_keys/migration.sql`, `tests/integration/access/idempotent.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `src/modules/tasks/tasks.repository.ts`
- Signatures:
  - `idempotent(): RequestHandler`
- Types:
  - `IdempotencyRecord = { personId: string; key: string; statusCode: number | null; responseBody: unknown | null }`
- Errors: `VALIDATION_ERROR` 400, `REQUEST_IN_PROGRESS` 409
- Dependencies: `express`, `@prisma/client`, `zod`

## Security
- v5.0.0-2.3.3: the key insert and the conflict check are one SQL statement.
- v5.0.0-2.3.4: the primary key (person id, key) decides who runs when two requests race.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| first runs | integration | AC-1, C-38 | new id → handler count 1, row with status stored |
| repeat replays | integration | AC-2, C-38 | same id → handler count still 1, equal body, replay header |
| other person | integration | AC-3 | same id, person B → handler runs |
| concurrent | integration | AC-4 | two parallel calls → handler count 1 |
| invalid id | integration | AC-5 | each Examples row → 400 |
| retry after 500 | integration | AC-6 | 500 then retry → handler runs twice, key removed after the first |
| double spend | security | AB-1, CWE-362 | two refund posts → one side effect |
| no cross-person replay | security | AB-2, CWE-639 | B gets a fresh run, never A's body |

Command: `npx vitest run tests/integration/access/idempotent.test.ts`

## Out of scope
- The 30-day purge of old keys (PRIV module).
- Sync pushes, which are idempotent by record id (SYNC module).
