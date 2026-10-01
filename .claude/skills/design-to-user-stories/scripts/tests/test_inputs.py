"""check_input.py, index_design.py, extract_model.py, run_lock.py, asvs_lookup.py"""
import json
import tempfile
import unittest
from pathlib import Path

from helpers import FIXTURES, Project, needs_git, run

import asvs_lookup
import check_input
import extract_model
import index_design
import run_lock


class CheckInputTest(unittest.TestCase):
    def test_failures_print_one_clear_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "a.txt").write_text("# x")
            (tmp / "latin.md").write_bytes("# Été\n".encode("latin-1"))
            (tmp / "empty.md").write_text("  \n")
            cases = {str(tmp / "missing.md"): "not found", str(tmp / "a.txt"): "not a Markdown file",
                     str(tmp / "latin.md"): "not valid UTF-8", str(tmp / "empty.md"): "is empty",
                     str(FIXTURES / "design_no_model.md"): "no recognizable data model"}
            for path, needle in cases.items():
                code, out = run(check_input.main, path, "--out", str(tmp / "out"))
                self.assertEqual(code, 1, path)
                self.assertEqual(len(out.strip().splitlines()), 1)
                self.assertIn(needle, out)

    @needs_git
    def test_modes(self):
        p = Project()
        try:
            code, out = run(check_input.main, str(p.design))
            self.assertEqual(code, 0)
            self.assertIn("mode: INIT", out)
            self.assertIn("output: docs/stories (absent)", out)
            (p.out / "_meta").mkdir(parents=True)
            (p.out / "_meta" / "run.lock").write_text("mode: init\n")
            self.assertIn("lock: leftover", run(check_input.main, str(p.design))[1])
            (p.root / "package.json").write_text("{}")
            self.assertIn("mode: DISCOVERY needed", run(check_input.main, str(p.design))[1])
            (p.out / "STORY_MAP.md").write_text("# Story map\n")
            self.assertIn("mode: SYNC", run(check_input.main, str(p.design))[1])
        finally:
            p.close()

    def test_warnings_never_show_the_secret(self):
        code, out = run(check_input.main, str(FIXTURES / "design_gaps.md"), "--out", "/nonexistent/out")
        self.assertEqual(code, 0)
        self.assertIn("line 13: credential-like value (value hidden)", out)
        self.assertIn("line 11: text addressed to AI agents", out)
        self.assertIn("references Salle", out)
        self.assertNotIn("9f3a7c1e", out)


@needs_git
class IndexDesignTest(unittest.TestCase):
    def setUp(self):
        self.p = Project()

    def tearDown(self):
        self.p.close()

    def test_writes_design_and_paths_and_keeps_other_keys(self):
        index_path = self.p.out / "_meta" / "index.json"
        index_path.parent.mkdir(parents=True)
        index_path.write_text(json.dumps({"stories": {"FND-000": {"path": "x"}}}))
        code, out = run(index_design.main, str(self.p.design), "--out", str(self.p.out))
        self.assertEqual(code, 0, out)
        self.assertIn("L22-31  PRD  [entity Product, 5 fields]", out)
        data = json.loads(index_path.read_text())
        self.assertEqual(data["paths"], {"design": "docs/design.md", "out": "docs/stories"})
        self.assertIn("comptes/account", data["design"]["sections"])
        self.assertIn("field:Product.price", data["design"]["elements"])
        self.assertIn("constraint:C-01", data["design"]["elements"])
        self.assertEqual(data["stories"], {"FND-000": {"path": "x"}})
        first = index_path.read_bytes()
        run(index_design.main, str(self.p.design), "--out", str(self.p.out))
        self.assertEqual(index_path.read_bytes(), first, "deterministic output")

    def test_print_writes_nothing(self):
        code, out = run(index_design.main, str(self.p.design), "--out", str(self.p.out), "--print")
        self.assertEqual(code, 0)
        self.assertFalse(self.p.out.exists())


