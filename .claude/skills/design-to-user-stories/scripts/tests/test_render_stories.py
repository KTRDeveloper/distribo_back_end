import re
import shutil
import tempfile
import unittest
from pathlib import Path

import yaml

from helpers import FIXTURES, Project, needs_git, run

import extract_model
import index_design
import render_stories


def load(name):
    return yaml.safe_load((FIXTURES / "yaml" / name).read_text())


@needs_git
class RenderTest(unittest.TestCase):
    def setUp(self):
        self.p = Project()
        run(index_design.main, str(self.p.design), "--out", str(self.p.out))
        run(extract_model.main, str(self.p.design), "--out", str(self.p.out), "--hints", "0")
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        self.p.close()
        shutil.rmtree(self.tmp)

    def render(self, *docs, flags=()):
        paths = []
        for k, doc in enumerate(docs):
            if isinstance(doc, str):
                paths.append(str(FIXTURES / "yaml" / doc))
            else:
                path = self.tmp / f"doc{k}.yaml"
                path.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True))
                paths.append(str(path))
        return run(render_stories.main, *paths, "--out", str(self.p.out), *flags)

    def base(self):
        return ("project.yaml", "foundation.yaml", "accounts.yaml")

    def test_happy_path(self):
        code, out = self.render(*self.base(), "catalog.yaml")
        self.assertEqual(code, 0, out)
        self.assertIn("render: 15 created, 0 kept, 0 errors", out)
        story = self.p.story("CAT-001").read_text()
        self.assertTrue(story.startswith("---\nid: CAT-001\ntitle: Seller creates a product\n"))
        self.assertNotIn("priority:", story)
        self.assertIn("- `C-01`: `price` > 0", story)
        self.assertIn("| owner from session | security | AB-1, v5.0.0-15.3.3 |", story)
        self.assertIn("Command: `npx vitest run tests/catalog/product.create.test.ts`", story)
        model = (self.p.out / "modules" / "accounts" / "model.md").read_text()
        self.assertIn("| email | string, unique | Account.email:unique |", model)
        conventions = (self.p.out / "CONVENTIONS.md").read_text()
        self.assertIn("- Runtime: `express@5.1.0`, `zod@3.25.76`, `@prisma/client@7.10.0`", conventions)
        self.assertNotIn("[passwords]", conventions)
        self.assertNotIn("{{", conventions)
        acc = self.p.story("ACC-001").read_text()
        self.assertIn("- `Account` fields: `email` string, unique; `role` enum [SELLER / ADMIN]", acc)

    def test_story_files_are_never_overwritten_and_module_files_need_update(self):
        self.render(*self.base(), "catalog.yaml")
        story = self.p.story("CAT-001")
        story.write_text(story.read_text() + "\nmanual\n")
        module = self.p.out / "modules" / "catalog" / "MODULE.md"
        module.write_text("edited\n")
        code, out = self.render(*self.base(), "catalog.yaml")
        self.assertEqual(code, 0)
        self.assertIn("exists (kept, never overwritten) modules/catalog/CAT-001-seller-creates-a-product.md", out)
        self.assertIn("differs (kept; rerun with --update to replace) modules/catalog/MODULE.md", out)
        self.assertTrue(story.read_text().endswith("manual\n"))
        self.render(*self.base(), "catalog.yaml", flags=("--update",))
        self.assertNotEqual(module.read_text(), "edited\n")
        self.assertTrue(story.read_text().endswith("manual\n"))

    def test_check_writes_nothing(self):
        before = sorted(p.name for p in self.p.out.rglob("*"))
        code, out = self.render(*self.base(), "catalog.yaml", flags=("--check",))
        self.assertEqual(code, 0, out)
        self.assertIn("would create", out)
        self.assertEqual(sorted(p.name for p in self.p.out.rglob("*")), before)

    def expect_error(self, mutate, needle):
        doc = load("catalog.yaml")
        mutate(doc, doc["stories"][0])
        code, out = self.render(*self.base(), doc)
        self.assertEqual(code, 1, out)
        self.assertIn(needle, out)
        self.assertFalse(list((self.p.out / "modules").glob("catalog/*")), "a failing document writes nothing")

    def test_story_errors(self):
        cases = [
            (lambda d, s: s.update(id="ABC-001"), "id prefix must be the module prefix CAT"),
            (lambda d, s: s.update(kind="epic"), "kind must be one of"),
            (lambda d, s: s.update(story="Build the product endpoint"), "must be `As a <role>"),
            (lambda d, s: s.update(story="As a buyer, I want x so that y"), "role `buyer` is not a design role"),
            (lambda d, s: s.update(depends_on=["ACC-009"]), "unknown story ACC-009"),
            (lambda d, s: s.update(design_refs=["catalogue/nope"]), "anchor `catalogue/nope` is not in the design index"),
            (lambda d, s: s.update(constraints=s["constraints"] + ["C-99"]), "unknown constraint C-99"),
            (lambda d, s: s.update(asvs=["v4.0.3-1.1.1"]), "is not an ASVS 5.0.0 ID"),
            (lambda d, s: s.update(acceptance=s["acceptance"].replace("AC-2", "AC-3")), "labels must be AC-1..AC-2"),
            (lambda d, s: s.update(acceptance=s["acceptance"].replace("AC-2 Limits", "Limits")), "must start with its label AC-n"),
            (lambda d, s: s.update(abuse=None), "need abuse cases"),
            (lambda d, s: s.update(tests=s["tests"].replace("AB-2, ", "")), "AB-2 has no test"),
            (lambda d, s: s.update(tests=s["tests"].replace("AC-2, C-01, C-02", "AC-2, C-01")), "C-02 has no test"),
            (lambda d, s: s.update(tests=s["tests"] + "x | e2e | AC-1 | a → b\n"), "level must be one of"),
            (lambda d, s: s.update(tests=s["tests"] + "x | unit | Account.email:unique | a → b\n"),
             "add it to the story's `constraints` too"),
            (lambda d, s: s.update(security=["only sellers"]), "must start with its ASVS ID"),
            (lambda d, s: s.update(security=["v5.0.0-1.2.4: parameterized"]), "v5.0.0-1.2.4 is not listed in `asvs`"),
            (lambda d, s: s["implementation"].update(create=[f"src/f{i}.ts" for i in range(6)]), "production files; max 5"),
            (lambda d, s: s["implementation"].update(create=["/etc/x.ts"]), "must be relative to the project root"),
            (lambda d, s: s.update(read_first=["a.md", "b.ts", "c.ts"]), "at most 2 files besides CONVENTIONS.md"),
            (lambda d, s: s.update(fields=["Product.colour"]), "`Product.colour` is not in the design"),
            (lambda d, s: d.pop("constraints"), "C-02 has no English rule"),
            (lambda d, s: s.update(context="\n".join(f"- line {i}" for i in range(12))), "max 15"),
            (lambda d, s: s.update(out_of_scope=[f"item {i} " + "x" * 80 for i in range(60)]), "over budget"),
            (lambda d, s: s.update(extra=1), "unknown key `extra`"),
        ]
        for mutate, needle in cases:
            with self.subTest(needle=needle):
                self.expect_error(mutate, needle)

    def test_module_and_project_errors(self):
        doc = load("catalog.yaml")
        doc["entities"] = ["Basket"]
        code, out = self.render(*self.base(), doc)
        self.assertIn("`Basket` is not an entity of the design index", out)
        project = load("project.yaml")
        project["dependencies"]["runtime"]["express"] = "^5.1.0"
        project["baseline_omit"] = ["passwords", "nope"]
        project["glossary"].append("only two | cells")
        code, out = self.render(project)
        self.assertEqual(code, 1)
        for needle in ("`^5.1.0` is not an exact version", "unknown tag `nope`", "expected `term | design term(s) | meaning`"):
            self.assertIn(needle, out)

    def test_baseline_omit_drops_tagged_lines(self):
        project = load("project.yaml")
        project["baseline_omit"] = ["passwords"]
        code, out = self.render(project)
        self.assertEqual(code, 0, out)
        text = (self.p.out / "CONVENTIONS.md").read_text()
        self.assertNotIn("Argon2id", text)
        self.assertIn("parameterized", text)

    def test_model_md_splits_per_entity_past_the_budget(self):
        doc = load("catalog.yaml")
        doc["model"] = "\n".join(f"- extra note {i}" for i in range(125))
        doc["entities"] = ["Product", "Account"]
        code, out = self.render(*self.base(), doc)
        self.assertEqual(code, 0, out)
        self.assertTrue((self.p.out / "modules" / "catalog" / "model" / "Product.md").exists())
        self.assertIn("`model/Product.md`", (self.p.out / "modules" / "catalog" / "model.md").read_text())


if __name__ == "__main__":
    unittest.main()
