# SYNC workflow

For a backlog made by INIT whose design changed: check_input.py printed `mode: SYNC`.
`$SKILL` is the skill directory, `$DESIGN` the design file, `$OUT` the output folder.

Contents: 1 Invariants · 2 Workflow · 3 Triage · 4 Status rules · 5 Data-model changes · 6 Security and modules · 7 Writing the edits · 8 Finish · 9 Options

## 1. Invariants (added to those of SKILL.md; validate.py checks them after a sync)

- A sync creates new stories and edits only the stories a pending change reports as impacted. Every other story file stays byte-identical.
- Idempotence: a second sync on the same design changes nothing.
- Done stories are never edited. Why: they describe shipped code; editing them would make the backlog describe behavior the code doesn't have. The same holds for in_progress and blocked stories, which an agent is working from.
- Modules and entity ownership change only through an accepted ADR. Why: stable modules keep every existing story valid.
- Manual edits survive. A story marked `edited by hand` in Pending changes differs from its hash in the index, so a human edited it: edit only the impacted sections, never touch content between `<!-- manual -->` and `<!-- /manual -->`, and report a conflict (the change and the human text disagree) in the summary instead of overwriting.
- Template changes apply only to new or edited stories. Reformatting existing stories, or moving to a new ASVS version, needs an explicit command from the user.
- MODULE.md, contracts.md and model.md always describe the current design; stories are the history of changes. A todo story's read_first never points to a done story: point to the code, contracts.md or model.md.

## 2. Workflow

1. `check_input.py $DESIGN --out $OUT`. A `design path:` line means the path differs from the one in STORY_MAP.md. Confirm with the user that it is the same design, moved or renamed. With `--non-interactive`, continue only when the line says `likely the same design`; otherwise stop.
2. `run_lock.py acquire --out $OUT --mode sync --design $DESIGN`. A LEFTOVER line means an interrupted sync: say so and go on, since the journal (step 5) says where it stopped.
3. `diff_design.py $DESIGN --out $OUT`. It diffs the design against the baseline element by element, after normalizing formatting, then:
   - applies the mechanical changes itself: formatting-only edits need nothing; renamed or moved headings become index aliases, and todo stories' `design_refs` are rewritten;
   - refreshes `_meta/index.json`, `_meta/constraints.md` (Extracted rows; an edited rule keeps its `C-nn`) and `_meta/model.json`;
   - writes each semantic change to Pending changes in STORY_MAP.md: kind, element, lines in the new design, impacted stories with their status, and `was:` / `now:` excerpts;
   - prints the next free story ID of each module.
   When it prints `in sync`, there is nothing semantic: release the lock, report, and stop.
4. Read STORY_MAP.md first. Then open only what each item needs:
   - design text: the item's line range only, `sed -n '112,121p' $DESIGN`, when the `was:` / `now:` excerpts are not enough; for context around it, the outline from `index_design.py $DESIGN --out $OUT --print`;
   - the impacted story files listed in the item;
   - the affected module's files: MODULE.md, contracts.md, model.md, and the header of `_meta/src/<module>.yaml` (`sed -n '1,/^stories:/p'`).
   Never open the whole design, `_meta/index.json`, or a story no item lists, not even as a style example or to copy a dependency. Why: every unrelated file costs tokens and invites unrelated edits. Use these instead:
   - the shape of a new story: the golden example in `$SKILL/references/examples/` and story-rules.md §8;
   - the pattern file and dependencies of a new story: the module's contracts.md, and `grep -l "Create:.*<path>" $OUT/modules/*/*.md`, which prints the ID of the story that creates a file without opening it (validate.py also reports a missing `depends_on`);
   - the next migration number and the existing test files: `grep -rhoE "(prisma/migrations/[0-9]+_[a-z_]+|tests/[a-z/._-]+)" $OUT/modules | sort -u`; a new story's `read_first` and dependencies come from these greps and contracts.md, and a wrong `depends_on` is reported by validate.py, so a guess costs one fix and opening a sibling story costs more;
   - the stories of the same module: `grep -h "^title:\|^id:" $OUT/modules/<module>/*.md`, or the module's `_meta/src/<module>.yaml` header.
