# Conventions: Distribo back end

Every story assumes this file; stories never restate it. If a story contradicts it, or anything is ambiguous, stop and ask instead of guessing.

## Stack
- Node.js 22, TypeScript 5.9.3 strict (ES2022, NodeNext), Express 5.1.0
- PostgreSQL 16, Prisma 7.10.0 with @prisma/adapter-pg
- Zod 3.25.76, Pino 10.1.0, Vitest 4.0.9 with Supertest 7.1.4
- Redis (ioredis 5.8.2) and BullMQ 5.63.2 for queues and rate limits

## Commands
| purpose | command |
|---|---|
| install | `npm ci` |
| lint | `npm run lint` |
| typecheck | `npm run typecheck` |
| test one file | `npx vitest run <test-file>` |
| full suite | `npm test` |
| dependency audit | `npm audit --audit-level=high` |
| test database | `npm run test:db:up` |
| new migration | `npx prisma migrate dev --name <name>` |

## Layout and naming
- `src/app.ts` mounts every router under `/api/v1`; `src/config/env.ts` validates the environment.
- `src/modules/<module>/`: `<module>.routes.ts` (router and handlers: parse with the Zod schema, call the service, send JSON), `.service.ts`, `.repository.ts` (the only file that calls `prisma`), `.schemas.ts`, `.openapi.ts` (imported in `src/app.ts`). Existing modules keep their `.controller.ts`.
- A module imports another only through the functions in its `contracts.md`. Shared code without Node-only imports: `src/shared/`; helpers: `src/lib/`; middleware: `src/middleware/`.
- Tests: `tests/unit/<area>/<name>.test.ts`, `tests/integration/<module>/<name>.test.ts`, helpers in `tests/helpers/`; integration tests import `prisma` from `tests/setup.ts` (real PostgreSQL).
- `prisma/schema.prisma`, `prisma/migrations/`.
- Files kebab-case; columns in snake_case through `@map`. Money: integer XAF `bigint`. Quantities: `numeric(12,3)`, integer thousandths in code. IDs: UUIDv7. Timestamps: `timestamptz`.

