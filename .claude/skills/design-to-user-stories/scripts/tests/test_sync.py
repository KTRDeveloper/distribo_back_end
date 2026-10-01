"""SYNC: diff_design.py, and the SYNC parts of build_backlog.py, validate.py,
render_stories.py, check_input.py and designparse.py."""
import csv
import json
import re
import subprocess
import unittest
from pathlib import Path

import yaml

from helpers import FIXTURES, SCRIPTS, Project, needs_git, run

import build_backlog
import check_input
import diff_design
import render_stories
import validate
from designparse import analyze, render_constraints_md


def rules(analysis) -> dict:
    return {c.id: c.rule for c in analysis.constraints if c.kind == "rule"}


class ConstraintIdTest(unittest.TestCase):
    def setUp(self):
        self.text = (FIXTURES / "design_small.md").read_text()
        first = analyze(self.text)
        self.previous = render_constraints_md(first.constraints, "docs/design.md", None)

    def test_edited_rule_keeps_its_id_and_a_new_rule_gets_the_next(self):
        edited = self.text.replace("`Product.name` : 1 à 120 caractères", "`Product.name` : 1 à 80 caractères")
        edited += "| `Account.email` en minuscules | |\n"
        got = rules(analyze(edited, self.previous))
        self.assertEqual(got["C-02"], "`Product.name` : 1 à 80 caractères")
        self.assertEqual(got["C-01"], "`Product.price > 0`")
        self.assertEqual(got["C-03"], "`Account.email` en minuscules")

    def test_unrelated_rewrite_is_a_new_rule(self):
        edited = self.text.replace("`Product.name` : 1 à 120 caractères", "`Account.role` jamais modifié par son titulaire")
        got = rules(analyze(edited, self.previous))
        self.assertNotIn("C-02", got)
        self.assertEqual(got["C-03"], "`Account.role` jamais modifié par son titulaire")

    def test_ids_by_hash_win(self):
        row = next(c for c in analyze(self.text).constraints if c.id == "C-02")
        got = rules(analyze(self.text, None, {row.hash: "C-07"}))
        self.assertEqual(got["C-07"], "`Product.name` : 1 à 120 caractères")
        self.assertEqual(sorted(got), ["C-07", "C-08"], "unknown rows number after the highest known ID")


class SyncCase(unittest.TestCase):
    """A built fixture project, with helpers to edit the design and run a sync."""

    def setUp(self):
        self.p = Project().build()
        self.stories = self.p.out

    def tearDown(self):
        self.p.close()

    def edit_design(self, old, new):
        text = self.p.design.read_text()
        self.assertIn(old, text)
        self.p.design.write_text(text.replace(old, new, 1))

    def diff(self, *args):
        return run(diff_design.main, str(self.p.design), "--out", str(self.stories), *args)

    def backlog(self, date="2026-02-01"):
        return run(build_backlog.main, "--out", str(self.stories), "--date", date)

    def validate(self):
        return run(validate.main, "--out", str(self.stories))

    def set_status(self, sid, status):
        path = self.stories / "STATUS.md"
        text = path.read_text()
        path.write_text(re.sub(rf"^\| {sid} \| \w+ \|", f"| {sid} | {status} |", text, flags=re.M))

    def story_map(self):
        return (self.stories / "STORY_MAP.md").read_text()

    def sync_json(self):
        return json.loads((self.stories / "_meta" / "sync.json").read_text())

    def check_off(self, note="done"):
        path = self.stories / "STORY_MAP.md"
        path.write_text(re.sub(r"^- \[ \] (P-[0-9a-f]{8} · .*)$", rf"- [x] \1 → {note}", path.read_text(), flags=re.M))

    def edit_story(self, sid, old, new, bump=True):
        path = self.p.story(sid)
        text = path.read_text()
        self.assertIn(old, text)
        text = text.replace(old, new, 1)
        if bump:
            rev = int(re.search(r"^rev: (\d+)$", text, re.M).group(1))
            text = re.sub(r"^rev: \d+$", f"rev: {rev + 1}", text, count=1, flags=re.M)
        path.write_text(text)

    def tighten_c02(self):
        self.edit_design("| `Product.name` : 1 à 120 caractères | |", "| `Product.name` : 1 à 80 caractères | |")


