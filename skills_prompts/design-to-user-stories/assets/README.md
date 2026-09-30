# Stories: {{name}}

Specifications generated from `{{design}}` by design-to-user-stories. One story = one change = one fresh agent session.

## Hand one story to the agent
1. Pick the first entry under "Next implementable" in `STORY_MAP.md` (full order: `_meta/order.md`).
2. Start a fresh session of {{agent}} at the project root. CLAUDE.md imports `{{out}}/CONVENTIONS.md` once FND-000 is done.
3. Prompt: "Implement exactly one user story: `<story path>`. Follow CONVENTIONS.md. Update only your line in STATUS.md. Finish with the test output."
4. Pass only that path: the story names every file the agent needs.
5. When the session ends, read the story's line in `STATUS.md`:
   - done: commit as `<ID>: <title>`;
   - in_progress with "ready for review" (risk: high): review the diff yourself or with a stronger model, then set done and your name as reviewer;
   - blocked: read the note, fix the cause, set it back to todo.
6. Never edit story files by hand. Change the design (or answer in `OPEN_QUESTIONS.md`), then rerun the skill.

## Files
- `STORY_MAP.md` dashboard · `STATUS.md` state · `CONVENTIONS.md` rules for the agent
- `OPEN_QUESTIONS.md` gaps to answer · `decisions/` ADRs · `modules/` specs · `_meta/` machine files
