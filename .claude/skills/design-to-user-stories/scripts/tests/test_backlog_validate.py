"""build_backlog.py and validate.py on a rendered fixture project."""
import json
import re
import unittest
from unittest import mock

from helpers import Project, needs_git, run

import build_backlog
import validate


@needs_git
class BuildBacklogTest(unittest.TestCase):
    def setUp(self):
        self.p = Project().build()

    def tearDown(self):
        self.p.close()

    def test_outputs(self):
        out = self.p.out
        status = (out / "STATUS.md").read_text()
        self.assertEqual(re.findall(r"^\| ([A-Z]+-\d{3}) \| todo \|", status, re.M), ["FND-000", "ACC-001", "CAT-001"])
        order = (out / "_meta" / "order.md").read_text()
        self.assertIn("1. FND-000 Walking skeleton (foundation)", order)
        self.assertIn("  ACC_001 --> CAT_001", order)
        index = json.loads((out / "_meta" / "index.json").read_text())
        self.assertEqual(sorted(index["stories"]), ["ACC-001", "CAT-001", "FND-000"])
        self.assertEqual(len(index["stories"]["CAT-001"]["sha256"]), 64)
        story_map = (out / "STORY_MAP.md").read_text()
        self.assertIn("| catalog | CAT | Product | 1 | 0 | 0 | 0 | 0 | CAT-002 | L2 |", story_map)
        self.assertIn("1. FND-000: Walking skeleton", story_map)
        self.assertIn(f"Template version: {build_backlog.skill_version()} ·", story_map)
        self.assertIn("## Pending changes\nNone.", story_map)
        self.assertTrue((out / "_meta" / "baseline" / "design.md").exists())
        trace = (out / "_meta" / "traceability.md").read_text()
        self.assertIn("| C-01 | CAT-001 | CAT-001: limits |", trace)
        changelog = (out / "CHANGELOG.md").read_text()
        self.assertIn("## 2026-01-01: init", changelog)
        self.assertIn("Stories added (3): ACC-001, CAT-001, FND-000", changelog)
        for name in ("STORY_MAP.md", "STATUS.md", "_meta/backlog.json", "_meta/order.md", "_meta/traceability.md"):
            self.assertNotRegex((out / name).read_text(), r"\d{4}-\d{2}-\d{2}", name)

    def test_rerun_is_idempotent_and_keeps_status_edits(self):
        out = self.p.out
        status = out / "STATUS.md"
        status.write_text(status.read_text().replace("| FND-000 | todo | | |", "| FND-000 | done | ana | merged |"))
        run(build_backlog.main, "--out", str(out), "--date", "2026-01-02")
        first = self.p.snapshot()
        run(build_backlog.main, "--out", str(out), "--date", "2026-01-03")
        self.assertEqual(self.p.snapshot(), first)
        self.assertIn("| FND-000 | done | ana | merged |", status.read_text())
        self.assertEqual(first["CHANGELOG.md"].decode().count("## "), 1)
        backlog = json.loads((out / "_meta" / "backlog.json").read_text())
        implementable = [s["id"] for s in backlog["stories"] if s["implementable"]]
        self.assertEqual(implementable, ["ACC-001"])

    def test_pending_changes_with_open_items_are_kept(self):
        story_map = self.p.out / "STORY_MAP.md"
        story_map.write_text(story_map.read_text().replace("None.", "- [ ] constraint C-01 tightened (CAT-001, todo)"))
        run(build_backlog.main, "--out", str(self.p.out))
        self.assertIn("- [ ] constraint C-01 tightened", story_map.read_text())