@needs_git
class DiffDesignTest(SyncCase):
    def test_unchanged_design_is_in_sync_and_writes_nothing(self):
        before = self.p.snapshot()
        code, out = self.diff()
        self.assertEqual(code, 0, out)
        self.assertIn("in sync: the design is the baseline", out)
        self.assertEqual(self.p.snapshot(), before)

    def test_print_and_check_write_nothing(self):
        self.tighten_c02()
        before = self.p.snapshot()
        code, out = self.diff("--print")
        self.assertEqual(code, 0, out)
        self.assertIn("constraint changed · C-02", out)
        code, out = self.diff("--check")
        self.assertEqual(code, 1, out)
        self.assertIn("OUT OF SYNC", out)
        self.assertEqual(self.p.snapshot(), before)

    def test_formatting_only_rebaselines_without_touching_stories(self):
        self.edit_design("Texte d'introduction.", "Texte\nd'introduction.")
        self.edit_design("Le vendeur crée ses produits.", "Le vendeur **crée** ses produits.")
        self.edit_design("| name | string | 1 à 120 caractères |", "|  name  |  string  |  1 à 120 caractères  |")
        self.edit_design("|---|---|\n| `Product.price > 0`", "|:--|:--|\n| `Product.price > 0`")
        stories_before = {k: v for k, v in self.p.snapshot().items() if k.startswith("modules/")}
        code, out = self.diff("--check")
        self.assertEqual(code, 0, out)
        code, out = self.diff()
        self.assertEqual(code, 0, out)
        self.assertIn("in sync: formatting only, re-baselined", out)
        after = self.p.snapshot()
        self.assertEqual({k: v for k, v in after.items() if k.startswith("modules/")}, stories_before)
        self.assertEqual(after["_meta/baseline/design.md"], self.p.design.read_bytes())
        self.assertIn("## Pending changes\nNone.", self.story_map())
        self.assertEqual(self.sync_json()["status"], "closed")
        self.assertEqual(self.validate()[0], 0, self.validate()[1])
        code, out = self.diff()
        self.assertIn("nothing to do", out)
        self.assertEqual(self.p.snapshot(), after)

    def test_spelling_fix_gets_a_wording_hint(self):
        self.edit_design("Le vendeur crée ses produits.", "Le vendeur créé ses produits.")
        code, out = self.diff("--print")
        self.assertRegex(out, r"text changed · catalogue/notes · L33 · impacts: none · hint: wording")

    def test_changed_constraint_keeps_its_id_and_lists_impacts_with_status(self):
        self.set_status("CAT-001", "done")
        self.tighten_c02()
        code, out = self.diff()
        self.assertEqual(code, 0, out)
        pending = self.story_map().split("## Pending changes\n", 1)[1]
        self.assertRegex(pending, r"- \[ \] P-[0-9a-f]{8} · constraint changed · C-02 · L49 · impacts: CAT-001 \(done\)")
        self.assertIn("  - was: | `Product.name` : 1 à 120 caractères | |", pending)
        self.assertIn("  - now: | `Product.name` : 1 à 80 caractères | |", pending)
        constraints = (self.stories / "_meta" / "constraints.md").read_text()
        self.assertIn("| C-02 | Product.name | `Product.name` : 1 à 80 caractères |", constraints)
        self.assertNotIn("C-03", constraints)
        sync = self.sync_json()
        self.assertEqual(sync["status"], "open")
        self.assertEqual(sync["impacted"], {"CAT-001": "done"})
        self.assertEqual(sorted(sync["before"]), ["ACC-001", "CAT-001", "FND-000"])
        self.assertEqual(sync["owners"], {"Account": "accounts", "Product": "catalog"})

    def test_changed_field_row_impacts_the_stories_using_it(self):
        self.edit_design("| name | string | 1 à 120 caractères |", "| name | string | 1 à 100 caractères |")
        code, out = self.diff("--print")
        self.assertRegex(out, r"field changed · Product.name · L28 · impacts: CAT-001 \(todo\)")

    def test_rationale_only_edit_is_reported(self):
        self.edit_design("| `Product.price > 0` | Un prix positif |", "| `Product.price > 0` | Un prix strictement positif |")
        code, out = self.diff("--print")
        self.assertIn("constraint changed · C-01 · L48 · impacts: CAT-001 (todo) · hint: only the rationale changed", out)

    def test_rename_rewrites_todo_refs_and_keeps_others_through_an_alias(self):
        src = self.stories / "_meta" / "src"
        src.mkdir(parents=True, exist_ok=True)
        (src / "accounts.yaml").write_text("stories:\n  - id: ACC-001\n    design_refs: [comptes/account, PRD]\n")
        self.edit_design("### 1.1 `Account`", "### 1.1 `Account` (compte)")
        code, out = self.diff("--check")
        self.assertEqual(code, 1, out)
        code, out = self.diff()
        self.assertEqual(code, 0, out)
        self.assertIn("rename: comptes/account -> comptes/account-compte", out)
        self.assertIn("in sync: mechanical changes applied, re-baselined", out)
        self.assertIn("design_refs: [comptes/account-compte]", self.p.story("ACC-001").read_text())
        index = json.loads((self.stories / "_meta" / "index.json").read_text())
        self.assertEqual(index["design"]["aliases"], {"comptes/account": "comptes/account-compte"})
        self.assertEqual(index["stories"]["ACC-001"]["sha256"],
                         diff_design.sha256_file(self.p.story("ACC-001")))
        self.assertIn("`comptes/account-compte`", (self.stories / "modules/accounts/MODULE.md").read_text())
        self.assertIn("design_refs: [comptes/account-compte, PRD]", (self.stories / "_meta/src/accounts.yaml").read_text())
        self.assertEqual(self.sync_json()["mechanical"], {"ACC-001": index["stories"]["ACC-001"]["sha256"]})
        code, out = self.validate()
        self.assertEqual(code, 0, out)

    def test_rename_of_a_done_story_ref_is_an_alias_only(self):
        self.set_status("ACC-001", "done")
        original = self.p.story("ACC-001").read_bytes()
        self.edit_design("## 1. Comptes", "## 1. Comptes utilisateurs")
        code, out = self.diff()
        self.assertIn("rename: comptes -> comptes-utilisateurs", out)
        self.assertIn("rename: comptes/account -> comptes-utilisateurs/account", out)
        self.assertEqual(self.p.story("ACC-001").read_bytes(), original)
        self.assertEqual(self.validate()[0], 0, self.validate()[1])

    def test_new_entity_folds_its_constraints_and_names_candidate_owners(self):
        self.edit_design("## 3. Contraintes", "### 2.2 `Review`\n| Champ | Type | Description |\n|---|---|---|\n"
                         "| id | PK | |\n| product_id | FK → Product | |\n| rating | int | |\n\n## 3. Contraintes")
        text = self.p.design.read_text() + "| `Review.rating` entre 1 et 5 | |\n"
        self.p.design.write_text(text)
        code, out = self.diff("--print")
        self.assertRegex(out, r"entity added · Review · L\d+-\d+ · impacts: none")
        self.assertIn("  - references: Product (catalog)", out)
        self.assertIn("  - constraints: C-03", out)
        self.assertNotIn("constraint added", out)
        self.assertNotIn("section added", out)

    def test_removed_constraint_is_retired_and_history_keeps_validating(self):
        self.set_status("CAT-001", "done")
        self.edit_design("| `Product.price > 0` | Un prix positif |\n", "")
        code, out = self.diff()
        self.assertIn("constraint removed · C-01 · baseline L48 · impacts: CAT-001 (done)", out)
        index = json.loads((self.stories / "_meta" / "index.json").read_text())
        self.assertIn("constraint:C-01", index["design"]["retired"])
        self.check_off("removal story to write")
        self.backlog()
        code, out = self.validate()
        self.assertEqual(code, 0, out)
        self.set_status("CAT-001", "todo")
        code, out = self.validate()
        self.assertIn("unknown constraint C-01", out)

    def test_resume_keeps_checked_items_and_the_first_snapshot(self):
        self.tighten_c02()
        self.edit_design("Le vendeur crée ses produits.", "Le vendeur crée et publie ses produits.")
        self.diff()
        first = self.sync_json()["before"]
        path = self.stories / "STORY_MAP.md"
        text = path.read_text()
        item = re.search(r"^- \[ \] (P-[0-9a-f]{8}) · constraint changed", text, re.M).group(1)
        path.write_text(re.sub(rf"^- \[ \] ({item} · .*)$", r"- [x] \1 → CAT-001 rev 2", text, flags=re.M))
        self.edit_story("CAT-001", "1 to 120", "1 to 80")
        code, out = self.diff()
        self.assertIn("pending: 2 items in STORY_MAP.md (1 to apply)", out)
        self.assertRegex(self.story_map(), rf"- \[x\] {item} · constraint changed · C-02 .* → CAT-001 rev 2")
        self.assertNotIn("edited by hand", self.story_map())
        self.assertEqual(self.sync_json()["before"], first)

    def test_hand_edited_story_and_manual_blocks_are_recorded(self):
        block = "<!-- manual -->\n- Ask the product owner before changing prices.\n<!-- /manual -->"
        self.edit_story("CAT-001", "## Out of scope\n", "## Out of scope\n" + block + "\n", bump=False)
        self.tighten_c02()
        self.diff()
        self.assertIn("impacts: CAT-001 (todo, edited by hand)", self.story_map())
        sync = self.sync_json()
        self.assertEqual(sync["manual"], {"CAT-001": [block]})
        self.assertEqual(sync["hand_edited"], ["CAT-001"])

    def test_git_baseline_is_used_when_a_commit_is_recorded(self):
        def git(*args):
            subprocess.run(["git", "-C", str(self.p.root), "-c", "user.name=t", "-c", "user.email=t@example.com",
                            *args], check=True, capture_output=True)
        git("add", "docs/design.md")
        git("commit", "-q", "-m", "design")
        self.backlog()
        self.assertRegex(self.story_map(), r"commit `[0-9a-f]{40}`")
        (self.stories / "_meta" / "baseline" / "design.md").unlink()
        self.tighten_c02()
        code, out = self.diff("--print")
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"baseline git [0-9a-f]{12}:docs/design.md")
        self.assertIn("constraint changed · C-02", out)