5. Pending changes is a journal. As soon as an item is applied, check it off and append what you did: `- [x] P-1a2b3c4d · … → SHOP-002 rev 2; SHOP-006 created`. An interrupted run then resumes at the first unchecked item. On resume, rerun diff_design.py first (it keeps the checked items); never redo a checked item.
6. Apply each item: triage (§3), then the status rules (§4). Update the module files to the new design (§7). Close the open questions the design now answers (Answers section of OPEN_QUESTIONS.md) and add new gaps as new questions. When the items span several modules, apply them one module at a time, each in a fresh subagent (the brief of init.md §8 plus that module's items), or one module per session: the journal says where to resume.
7. Finish (§8).

## 3. Triage

| change | action |
|---|---|
| wording that changes no rule (`hint: wording`, a clearer sentence) | no story edit; check it off with `→ wording only` |
| clarification (the rule was ambiguous, now it is stated) | targeted wording edits in impacted todo stories |
| behavior or constraint change | status rules (§4), and §5 for the data model |
| new element (entity, field, rule, flow) | give it to its owning module; new stories with the next free IDs, rendered from YAML (§7) |
| removed element | status rules (§4) |
| cross-cutting (stack, conventions, an NFR; `hint: no story cites this section`) | edit `_meta/src/project.yaml` and re-render CONVENTIONS.md with `--update`; add a technical story when shipped code must change |

An item listing `impacts: none` still needs a decision: a new entity or rule needs stories; a section change nobody cites is usually wording or cross-cutting.

A field row and its constraint often change together (two items, same stories): apply them in one edit and check both off.

## 4. Status rules

Read the status of each impacted story from the item (it mirrors STATUS.md).

- todo: targeted in-place edits of the impacted sections only; bump `rev` by one; keep the ID, the file name and the scope. If the edit would push the story over its budget (story-rules.md §1), add a follow-up story (`depends_on` the original) instead of re-splitting.
- in_progress or blocked: do not edit. Create a change story (`kind: change`, `amends: [<ID>]`) and flag it in the summary: the agent working on it must know.
- done: create a change story (`kind: change`, `amends: [<ID>]`) with `tests_to_update` rows `existing test | reason | new expectation`, naming each existing test whose expectation changes.
- removed from the design: if todo, set its STATUS.md line to `obsolete` with a note `removed from the design (<item ID>)`; the file and ID stay. If done, write a removal story (`kind: removal`, `amends: [<ID>]`) that deletes the code, its tests and its data safely (§5 for data).

A change or removal story may cite constraints and anchors the design no longer has (the index `retired` list): that is its history.

## 5. Data-model changes on shipped code

When the changed element has a table whose creating story is done, the database already holds rows. Follow expand / migrate / contract (Parallel Change): each step ships alone and keeps the build green. Migration stories are `kind: migration`, `risk: high`.

- Additive (new table, nullable column, looser rule): one migration story.
- Tightening (new NOT NULL, UNIQUE, CHECK or FK; a narrower length or range): audit and backfill existing data before enforcing, because the migration fails on existing rows otherwise. The story: (1) an audit query counting and listing violating rows; (2) the backfill the design states; (3) the constraint, then its tests. When the design states no backfill rule, never invent one (truncating a name is a product decision): the story stops with a clear error listing the violating rows when the audit finds any, and a new open question asks for the rule.
- Rename, type change or split: separate expand (add the new shape and write both), migrate (backfill), and contract (drop the old shape) stories, chained by `depends_on`.
- Removal: first remove every usage (code and tests), then drop the column or table, in two stories.

Pure todo work (the table's story is still todo) needs none of this: edit the story in place.

## 6. Security and modules

- When sensitive data or a trust boundary changed (a new PII field, a new role, a new external call), re-assess only that module's risk (security.md §3): update its classification and threats in the module YAML, and add abuse cases to the stories that expose the change. If the module now needs a higher ASVS level, write a `proposed` ADR plus the security change stories, rather than raising the level silently.
- Modules stay frozen. Place new work in the least disruptive module: the owner of the entity a new entity references most specifically (the item's `references:` line lists candidates with their owners). Propose a restructuring only when an objective trigger fires, as a `proposed` ADR from `$SKILL/assets/ADR.md` (context, options, consequences, impacted stories, migration cost):
  - a new entity has no clear owner (its references point to several modules equally, or to none);
  - a dependency cycle appears between modules;
  - a module exceeds 8 entities or 25 active stories (`module_health` in defaults.yaml);
  - a module now mixes data that needs different ASVS levels;
  - the design merges or splits domain concepts, or more than about 30% of its elements changed.
  validate.py prints the size, cycle and ASVS-level triggers as warnings. Never apply a proposal before its ADR is accepted; meanwhile, place the work in the least disruptive module, and say so in the summary.

## 7. Writing the edits

- Todo stories: Edit tool, section by section; bump `rev` in the front matter. When a constraint's English text changes, update its line in the story's Context too, and the Examples and test rows that name the old limit.
- New stories (feature, technical, change, migration, removal): YAML, never Markdown by hand. Write them in `$OUT/_meta/src/<module>.sync.yaml` as one document:
  ```yaml
  kind: stories
  module: shops
  constraints: {C-02: "`slug` unique and matches `^[a-z0-9-]{3,40}$`; `name` is 1 to 60 characters"}
  stories: [...]          # story-rules.md §8; change stories add amends and tests_to_update
  ```
  A later sync adds a new document to the same file (`---` separator); rendered stories are skipped, never re-checked. `render_stories.py $OUT/_meta/src/<module>.sync.yaml --out $OUT`. Use the next free IDs that diff_design.py printed.
- Module files: edit only the header of `$OUT/_meta/src/<module>.yaml` (entities, `constraints` English map, contracts, classification, threats), then `render_stories.py $OUT/_meta/src/<module>.yaml --out $OUT --update`. Existing stories in it are skipped, so only MODULE.md, contracts.md and model.md change. Do this before rendering new stories, so they inline the new English rules.
- New domain concept (a new entity or role): add its GLOSSARY row to `glossary` in `$OUT/_meta/src/project.yaml`, then `render_stories.py $OUT/_meta/src/project.yaml --out $OUT --update` (CONVENTIONS.md and README.md stay byte-identical unless the project YAML changed them).
- Obsolete: edit the story's STATUS.md line only.

## 8. Finish

1. `build_backlog.py --out $OUT`. With every item checked, it clears Pending changes, re-baselines, refreshes story hashes and closes `_meta/sync.json`.
2. `validate.py --out $OUT`. Fix only what it reports, and rerun both until OK. It fails when a done, in_progress, blocked or non-impacted story changed, when an in-place edit kept its rev, when a manual block was dropped, and when ownership or the module list changed without an accepted ADR.
3. `run_lock.py release --out $OUT`.
4. Summary in the user's language: changes by kind; stories created, edited (with rev) and obsoleted; change stories for in_progress or blocked stories (flagged: tell whoever works on them); proposed ADRs and other pending decisions; conflicts with manual edits; the next implementable stories; a reminder to commit.

## 9. Options

- `--plan`: run `diff_design.py $DESIGN --out $OUT --print`, say per item what you would do (§3, §4), and stop. Write nothing, take no lock.
- `--non-interactive`: never wait. Proposals stay `proposed` ADRs; a path mismatch continues only when likely the same design.
- `--rebaseline`: a full re-decomposition, only when the user explicitly asks. Record it first as an ADR (why, what is lost, how IDs are kept); existing IDs stay permanent (old stories become obsolete or are amended, never renumbered). Then follow INIT steps 3 to 9 over the existing folder.
- CI: `diff_design.py $DESIGN --out $OUT --check` exits 1 when the stories are out of sync (semantic changes, renames, or an unfinished journal); formatting-only edits pass.