@needs_git
class ExtractModelTest(unittest.TestCase):
    def setUp(self):
        self.p = Project()

    def tearDown(self):
        self.p.close()

    def test_writes_constraints_and_keeps_manual_block(self):
        code, out = run(extract_model.main, str(self.p.design), "--out", str(self.p.out))
        self.assertEqual(code, 0, out)
        self.assertIn("constraints: 7 (required 2, unique 1, enum 1, fk 1, rule 2)", out)
        cpath = self.p.out / "_meta" / "constraints.md"
        text = cpath.read_text()
        self.assertIn("| C-01 | Product.price | `Product.price > 0` |", text)
        cpath.write_text(text + "| CM-01 | Product.name | trimmed before checks (design line 30) |\n")
        model = json.loads((self.p.out / "_meta" / "model.json").read_text())
        self.assertEqual(model["entities"]["Product"]["fields"][1]["fk"], "Account")
        run(extract_model.main, str(self.p.design), "--out", str(self.p.out))
        again = cpath.read_text()
        self.assertIn("| CM-01 | Product.name | trimmed before checks (design line 30) |", again)
        run(extract_model.main, str(self.p.design), "--out", str(self.p.out))
        self.assertEqual(cpath.read_text(), again, "deterministic output")

    def test_not_recognized_and_print(self):
        code, out = run(extract_model.main, str(FIXTURES / "design_no_model.md"), "--out", str(self.p.out))
        self.assertEqual(code, 2)
        self.assertIn("NOT RECOGNIZED", out)
        code, out = run(extract_model.main, str(self.p.design), "--out", str(self.p.out), "--print")
        self.assertEqual(code, 0)
        self.assertIn("| Account.role:enum | Account.role | one of SELLER, ADMIN |", out)
        self.assertFalse(self.p.out.exists())


class RunLockTest(unittest.TestCase):
    def test_acquire_release_and_leftover(self):
        with tempfile.TemporaryDirectory() as tmp:
            design = Path(tmp) / "d.md"
            design.write_text("# d")
            out = Path(tmp) / "out"
            self.assertIn("lock acquired", run(run_lock.main, "acquire", "--out", str(out), "--design", str(design))[1])
            lock = (out / "_meta" / "run.lock").read_text()
            self.assertIn("design_sha256:", lock)
            self.assertNotRegex(lock, r"\d{4}-\d{2}-\d{2}")
            self.assertIn("LEFTOVER", run(run_lock.main, "acquire", "--out", str(out))[1])
            self.assertIn("lock held", run(run_lock.main, "status", "--out", str(out))[1])
            self.assertIn("released", run(run_lock.main, "release", "--out", str(out))[1])
            self.assertIn("no lock", run(run_lock.main, "status", "--out", str(out))[1])


class AsvsLookupTest(unittest.TestCase):
    def test_load_and_canonical(self):
        reqs = asvs_lookup.load()
        self.assertEqual(len(reqs), 345)
        self.assertEqual(asvs_lookup.canonical("V6.2.1"), "v5.0.0-6.2.1")
        self.assertEqual(asvs_lookup.canonical("6.2.1"), "v5.0.0-6.2.1")
        self.assertIsNone(asvs_lookup.canonical("6.2"))
        self.assertEqual(list(reqs)[:2], ["v5.0.0-1.1.1", "v5.0.0-1.1.2"])

    def test_check(self):
        self.assertEqual(run(asvs_lookup.main, "--check", "v5.0.0-8.2.2", "v5.0.0-16.5.3")[0], 0)
        code, out = run(asvs_lookup.main, "--check", "v5.0.0-99.1.1", "8.2.2")
        self.assertEqual(code, 1)
        self.assertIn("2 unknown", out)

    def test_filters(self):
        code, out = run(asvs_lookup.main, "--level", "L1", "--chapter", "V8")
        lines = out.strip().splitlines()
        self.assertTrue(lines and all(" L1 " in l and l.startswith("v5.0.0-8.") for l in lines))
        out = run(asvs_lookup.main, "--section", "6.2", "--keyword", "breached")[1]
        self.assertIn("v5.0.0-6.2.12", out)
        out = run(asvs_lookup.main, "--chapter", "authorization", "--limit", "2", "--width", "40")[1]
        self.assertEqual(len(out.strip().splitlines()), 2)
        self.assertTrue(all(len(l.split(" ", 2)[2]) <= 40 for l in out.strip().splitlines()))
        self.assertIn("no matching", run(asvs_lookup.main, "--keyword", "zzzz-no-such-word")[1])
        self.assertIn("V17 WebRTC", run(asvs_lookup.main, "--chapters")[1])


if __name__ == "__main__":
    unittest.main()