@needs_git
class SyncBacklogValidateTest(SyncCase):
    def open_sync(self, status="todo"):
        self.set_status("CAT-001", status)
        self.tighten_c02()
        code, out = self.diff()
        self.assertEqual(code, 0, out)

    def close(self):
        self.check_off()
        code, out = self.backlog()
        self.assertEqual(code, 0, out)
        return out

    def test_open_sync_keeps_baseline_hash_and_changelog(self):
        old_map = self.story_map()
        baseline = (self.stories / "_meta" / "baseline" / "design.md").read_bytes()
        changelog = (self.stories / "CHANGELOG.md").read_bytes()
        self.open_sync()
        code, out = self.backlog()
        self.assertIn("baseline kept: Pending changes has unchecked items", out)
        design_line = re.search(r"^- Design: .*$", old_map, re.M).group(0)
        self.assertIn(design_line, self.story_map())
        self.assertIn("- [ ] P-", self.story_map())
        self.assertEqual((self.stories / "_meta" / "baseline" / "design.md").read_bytes(), baseline)
        self.assertEqual((self.stories / "CHANGELOG.md").read_bytes(), changelog)
        code, out = self.validate()
        self.assertEqual(code, 1)
        self.assertIn("Pending changes has 1 unchecked items", out)

    def test_closing_clears_the_journal_and_rebaselines(self):
        self.open_sync()
        self.edit_story("CAT-001", "`name` is 1 to 120 characters", "`name` is 1 to 80 characters")
        out = self.close()
        self.assertIn("sync closed", out)
        self.assertIn("## Pending changes\nNone.", self.story_map())
        self.assertEqual((self.stories / "_meta" / "baseline" / "design.md").read_bytes(), self.p.design.read_bytes())
        sync = self.sync_json()
        self.assertEqual((sync["status"], sync["edited"], sync["after"]["CAT-001"]["rev"]), ("closed", ["CAT-001"], 2))
        changelog = (self.stories / "CHANGELOG.md").read_text()
        self.assertIn("## 2026-02-01: sync", changelog)
        self.assertIn("- Stories edited (1): CAT-001", changelog)
        code, out = self.validate()
        self.assertEqual(code, 0, out)
        before = self.p.snapshot()
        self.assertIn("nothing to do", self.diff()[1])
        self.backlog("2026-02-02")
        self.assertEqual(self.p.snapshot(), before)

    def test_in_place_edit_needs_a_rev_bump(self):
        self.open_sync()
        self.edit_story("CAT-001", "`name` is 1 to 120 characters", "`name` is 1 to 80 characters", bump=False)
        self.close()
        self.assertIn("CAT-001 was edited in place: bump rev (was 1)", self.validate()[1])

    def test_frozen_story_edited_by_the_sync_fails(self):
        self.open_sync("done")
        self.edit_story("CAT-001", "`name` is 1 to 120 characters", "`name` is 1 to 80 characters")
        self.close()
        self.assertIn("CAT-001 was done and the sync edited it", self.validate()[1])

    def test_story_not_reported_as_impacted_must_stay_identical(self):
        self.open_sync()
        self.edit_story("ACC-001", "## Out of scope\n", "## Out of scope\n- Password reset.\n")
        self.close()
        self.assertIn("the sync edited ACC-001, which no pending change reported as impacted", self.validate()[1])

    def test_manual_block_must_survive(self):
        block = "<!-- manual -->\n- Ask the product owner before changing prices.\n<!-- /manual -->\n"
        self.edit_story("CAT-001", "## Out of scope\n", "## Out of scope\n" + block, bump=False)
        self.open_sync()
        self.edit_story("CAT-001", block, "")
        self.close()
        self.assertIn("a <!-- manual --> block of CAT-001 was changed or dropped", self.validate()[1])

    def test_lost_story_id_fails(self):
        self.open_sync()
        self.close()
        self.p.story("CAT-001").unlink()
        self.assertIn("CAT-001 existed before the sync and is gone", self.validate()[1])

    def test_ownership_and_new_modules_need_an_accepted_adr(self):
        self.open_sync()
        self.close()
        index_path = self.stories / "_meta" / "index.json"
        index = json.loads(index_path.read_text())
        index["modules"]["catalog"]["entities"] = []
        index["modules"]["accounts"]["entities"] = ["Account", "Product"]
        index["modules"]["reviews"] = {"prefix": "REV", "entities": [], "asvs_level": "L2", "depends_on": []}
        index_path.write_text(json.dumps(index))
        out = self.validate()[1]
        self.assertIn("Product moved from catalog to accounts without an accepted ADR", out)
        self.assertIn("new module reviews without an accepted ADR", out)
        adr = self.stories / "decisions" / "ADR-009-move-product.md"
        adr.parent.mkdir(exist_ok=True)
        adr.write_text("# ADR-009: Move Product\n\nStatus: proposed\n\nMove `Product` to accounts; add `reviews`.\n")
        self.assertIn("without an accepted ADR", self.validate()[1])
        adr.write_text(adr.read_text().replace("Status: proposed", "Status: accepted"))
        self.assertNotIn("without an accepted ADR", self.validate()[1])

    def test_health_warnings_never_fail(self):
        index_path = self.stories / "_meta" / "index.json"
        index = json.loads(index_path.read_text())
        index["modules"]["catalog"]["entities"] = [f"E{i}" for i in range(9)]
        index["modules"]["accounts"]["depends_on"] = ["catalog"]
        index_path.write_text(json.dumps(index))
        code, out = self.validate()
        self.assertEqual(code, 0, out)
        self.assertIn("warning: modules/catalog: 9 entities (> 8)", out)
        self.assertIn("warning: modules: dependency cycle between modules: accounts -> catalog -> accounts", out)

    def test_asvs_level_warning_for_stories_the_sync_touched(self):
        with open(SCRIPTS.parent / "references" / "asvs-5.0.0.csv", encoding="utf-8") as fh:
            l3 = next("v5.0.0-" + r["req_id"][1:] for r in csv.DictReader(fh) if r["L"] == "3")
        self.open_sync()
        self.edit_story("CAT-001", "asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]", f"asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, {l3}]")
        self.close()
        self.assertIn(f"cites {l3} above the module's ASVS L2", self.validate()[1])


