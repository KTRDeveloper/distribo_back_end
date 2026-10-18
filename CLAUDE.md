<!--
Maintainers: this file loads into every session and every subagent, so keep it
short (official guidance: under 200 lines). HTML comments are stripped before
loading. CONVENTIONS.md is rendered from docs/stories/_meta/src/project.yaml by
the design-to-user-stories skill (render_stories.py --update): edit the YAML,
not the Markdown. tests/unit/tooling/quality-gates.test.ts requires exactly one
import line of CONVENTIONS.md below.
-->
# Distribo back end

@docs/stories/CONVENTIONS.md

## Where things are
- Stories: `docs/stories/`; implement them with `/implement-stories`. Generating or syncing stories: the `design-to-user-stories` skill.
- Design, the source of truth (read-only, about 200 KB): `data-model/modele-donnees-livraisons-v16.md`. Never read it whole: `grep -n` the heading you need, then read only that line range.
- Decisions: `docs/stories/decisions/`.
- Execution reports: `docs/stories/execution-report/<module>.md`, one per module, written only by `/implement-stories` through `.../report.mjs`: its runs first, then each story's agent report (decisions, tests and additions beyond the story).

## Never load these files whole
- `docs/stories/STATUS.md` and `docs/stories/_meta/order.md`: run `node .claude/skills/implement-stories/scripts/select.mjs <selection>` or `.../set-status.mjs <ID> <status> [note]`, or `grep` the one line you need.
- `docs/stories/execution-report/*.md`: `grep -n "begin <ID>"` and read from there to the `end <ID>` line.
- Generated files: `openapi/openapi.json` (`npm run openapi:generate`), `package-lock.json` (`npm ls <package>`), `docs/stories/_meta/*.json`.

## Database rules outside the Prisma schema
- Every constraint or workaround a migration enforces that `prisma/schema.prisma` cannot express (CHECK, partial unique index, trigger, generated column, GRANT, a constraint deliberately left out of `@@unique`/`@@index`) gets a `//` comment above its model in `schema.prisma`: what it enforces, why it is not in the schema, and the migration that holds it.
- Write these comments in plain language a person new to the project understands: the business rule and its consequence for the code, not SQL, regexes or constraint names.
- Changing or removing such a constraint updates that comment in the same change. Read the comments above a model before touching it; never rely on reading the migrations to find these rules.

## Commands for agents
- While iterating: `npx vitest run <test-file>` and `npm run lint -- --quiet` (errors only).
- Once at the end: `npm run typecheck`, `npm run lint`, `npm test` (one dot per test under Claude Code; failures in full).

## Compact instructions
When compacting, keep the story ID in progress, the failing tests with their errors, the files changed and the decisions taken; drop passing test output, file listings and file contents already applied. In an /implement-stories run, keep the PLAN lines not yet run and each finished story's status with its commit or stash.
