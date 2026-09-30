Use skill-creator to update the existing skill `design-to-user-stories` (keep its name).
This is phase 2 of 3: add SYNC mode, for when the design changes after INIT. Phase 1 passes its evals: keep its behavior unchanged.
I attach the packaged skill, fixture-b.zip (the output of phase-1 eval (b)) and the design files.

# Part A — Build notes
- Add references/sync.md. SKILL.md only gains the SYNC route and stays ≤ 200 lines. Bump the version in metadata.
- Add a new script, diff_design.py. Extend build_backlog.py and validate.py. Unit-test every change, with the same quality bar as phase 1.

Evals, each starting from a fresh copy of fixture-b (set statuses in STATUS.md as needed):
(e) formatting-only edits plus a typo fix → no story file changes.
(f) a tightened constraint touching one done story and one todo story →
    - the todo story is edited in place, with rev bumped;
    - the done story gets a change story with an audit-and-backfill step;
    - no other story file changes.
(g) a new entity → new stories in an existing module with the next free IDs, or a proposed ADR if it has no clear owner.
(h) a renamed heading → handled by diff_design.py as a rename: design_refs updated, no model edit, no new story.
(i) the same sync run twice → the second run changes nothing.
(j) the changes of (f) and (g) together, stopped after the first applied change, then run again → same final state as an uninterrupted run.

Assertions, as scripts:
- validate.py passes;
- every file outside the expected set is byte-identical to the fixture;
- the run opened only impacted story files (check the transcript);
- Pending changes is empty at the end.

Optional, with subagents: have the target agent implement the change story from (f) on top of the implemented original.
At the end, give me the packaged skill.

# Part B — Runtime behavior (references/sync.md)

## Additional invariants
- A sync creates new stories and edits only the stories reported as impacted. Every other story file stays byte-identical.
- Idempotence: a second sync on the same design changes nothing.
- Done stories are never edited.
  Why: they describe shipped code; editing them would make the backlog describe behavior the code doesn't have.
- Modules and entity ownership change only through an accepted ADR.
  Why: stable modules keep every existing story valid.
- Manual edits survive. If a story's hash differs from the index, a human edited it:
  - edit only the impacted sections;
  - never touch content between `<!-- manual -->` and `<!-- /manual -->`;
  - report conflicts instead of overwriting.
- Template changes apply only to new or edited stories. Reformatting existing stories, or moving to a new ASVS version, requires an explicit command.
- MODULE.md, contracts.md and model.md always describe the current design; stories are the history of changes. read_first never points to a done story.

## SYNC workflow
1. Run check_input.py. If the design path differs from the one in STORY_MAP.md, confirm it is the same design, moved or renamed. In --non-interactive, continue only if most anchors match the baseline; otherwise stop.
2. Run diff_design.py. It diffs the design against the baseline at element level, after normalizing formatting. The baseline is the git commit recorded in STORY_MAP.md, or _meta/baseline/ without git.
   - It applies mechanical changes itself: formatting-only edits, renames and moves (re-baseline and update design_refs).
   - It writes the remaining semantic changes into the Pending changes section of STORY_MAP.md: kind, element, new line range, impacted stories with their status.
   - If nothing semantic is left, report "in sync" and stop.
3. Read STORY_MAP.md first. Then open only the listed design ranges, the impacted story files and the affected module files. Never open unaffected stories, the full design or _meta/index.json.
4. Pending changes are a journal: check off each item as soon as it is applied, so an interrupted run resumes where it stopped.
5. Triage each change:
   - wording change that affects no story → no edit;
   - clarification → targeted wording edits in todo stories;
   - behavioral or constraint change → status rules below;
   - new element → assign it to its owning module and create stories with the next free IDs, through render_stories.py;
   - removed element → status rules below;
   - cross-cutting change (stack, conventions) → edit CONVENTIONS.md, plus a technical story if shipped code must change.
   Update the module files to the new design. Close the open questions the design now answers, and log new gaps.
6. Status rules, reading STATUS.md:
   - todo: targeted in-place edits, bump rev, keep ID and scope. If the story would exceed its budget, add a follow-up story instead of re-splitting.
   - in_progress or blocked: do not edit. Create a change story (`amends: <ID>`) and flag it in the summary.
   - done: create a change story (`kind: change`, `amends: <ID>`) with a "Tests to update" section: existing test, reason, new expectation.
   - removed from the design: if todo, mark it obsolete in STATUS.md (file and ID kept); if done, write a removal story that deletes code, tests and data safely.
7. Data-model changes on shipped code follow expand / migrate / contract (Parallel Change). Migration stories are risk: high.
   - additive → one migration story;
   - tightening (new NOT NULL, UNIQUE, CHECK or FK; narrower length or range) → audit and backfill existing data before enforcing, since the migration fails on existing rows otherwise;
   - rename, type change or split → separate expand, migrate and contract stories;
   - removal → remove usages first, then drop.
8. If sensitive data or a trust boundary changed, re-assess only that module's risk. A higher ASVS level becomes an ADR proposal plus security change stories.
9. Modules stay frozen. Propose a restructuring only when an objective trigger fires, as a `proposed` ADR (context, options, consequences, impacted stories, migration cost). Triggers:
   - a new entity has no clear owner;
   - a dependency cycle appears between modules;
   - a module exceeds 8 entities or 25 active stories (defaults);
   - a module now mixes data that requires different ASVS levels;
   - the design merges or splits domain concepts, or more than ~30% of its elements changed.
   Never apply a proposal before its ADR is accepted. Meanwhile, place new work in the least disruptive module.
10. Run build_backlog.py, then validate.py. Fix only what is reported.
11. Summary in the user's language: changes by kind; stories created, edited and obsoleted; in-progress or blocked stories flagged; pending proposals.

## Options
- --plan: print the change plan (diff_design.py --print); write nothing.
- --rebaseline: a full re-decomposition, only when I explicitly ask. Record it as an ADR.

## Script changes
- diff_design.py: as described above. `--check` exits non-zero when the stories are out of sync, for CI or a pre-commit hook.
- build_backlog.py: clears Pending changes once every item is checked off, re-baselines, and refreshes story hashes in the index.
- validate.py adds these checks:
  - permanent IDs: none missing vs the previous index;
  - non-impacted and done stories are byte-identical;
  - ownership is unchanged without an accepted ADR;
  - every `amends` target exists;
  - module health warnings: size, cycles, mixed ASVS levels.