@needs_git
class ChangeStoryRulesTest(SyncCase):
    def add_story(self, sid, front_old, front_new, extra=""):
        text = self.p.story("CAT-001").read_text().replace("CAT-001", sid)
        for old, new in zip(front_old, front_new):
            text = text.replace(old, new, 1)
        (self.p.story("CAT-001").parent / f"{sid}-change.md").write_text(text + extra)
        self.backlog()

    def test_change_story_needs_amends_and_tests_to_update_for_done_targets(self):
        self.set_status("CAT-001", "done")
        self.add_story("CAT-002", ["kind: feature"], ["kind: change"])
        self.assertIn("a change story names the story it amends in `amends`", self.validate()[1])
        path = self.p.story("CAT-002")
        path.write_text(path.read_text().replace("amends: []", "amends: [CAT-001]"))
        self.assertIn("a change to a done story needs `tests_to_update`", self.validate()[1])
        path.write_text(path.read_text().replace("amends: [CAT-001]", "amends: [CAT-404]"))
        self.assertIn("references unknown story CAT-404", self.validate()[1])

    def test_todo_story_read_first_never_points_to_a_done_story(self):
        acc = self.p.story("ACC-001").relative_to(self.p.root).as_posix()
        self.edit_story("CAT-001", "read_first: [docs/stories/modules/accounts/contracts.md",
                        f"read_first: [{acc}", bump=False)
        self.assertNotIn("read_first points to done story", self.validate()[1])
        self.set_status("ACC-001", "done")
        self.assertIn("read_first points to done story ACC-001", self.validate()[1])


