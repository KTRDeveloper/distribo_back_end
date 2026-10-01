"""Shared test helpers: a throwaway project built from the fixtures."""
from __future__ import annotations

import contextlib
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

HAS_GIT = shutil.which("git") is not None
needs_git = unittest.skipUnless(HAS_GIT, "git is required for project-root detection")


def run(main, *argv) -> tuple:
    """Call a script's main(argv); return (exit_code, stdout)."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = main(list(argv))
    return code, buf.getvalue()


class Project:
    """tmp/ (git repo) with docs/design.md and docs/stories as the output folder."""

    def __init__(self, design: str = "design_small.md", git: bool = True):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        (self.root / "docs").mkdir()
        self.design = self.root / "docs" / "design.md"
        shutil.copy(FIXTURES / design, self.design)
        if git and HAS_GIT:
            subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.out = self.root / "docs" / "stories"

    def close(self):
        self.tmp.cleanup()

    def yaml(self, *names) -> list:
        return [str(FIXTURES / "yaml" / n) for n in names]

    def build(self) -> "Project":
        """index -> extract -> render all fixture YAML -> OPEN_QUESTIONS -> backlog."""
        import build_backlog
        import extract_model
        import index_design
        import render_stories
        for main, args in ((index_design.main, [str(self.design), "--out", str(self.out)]),
                           (extract_model.main, [str(self.design), "--out", str(self.out), "--hints", "0"]),
                           (render_stories.main, self.yaml("project.yaml", "foundation.yaml", "accounts.yaml",
                                                           "catalog.yaml") + ["--out", str(self.out)])):
            code, out = run(main, *args)
            assert code == 0, out
        shutil.copy(SCRIPTS.parent / "assets" / "OPEN_QUESTIONS.md", self.out / "OPEN_QUESTIONS.md")
        code, out = run(build_backlog.main, "--out", str(self.out), "--date", "2026-01-01")
        assert code == 0, out
        return self

    def story(self, sid: str) -> Path:
        return next((self.out / "modules").glob(f"*/{sid}-*.md"))

    def snapshot(self) -> dict:
        return {p.relative_to(self.out).as_posix(): p.read_bytes()
                for p in sorted(self.out.rglob("*")) if p.is_file()}