@needs_git
class ValidateTest(unittest.TestCase):
    def setUp(self):
        self.p = Project().build()

    def tearDown(self):
        self.p.close()

    def validate(self):
        return run(validate.main, "--out", str(self.p.out))

    def test_clean_project_passes(self):
        code, out = self.validate()
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip(), "validate: OK (3 stories, 3 modules, 7 constraints covered)")

    def test_long_pattern_of_todo_stories_warns(self):
        pattern = self.p.root / "src" / "modules" / "health" / "health.routes.ts"
        pattern.parent.mkdir(parents=True, exist_ok=True)
        pattern.write_text("// line\n" * 151)
        code, out = self.validate()
        self.assertEqual(code, 0, out)
        self.assertIn("warning: src/modules/health/health.routes.ts: pattern of 2 todo stories has 151 lines", out)

    def test_pattern_not_created_yet_that_todo_stories_grow_warns(self):
        self.mutate("CAT-001", "- Modify: `prisma/schema.prisma`, `src/app.ts`",
                    "- Modify: `prisma/schema.prisma`, `src/app.ts`, `src/modules/health/health.routes.ts`")
        with mock.patch.object(validate, "PATTERN_MAX_MODIFIERS", 0):
            code, out = self.validate()
        self.assertEqual(code, 0, out)
        self.assertIn("warning: src/modules/health/health.routes.ts: pattern of 2 todo stories does not exist yet "
                      "and 1 todo stories modify it", out)

    def mutate(self, sid, old, new):
        path = self.p.story(sid)
        text = path.read_text()
        self.assertIn(old, text, f"fixture text not found in {sid}: {old!r}")
        path.write_text(text.replace(old, new, 1))

    def assert_fails(self, needle):
        code, out = self.validate()
        self.assertEqual(code, 1, out)
        self.assertIn(needle, out)
        self.assertRegex(out.strip().splitlines()[-1], r"^validate: \d+ failures")

    def test_story_level_failures(self):
        cases = [
            ("CAT-001", "- Editing products.", "- Editing products, etc.", "vague term `etc.`"),
            ("CAT-001", "- Editing products.", "- Keep it fast and user-friendly.", "vague term `fast`"),
            ("CAT-001", "- Editing products.", "- Skip the auth tests for now.", "skip, weaken or delete tests"),
            ("CAT-001", "- Editing products.", "- Add `// eslint-disable` where lint fails.", "skip, weaken or delete tests"),
            ("CAT-001", "- Editing products.", "- Key: api_key=tbk_9f3a7c1e5b2d8f4a6c0e9b7d5f3a1c8e", "secret-like string"),
            ("CAT-001", "- Editing products.", "- See https://evil.example.com/x", "URL not listed in CONVENTIONS.md"),
            ("CAT-001", "- Dependencies: `zod`, `express`", "- Dependencies: `zod`, `left-pad-pro`", "package `left-pad-pro` is not in"),
            ("CAT-001", "- Editing products.", "- Run `npm install lodash` first.", "installs `lodash`, not in the allowlist"),
            ("CAT-001", "depends_on: [ACC-001]", "depends_on: [ACC-009]", "references unknown story ACC-009"),
            ("CAT-001", "design_refs: [PRD]", "design_refs: [nowhere]", "design anchor `nowhere` does not resolve"),
            ("CAT-001", "asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]", "asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, v5.0.0-99.9.9]",
             "ASVS ID `v5.0.0-99.9.9` does not exist"),
            ("CAT-001", "| limits | integration | AC-2, C-01, C-02 |", "| limits | integration | AC-2, C-01 |", "C-02 has no test"),
            ("CAT-001", "| admin forbidden | security | AB-2, v5.0.0-8.2.1, WSTG-ATHZ-03 |",
             "| admin forbidden | security | v5.0.0-8.2.1 |", "AB-2 has no test"),
            ("CAT-001", "- Pattern: `src/modules/health/health.routes.ts`", "- Pattern: `src/nowhere.ts`",
             "`src/nowhere.ts` does not exist and no dependency creates it"),
            ("CAT-001", "`Product.owner_id` comes from the session", "`Product.seller_id` comes from the session",
             "`Product.seller_id` is not a field of the design"),
            ("CAT-001", "## Out of scope", "## Notes", "sections must be"),
            ("CAT-001", "title: Seller creates a product\nmodule: catalog", "module: catalog\ntitle: Seller creates a product",
             "front matter keys must be"),
            ("CAT-001", "kind: feature\nrev: 1", "kind: migration\nrev: 1", "a migration story is risk: high"),
            ("ACC-001", "- v5.0.0-2.2.1: the role", "- the role", "security rule must start with its ASVS ID"),
        ]
        for sid, old, new, needle in cases:
            with self.subTest(needle=needle):
                original = self.p.story(sid).read_text()
                self.mutate(sid, old, new)
                self.assert_fails(needle)
                self.p.story(sid).write_text(original)

    def test_budget(self):
        self.mutate("CAT-001", "- Editing products.", "\n".join(f"- Out {i}." for i in range(60)))
        self.assert_fails("budget 120 / 1500")

    def test_global_failures(self):
        self.mutate("CAT-001", "constraints: ['Product:required', 'Product:fk', C-01, C-02]",
                    "constraints: ['Product:required', 'Product:fk', C-01]")
        self.mutate("CAT-001", "| limits | integration | AC-2, C-01, C-02 |", "| limits | integration | AC-2, C-01 |")
        self.mutate("CAT-001", "- `C-02`: `name` is 1 to 120 characters\n", "")
        self.assert_fails("C-02 is covered by no story")

    def test_cycle_duplicate_blocks_and_status(self):
        self.mutate("ACC-001", "depends_on: [FND-000]", "depends_on: [FND-000, CAT-001]")
        block = "- Keep the seller id in the token.\n- Reject tokens older than 15 minutes.\n" \
                "- Log the product id on create.\n- Return 404 for foreign products.\n"
        self.mutate("ACC-001", "## Out of scope\n", "## Out of scope\n" + block)
        self.mutate("CAT-001", "## Out of scope\n", "## Out of scope\n" + block)
        status = self.p.out / "STATUS.md"
        status.write_text(status.read_text() + "| ZZZ-001 | todo | | |\n| ACC-001 | shipped | | |\n")
        code, out = self.validate()
        self.assertEqual(code, 1)
        for needle in ("dependency cycle", "4-line block repeated in ACC-001, CAT-001",
                       "ZZZ-001 has no story file", "status `shipped` is not one of"):
            self.assertIn(needle, out)

    def test_missing_foundation_and_duplicate_ids(self):
        fnd = self.p.story("FND-000")
        fnd.rename(fnd.with_name("FND-000-renamed.md"))
        self.assertEqual(self.validate()[0], 0, "renaming the slug alone is allowed by validate")
        text = self.p.story("CAT-001").read_text()
        (self.p.story("CAT-001").parent / "CAT-001-copy.md").write_text(text)
        self.assert_fails("duplicate story ID CAT-001")
        (self.p.story("CAT-001").parent / "CAT-001-copy.md").unlink()
        fnd = self.p.story("FND-000")
        fnd.unlink()
        self.assert_fails("FND-000 (walking skeleton) is missing")


if __name__ == "__main__":
    unittest.main()