@needs_git
class RenderSyncTest(SyncCase):
    def catalog_doc(self):
        return yaml.safe_load((FIXTURES / "yaml" / "catalog.yaml").read_text())

    def render(self, doc):
        path = self.p.root / "extra.yaml"
        path.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True))
        return run(render_stories.main, str(path), "--out", str(self.stories), "--update")

    def new_story(self, doc, **changes):
        story = json.loads(json.dumps(doc["stories"][0]))
        story.update({"id": "CAT-002", "title": "Seller renames a product"}, **changes)
        story["implementation"] = dict(story["implementation"], create=["tests/catalog/product.rename.test.ts"],
                                       modify=["src/modules/catalog/product.routes.ts"])
        story["depends_on"] = ["CAT-001"]
        return story

    def test_existing_stories_are_skipped_so_new_ones_can_be_appended(self):
        doc = self.catalog_doc()
        doc["stories"].append(self.new_story(doc))
        doc["stories"][0]["design_refs"] = ["gone-anchor"]
        code, out = self.render(doc)
        self.assertEqual(code, 0, out)
        self.assertIn("exists (kept, never overwritten) modules/catalog/CAT-001", out)
        self.assertIn("created modules/catalog/CAT-002-seller-renames-a-product.md", out)

    def test_stories_document_renders_story_files_only(self):
        doc = self.catalog_doc()
        extra = {"kind": "stories", "module": "catalog", "stories": [self.new_story(doc)]}
        module_md = (self.stories / "modules/catalog/MODULE.md").read_bytes()
        code, out = self.render(extra)
        self.assertEqual(code, 0, out)
        self.assertIn("created modules/catalog/CAT-002-seller-renames-a-product.md", out)
        self.assertEqual((self.stories / "modules/catalog/MODULE.md").read_bytes(), module_md)
        self.assertIn("exists (kept", self.render(extra)[1])
        extra["stories"][0]["id"] = "ACC-009"
        self.assertIn("id prefix must be the module prefix CAT", self.render(extra)[1])
        self.assertIn("is not a rendered module", self.render({"kind": "stories", "module": "nope", "stories": []})[1])

    def test_change_stories_name_an_existing_amended_story(self):
        doc = self.catalog_doc()
        doc["stories"].append(self.new_story(doc, kind="change"))
        self.assertIn("a change story names the story it amends", self.render(doc)[1])
        doc["stories"][-1]["amends"] = ["CAT-404"]
        self.assertIn("CAT-002.amends: unknown story CAT-404", self.render(doc)[1])

    def test_change_story_may_cite_a_retired_constraint(self):
        self.set_status("CAT-001", "done")
        self.edit_design("| `Product.price > 0` | Un prix positif |\n", "")
        self.diff()
        doc = self.catalog_doc()
        doc["constraints"].pop("C-01")
        story = self.new_story(doc, kind="feature")
        doc["stories"].append(story)
        self.assertIn("unknown constraint C-01", self.render(doc)[1])
        story.update({"kind": "change", "amends": ["CAT-001"],
                      "tests_to_update": ["limits | C-01 left the design | price 0 is accepted"]})
        code, out = self.render(doc)
        self.assertEqual(code, 0, out)
        text = self.p.story("CAT-002").read_text()
        self.assertIn("- `C-01`: retired from the design", text)
        self.assertIn("### Tests to update", text)


@needs_git
class CheckInputSyncTest(SyncCase):
    def test_sync_mode_and_moved_design(self):
        code, out = run(check_input.main, str(self.p.design))
        self.assertIn("mode: SYNC (STORY_MAP.md exists): follow references/sync.md", out)
        self.assertNotIn("design path:", out)
        moved = self.p.root / "docs" / "conception.md"
        moved.write_text(self.p.design.read_text())
        code, out = run(check_input.main, str(moved))
        self.assertRegex(out, r"design path: STORY_MAP.md records `docs/design.md`, this is `docs/conception.md`; "
                              r"\d+/\d+ baseline anchors match \(100%\): likely the same design")
        other = self.p.root / "docs" / "other.md"
        other.write_text("# Autre\n\n## Modèle\n\n### `Invoice`\n| Champ | Type |\n|---|---|\n| id | PK |\n")
        code, out = run(check_input.main, str(other))
        self.assertIn("likely a different design: with --non-interactive, stop", out)


if __name__ == "__main__":
    unittest.main()
