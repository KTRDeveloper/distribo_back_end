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
- Design, the source of truth (read-only, about 200 KB): `data-model/modele-donnees-livraisons-v10.md`. Never read it whole: `grep -n` the heading you need, then read only that line range.
- Decisions: `docs/stories/decisions/`.

## Never load these files whole
- `docs/stories/STATUS.md` and `docs/stories/_meta/order.md`: run `node .claude/skills/implement-stories/scripts/select.mjs <selection>` or `.../set-status.mjs <ID> <status> [note]`, or `grep` the one line you need.
- Generated files: `openapi/openapi.json` (`npm run openapi:generate`), `package-lock.json` (`npm ls <package>`), `docs/stories/_meta/*.json`.

## Commands for agents
- While iterating: `npx vitest run <test-file>` and `npm run lint -- --quiet` (errors only).
- Once at the end: `npm run typecheck`, `npm run lint`, `npm test` (one dot per test under Claude Code; failures in full).

## Compact instructions
When compacting, keep the story ID in progress, the failing tests with their errors, the files changed and the decisions taken; drop passing test output, file listings and file contents already applied.
