#!/usr/bin/env python3
"""Unit tests for validate.py discovery checks"""
from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from validate import discovery_checks, Report


class TestDiscoveryChecks(unittest.TestCase):
    def setUp(self):
        self.tempdir = TemporaryDirectory()
        self.out = Path(self.tempdir.name)
        self.project_root = self.out.parent
        self.rep = Report()

    def tearDown(self):
        self.tempdir.cleanup()

    def test_no_profile_skips_checks(self):
        """When PROJECT_PROFILE.md doesn't exist, discovery checks are skipped."""
        stories = {}
        constraints = {}
        index = {}

        discovery_checks(self.out, self.rep, stories, constraints, index)

        self.assertEqual(len(self.rep.failures), 0)
        self.assertEqual(len(self.rep.warnings), 0)

    def test_evidence_path_exists(self):
        """Valid evidence paths pass validation."""
        # Create profile with valid evidence paths
        (self.project_root / "src").mkdir()
        (self.project_root / "src" / "index.ts").write_text("console.log('test');")

        profile = self.out / "PROJECT_PROFILE.md"
        profile.write_text("""# Project Profile

## Stack
- TypeScript 5.9 (`src/index.ts`)
""")

        stories = {}
        constraints = {}
        index = {}

        discovery_checks(self.out, self.rep, stories, constraints, index)

        self.assertEqual(len(self.rep.failures), 0)

    def test_evidence_path_not_found(self):
        """Missing evidence paths are reported as failures."""
        profile = self.out / "PROJECT_PROFILE.md"
        profile.write_text("""# Project Profile

## Stack
- TypeScript 5.9 (`src/missing.ts`)
""")

        stories = {}
        constraints = {}
        index = {}

        discovery_checks(self.out, self.rep, stories, constraints, index)

        self.assertEqual(len(self.rep.failures), 1)
        where, msg = self.rep.failures[0]
        self.assertEqual(where, "PROJECT_PROFILE.md")
        self.assertIn("evidence path does not exist", msg)
        self.assertIn("src/missing.ts", msg)

    def test_evidence_path_with_line_number(self):
        """Evidence paths with line numbers are validated."""
        (self.project_root / "src").mkdir()
        (self.project_root / "src" / "index.ts").write_text("line1\nline2\nline3\n")

        profile = self.out / "PROJECT_PROFILE.md"
        profile.write_text("""# Project Profile

## Stack
- TypeScript 5.9 (`src/index.ts:2`)
""")

        stories = {}
        constraints = {}
        index = {}

        discovery_checks(self.out, self.rep, stories, constraints, index)

        self.assertEqual(len(self.rep.failures), 0)

    def test_evidence_path_line_exceeds_file_length(self):
        """Evidence paths with line numbers beyond file length are reported."""
        (self.project_root / "src").mkdir()
        (self.project_root / "src" / "index.ts").write_text("line1\nline2\n")

        profile = self.out / "PROJECT_PROFILE.md"
        profile.write_text("""# Project Profile

## Stack
- TypeScript 5.9 (`src/index.ts:10`)
""")

        stories = {}
        constraints = {}
        index = {}

        discovery_checks(self.out, self.rep, stories, constraints, index)

        self.assertEqual(len(self.rep.failures), 1)
        where, msg = self.rep.failures[0]
        self.assertIn("line 10 exceeds file length", msg)

    def test_constraint_coverage(self):
        """All constraints must be covered by stories or implemented_by."""
        profile = self.out / "PROJECT_PROFILE.md"
        profile.write_text("# Project Profile\n")

        constraints = {
            "C001": {"text": "Users must authenticate"},
            "C002": {"text": "Passwords must be hashed"},
            "C003": {"text": "API rate limiting"},
        }

        stories = {
            "AUTH-001": {
                "rel": "AUTH-001-login.md",
                "fm": {"constraints": ["C001"]}
            }
        }

        index = {
            "implemented_by": {
                "src/auth.ts": {
                    "constraints": ["C002"],
                    "tested": True
                }
            }
        }

        discovery_checks(self.out, self.rep, stories, constraints, index)

        # C003 is not covered
        self.assertEqual(len(self.rep.failures), 1)
        where, msg = self.rep.failures[0]
        self.assertEqual(where, "constraints")
        self.assertIn("C003", msg)
        self.assertIn("not covered", msg)

    def test_implemented_without_tests_warning(self):
        """Warn about implemented constraints without tests."""
        profile = self.out / "PROJECT_PROFILE.md"
        profile.write_text("# Project Profile\n")

        constraints = {
            "C001": {"text": "Authentication required"}
        }

        stories = {}

        index = {
            "implemented_by": {
                "src/auth.ts": {
                    "constraints": ["C001"],
                    "tested": False
                }
            }
        }

        discovery_checks(self.out, self.rep, stories, constraints, index)

        self.assertEqual(len(self.rep.warnings), 1)
        where, msg = self.rep.warnings[0]
        self.assertEqual(where, "coverage")
        self.assertIn("src/auth.ts", msg)
        self.assertIn("implements constraints but has no tests", msg)

    def test_conforming_element_with_story_fails(self):
        """Story implementing conforming element should fail."""
        profile = self.out / "PROJECT_PROFILE.md"
        profile.write_text("# Project Profile\n")

        constraints = {}

        stories = {
            "USER-001": {
                "rel": "USER-001-user-model.md",
                "fm": {"implements": ["User.email"]}
            }
        }

        index = {
            "conforming": {
                "User.email": "src/models/User.ts"
            }
        }

        discovery_checks(self.out, self.rep, stories, constraints, index)

        self.assertEqual(len(self.rep.failures), 1)
        where, msg = self.rep.failures[0]
        self.assertEqual(where, "USER-001-user-model.md")
        self.assertIn("User.email", msg)
        self.assertIn("already marked as conforming", msg)


if __name__ == "__main__":
    unittest.main()
