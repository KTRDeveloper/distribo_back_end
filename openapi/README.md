# OpenAPI Specification

`openapi.json` in this folder is **generated**, not hand-written. It is produced directly from the
Zod schemas that already validate every endpoint at runtime (see `src/lib/openapi/` and each
module's `*.openapi.ts` file), so it cannot drift from the actual request/response shapes the way a
hand-maintained spec could.

## Regenerating

```bash
npm run openapi:generate
```

Run this after adding or changing an endpoint, and commit the updated file.

## Browsing it live

The same document is also served live, with an interactive "try it out" UI, at `/docs` (and
`/docs/openapi.json`) when the server is running outside production — see
`src/modules/api-docs/`.