## Errors (fail closed)
- One error shape: `{"error": {"code": "UPPER_SNAKE_CASE", "message": "safe text"}}`; validation errors add `details` with field paths and rule names, never input values.
- 400 malformed request · 401 not authenticated · 403 not allowed · 404 absent or outside the caller's scope · 409 conflict · 422 validation failed · 429 rate limited · 500 unexpected.
- Outside the caller's scope, answer 404, not 403: never confirm that an ID exists.
- Never swallow an exception. Catch only to map it to a coded error or add context, then rethrow; the global handler logs the rest and returns a generic 500.
- Fail closed: a failed check, a missing permission or an unexpected state aborts the operation. Writes that belong together run in one transaction.
- Raise errors with `httpError(status, code, message)` (FND-006); the global handler adds `requestId`. Codes: 400 `VALIDATION_ERROR` for a failed schema validation (here 400, not 422), 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`.

## Logging
- Structured JSON through the shared logger only; no console output in production code.
- Each entry carries the actor ID, the event, the route or job and a request ID; timestamps in UTC.
- Log with the Pino `logger`, object first; ids only, never phones, emails, names or amounts. Security events: `warn`, a fixed `event` name and the person id.

## Validation and output encoding
- Validate every input at the boundary (body, params, query, headers read) with a strict schema: unknown fields are rejected.
- Lengths, ranges, formats and enum values come from the module's `model.md`; the database enforces the same constraints.
- Build responses from an explicit list of fields; never serialize a whole database row.
- Schemas are Zod, applied before any database call; phones go through `normalizeE164` (FND-004). Person, organization and role come from the session.

## Secrets
- Secrets come only from environment variables, validated once at startup by the config module; a missing one stops the app.
- Never hard-code, commit or log a secret. `.env` is git-ignored; `.env.example` lists every variable with a placeholder.
- Tests set fake values. Third-party services sit behind a port with a fake adapter, so no story needs real credentials or sandbox access.

## Migrations
- One migration per schema change, created with the migration command; a merged migration is never edited.
- Renames, type changes and tightening (new NOT NULL, UNIQUE, CHECK, FK) follow expand / migrate / contract, with a backfill before enforcement.
- Constraints the ORM cannot express (CHECK, partial unique indexes, generated columns, grants) go in a raw SQL migration next to the schema.
- One Prisma migration per schema-changing story, named after its ID; its CHECK, partial unique index, generated column or GRANT goes in that migration's SQL.

## Dependencies and URLs
Only these packages, at exactly these versions; any other package is forbidden: stop and ask (models invent package names, and attackers register them). Install with exact versions and commit the lockfile.
- Runtime: `@asteasolutions/zod-to-openapi@7.3.4`, `@casl/ability@7.0.1`, `@prisma/client@7.10.0`, `argon2@0.45.1`, `bullmq@5.63.2`, `express@5.1.0`, `express-rate-limit@8.2.1`, `ioredis@5.8.2`, `jsonwebtoken@9.0.2`, `libphonenumber-js@1.13.14`, `otplib@13.5.0`, `pg@8.23.0`, `pino@10.1.0`, `prom-client@15.1.3`, `uuid@14.0.2`, `zod@3.25.76`, `@prisma/adapter-pg@7.10.0`
- Dev: `@types/express@5.0.5`, `@types/jsonwebtoken@9.0.10`, `@types/node@22.19.1`, `@types/pg@8.23.1`, `@types/supertest@6.0.3`, `@vitest/coverage-v8@4.0.9`, `eslint@9.39.1`, `eslint-plugin-security@3.0.1`, `prettier@3.6.2`, `prisma@7.10.0`, `supertest@7.1.4`, `tsx@4.20.6`, `typescript@5.9.3`, `vitest@4.0.9`
- Ci: `actions/checkout@v7`, `actions/setup-node@v7`, `semgrep/semgrep@1.178.0`, `zricethezav/gitleaks@v8.30.1`, `postgres@16-alpine`

Allowed URLs; code and stories reference no other:
- http://localhost:3000

## Security baseline (ASVS L2)
- Queries are parameterized, through the ORM or query builder; no SQL built from strings (v5.0.0-1.2.4). Output is encoded for its context (v5.0.0-1.2.1).
- Deny by default: every route declares public, authenticated or its allowed roles. The server checks the role and the object's owner or tenant on every request, from the authenticated identity, never from IDs sent by the client (v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-8.3.1). Writable fields are listed per operation (v5.0.0-15.3.3).
- Passwords are hashed with Argon2id per the OWASP Password Storage Cheat Sheet (at least m=19 MiB, t=2, p=1); 8 to at least 64 characters, no composition rules, common or breached passwords rejected, verified exactly as typed (v5.0.0-6.2.1, v5.0.0-6.2.4, v5.0.0-6.2.5, v5.0.0-6.2.8, v5.0.0-6.2.9, v5.0.0-11.4.2).
- Token signatures are verified against an algorithm allowlist; expiry, type and audience are checked (v5.0.0-9.1.1, v5.0.0-9.1.2, v5.0.0-9.2.1). Login issues new tokens; logout and revocation take effect on the server (v5.0.0-7.2.4, v5.0.0-7.4.1). Refresh or reference tokens are 128-bit random values stored hashed (v5.0.0-7.2.3).
- Login, code and reset endpoints are rate limited per account and per IP (v5.0.0-6.3.1, v5.0.0-2.4.1).
- Request bodies, strings, arrays and files have explicit maximums (v5.0.0-2.2.1, v5.0.0-5.2.1).
- Security events are logged (authentication success and failure, access denied, rate-limit hits, token revocation) without secrets, tokens, codes, passwords or personal data: log IDs instead (v5.0.0-16.3.1, v5.0.0-16.3.2, v5.0.0-16.2.5).
- v5.0.0-9.2.1: access token: JWT HS256, 15 minutes; refresh token: 90 days, replaced at every use.
- v5.0.0-11.4.2: Argon2id through `argon2`; one-time codes are stored only as hashes.
- v5.0.0-8.3.1: the server decides access with the rules table (ACC) and the visibility predicate (REL); a phone's own checks only hide buttons.

## Project rules
- Lists take `limit` (default 50, max 100) and an opaque `cursor`, ordered by `created_at` descending then `id`.
- Every online gesture that changes data carries a client-generated UUIDv7 `id`; a repeat with the same id changes nothing and returns the first response (ACC).
- Immutable tables (LedgerEntry, SyncArchive, PhoneNumberChangeLog, CustomerRelationshipReassignment, CreditLimitChange, AdminAction) are never updated or deleted by the application account.
- Every route is under `/api/v1` and registered in its module's `.openapi.ts`.
- A story that adds a route also adds its own paths to the route lists in `tests/integration/api-docs/catalog.test.ts` and `tests/integration/per-001.test.ts`: these additions count as listed under "Tests to update". Never remove an entry.

## Definition of Done
- The story's tests and the full suite pass.
- Lint, SAST, secret and dependency scans are clean.
- Fixtures contain no real personal data.
- A risk: high story is reviewed by a human or a stronger model before done.
- STATUS.md is updated; docs touched by the story are updated.

## Agent rules
- TDD: write the story's tests, watch them fail, implement the minimum, go green, refactor.
- Never modify, weaken or delete a test unless the story lists it under "Tests to update". Never disable a security check or a lint rule.
- Open only the files the story names. Run the story's tests while iterating, and the full suite once at the end.
- After 3 failed attempts on the same error, set the story to blocked in STATUS.md with a one-line note, and stop.
- If anything is ambiguous, stop and ask; never guess.
- In the stories folder, edit only your story's line in STATUS.md.
- Finish by showing the test output as evidence.
