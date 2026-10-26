# ADR-007: Waiver of the zod advisory GHSA-mrhx-c7xc-m3w5

Status: accepted (2026-10-26)

## Context
`npm audit` reports `zod` 3.25.76 and `@asteasolutions/zod-to-openapi` 7.3.4 (which depends on it) as high: validating an oversized collection that has constraints can exhaust memory (GHSA-mrhx-c7xc-m3w5). The fix exists only from zod 4.6.6, which needs zod-to-openapi 9.x. CONVENTIONS.md pins both packages, and zod 4 is a breaking change that touches about 48 files (UUID strictness, renamed issue codes in the error handler, `z.record`, `.default` with `.transform`, regenerated OpenAPI document). Three stories (BIL-035, BIL-038, ORG-036) were blocked on the audit gate only; their tests pass.

## Decision
Accept the risk for this advisory only, and keep the audit gate for everything else.
- `npm run audit` (`scripts/audit.mjs`) replaces `npm audit --audit-level=high` in CI and in the Definition of Done. It fails on any high or critical advisory except the ones listed in its `WAIVED` table.
- `WAIVED` holds this advisory and nothing else. Adding an entry needs a new ADR.
- Migrating to zod 4 stays a separate project, to be planned as its own stories.

## Why the risk is acceptable now
- JSON bodies are capped at 100 kb (5 MB on `/api/v1/sync/push`), which bounds the size of any collection a request can carry.
- Request arrays carry explicit `.max()` limits, except `migrateRequestSchema.mappings` (remote-config), which the body cap alone bounds.
- The advisory is a memory exhaustion, not data exposure or code execution.

## Consequences
- The audit stays red for every other high or critical advisory, including a new advisory on zod.
- Review this ADR when zod 4 is adopted or when the 100 kb or 5 MB body limits change; then remove the `WAIVED` entry.
- Open point: add a `.max()` to `migrateRequestSchema.mappings`.
