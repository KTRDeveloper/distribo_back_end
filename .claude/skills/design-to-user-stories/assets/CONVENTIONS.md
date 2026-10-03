# Conventions: {{name}}

Every story assumes this file; stories never restate it. If a story contradicts it, or anything is ambiguous, stop and ask instead of guessing.

## Stack
{{stack}}

## Commands
| purpose | command |
|---|---|
{{commands}}

## Layout and naming
{{layout}}

## Errors (fail closed)
- [error-shape] One error shape: `{"error": {"code": "UPPER_SNAKE_CASE", "message": "safe text"}}`; validation errors add `details` with field paths and rule names, never input values.
- [status-codes] 400 malformed request · 401 not authenticated · 403 not allowed · 404 absent or outside the caller's scope · 409 conflict · 422 validation failed · 429 rate limited · 500 unexpected.
- [not-found-scope] Outside the caller's scope, answer 404, not 403: never confirm that an ID exists.
- [exceptions] Never swallow an exception. Catch only to map it to a coded error or add context, then rethrow; the global handler logs the rest and returns a generic 500.
- [fail-closed] Fail closed: a failed check, a missing permission or an unexpected state aborts the operation. Writes that belong together run in one transaction.
{{errors}}

## Logging
- [structured-logs] Structured JSON through the shared logger only; no console output in production code.
- [log-fields] Each entry carries the actor ID, the event, the route or job and a request ID; timestamps in UTC.
{{logging}}

## Validation and output encoding
- [strict-input] Validate every input at the boundary (body, params, query, headers read) with a strict schema: unknown fields are rejected.
- [model-limits] Lengths, ranges, formats and enum values come from the module's `model.md`; the database enforces the same constraints.
- [explicit-output] Build responses from an explicit list of fields; never serialize a whole database row.
{{validation}}

## Secrets
- [env-secrets] Secrets come only from environment variables, validated once at startup by the config module; a missing one stops the app.
- [no-hardcoded-secrets] Never hard-code, commit or log a secret. `.env` is git-ignored; `.env.example` lists every variable with a placeholder.
- [fake-adapters] Tests set fake values. Third-party services sit behind a port with a fake adapter, so no story needs real credentials or sandbox access.
{{secrets}}

## Migrations
- [one-migration] One migration per schema change, created with the migration command; a merged migration is never edited.
- [expand-contract] Renames, type changes and tightening (new NOT NULL, UNIQUE, CHECK, FK) follow expand / migrate / contract, with a backfill before enforcement.
- [raw-sql] Constraints the ORM cannot express (CHECK, partial unique indexes, generated columns, grants) go in a raw SQL migration next to the schema.
{{migrations}}

## Dependencies and URLs
Only these packages, at exactly these versions; any other package is forbidden: stop and ask (models invent package names, and attackers register them). Install with exact versions and commit the lockfile.
{{dependencies}}

Allowed URLs; code and stories reference no other:
{{urls}}

## Security baseline (ASVS {{asvs_level}})
- [queries] Queries are parameterized, through the ORM or query builder; no SQL built from strings (v5.0.0-1.2.4). Output is encoded for its context (v5.0.0-1.2.1).
- [authorization] Deny by default: every route declares public, authenticated or its allowed roles. The server checks the role and the object's owner or tenant on every request, from the authenticated identity, never from IDs sent by the client (v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-8.3.1). Writable fields are listed per operation (v5.0.0-15.3.3).
- [passwords] Passwords are hashed with Argon2id per the OWASP Password Storage Cheat Sheet (at least m=19 MiB, t=2, p=1); 8 to at least 64 characters, no composition rules, common or breached passwords rejected, verified exactly as typed (v5.0.0-6.2.1, v5.0.0-6.2.4, v5.0.0-6.2.5, v5.0.0-6.2.8, v5.0.0-6.2.9, v5.0.0-11.4.2).
- [tokens] Token signatures are verified against an algorithm allowlist; expiry, type and audience are checked (v5.0.0-9.1.1, v5.0.0-9.1.2, v5.0.0-9.2.1). Login issues new tokens; logout and revocation take effect on the server (v5.0.0-7.2.4, v5.0.0-7.4.1). Refresh or reference tokens are 128-bit random values stored hashed (v5.0.0-7.2.3).
- [rate-limit] Login, code and reset endpoints are rate limited per account and per IP (v5.0.0-6.3.1, v5.0.0-2.4.1).
- [input-size] Request bodies, strings, arrays and files have explicit maximums (v5.0.0-2.2.1, v5.0.0-5.2.1).
- [security-logging] Security events are logged (authentication success and failure, access denied, rate-limit hits, token revocation) without secrets, tokens, codes, passwords or personal data: log IDs instead (v5.0.0-16.3.1, v5.0.0-16.3.2, v5.0.0-16.2.5).
{{baseline}}

## Project rules
{{rules}}

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
