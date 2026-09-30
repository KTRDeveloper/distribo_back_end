#!/usr/bin/env python3
"""Unit tests for scan_project.py"""
from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from scan_project import (
    compute_fingerprint,
    should_skip,
    detect_runtime_versions,
    detect_test_framework,
    detect_commit_conventions,
    detect_workspace_structure,
    scan_tree,
    SKIP_FOLDERS,
)


class TestComputeFingerprint(unittest.TestCase):
    def test_empty_list(self):
        self.assertEqual(compute_fingerprint([]), "")

    def test_single_file(self):
        fp = compute_fingerprint(["file.ts"])
        self.assertEqual(len(fp), 16)
        self.assertRegex(fp, r"^[a-f0-9]{16}$")

    def test_order_independence(self):
        fp1 = compute_fingerprint(["b.ts", "a.ts", "c.ts"])
        fp2 = compute_fingerprint(["a.ts", "c.ts", "b.ts"])
        self.assertEqual(fp1, fp2)

    def test_different_files_different_fingerprints(self):
        fp1 = compute_fingerprint(["file1.ts"])
        fp2 = compute_fingerprint(["file2.ts"])
        self.assertNotEqual(fp1, fp2)


class TestShouldSkip(unittest.TestCase):
    def setUp(self):
        self.project_root = Path("/project")
        self.output_folder = Path("/project/docs/stories")
        self.skill_folder = Path("/project/skills/design-to-user-stories")

    def test_skip_hidden_folders(self):
        path = Path("/project/.cache")
        self.assertTrue(should_skip(path, self.project_root, self.output_folder, self.skill_folder))

    def test_allow_github_folder(self):
        path = Path("/project/.github")
        self.assertFalse(should_skip(path, self.project_root, self.output_folder, self.skill_folder))

    def test_skip_node_modules(self):
        path = Path("/project/node_modules")
        self.assertTrue(should_skip(path, self.project_root, self.output_folder, self.skill_folder))

    def test_skip_output_folder(self):
        self.assertTrue(should_skip(self.output_folder, self.project_root, self.output_folder, self.skill_folder))

    def test_skip_skill_folder(self):
        self.assertTrue(should_skip(self.skill_folder, self.project_root, self.output_folder, self.skill_folder))

    def test_allow_normal_folder(self):
        path = Path("/project/src")
        self.assertFalse(should_skip(path, self.project_root, self.output_folder, self.skill_folder))


class TestDetectRuntimeVersions(unittest.TestCase):
    def test_npm_package_json(self):
        with TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            package_json = project_root / "package.json"
            package_json.write_text('''{
                "engines": {
                    "node": ">=22.0.0",
                    "npm": ">=10.0.0"
                },
                "dependencies": {
                    "express": "^5.1.0",
                    "prisma": "^7.0.0"
                },
                "devDependencies": {
                    "vitest": "^4.0.0"
                }
            }''')

            manifests = {"package.json": "npm"}
            versions = detect_runtime_versions(project_root, manifests)

            self.assertEqual(versions["node"], ">=22.0.0")
            self.assertEqual(versions["npm"], ">=10.0.0")
            self.assertEqual(versions["express"], "^5.1.0")
            self.assertEqual(versions["prisma"], "^7.0.0")
            self.assertEqual(versions["vitest"], "^4.0.0")

    def test_requirements_txt(self):
        with TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            requirements = project_root / "requirements.txt"
            requirements.write_text('''django==4.2.0
flask>=2.3.0
pytest==7.4.0
# comment line
sqlalchemy>=2.0.0
''')

            manifests = {"requirements.txt": "pip"}
            versions = detect_runtime_versions(project_root, manifests)

            self.assertEqual(versions.get("django"), "4.2.0")
            self.assertEqual(versions.get("flask"), "2.3.0")
            self.assertEqual(versions.get("pytest"), "7.4.0")


class TestDetectTestFramework(unittest.TestCase):
    def test_vitest_from_package_json(self):
        with TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            package_json = project_root / "package.json"
            package_json.write_text('''{
                "scripts": {
                    "test": "vitest run",
                    "test:watch": "vitest"
                },
                "devDependencies": {
                    "vitest": "^4.0.0"
                }
            }''')

            manifests = {"package.json": "npm"}
            test_info = detect_test_framework(project_root, manifests, {})

            self.assertEqual(test_info["framework"], "vitest")
            self.assertIn("npm run test", test_info["commands"])
            self.assertIn("npm run test:watch", test_info["commands"])

    def test_jest_from_package_json(self):
        with TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            package_json = project_root / "package.json"
            package_json.write_text('''{
                "scripts": {
                    "test": "jest"
                },
                "devDependencies": {
                    "jest": "^29.0.0"
                }
            }''')

            manifests = {"package.json": "npm"}
            test_info = detect_test_framework(project_root, manifests, {})

            self.assertEqual(test_info["framework"], "jest")


class TestDetectCommitConventions(unittest.TestCase):
    @patch('subprocess.run')
    def test_conventional_commits(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout='''abc1234 feat(auth): add login endpoint
def5678 fix: resolve timeout issue
ghi9012 docs: update README
jkl3456 refactor(api): simplify error handling
mno7890 test: add integration tests
'''
        )

        with TemporaryDirectory() as tmpdir:
            conventions = detect_commit_conventions(Path(tmpdir))
            self.assertIn("conventional-commits", conventions)

    @patch('subprocess.run')
    def test_ticket_refs(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout='''abc1234 Fix issue #123
def5678 Implement feature ABC-456
ghi9012 Update docs for #789
jkl3456 Refactor code
'''
        )

        with TemporaryDirectory() as tmpdir:
            conventions = detect_commit_conventions(Path(tmpdir))
            self.assertIn("ticket-refs", conventions)

    @patch('subprocess.run')
    def test_no_conventions(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout='''abc1234 random commit message
def5678 another message
ghi9012 yet another
'''
        )

        with TemporaryDirectory() as tmpdir:
            conventions = detect_commit_conventions(Path(tmpdir))
            self.assertEqual(len(conventions), 0)


class TestDetectWorkspaceStructure(unittest.TestCase):
    def test_npm_workspaces(self):
        with TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            package_json = project_root / "package.json"
            package_json.write_text('''{
                "workspaces": ["packages/*", "apps/*"]
            }''')

            manifests = {"package.json": "npm"}
            workspace_info = detect_workspace_structure(project_root, manifests)

            self.assertEqual(workspace_info["type"], "monorepo")
            self.assertEqual(workspace_info["tool"], "npm-workspaces")
            self.assertEqual(workspace_info["packages"], ["packages/*", "apps/*"])

    def test_lerna_monorepo(self):
        with TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            (project_root / "lerna.json").write_text('{}')

            workspace_info = detect_workspace_structure(project_root, {})

            self.assertEqual(workspace_info["type"], "monorepo")
            self.assertEqual(workspace_info["tool"], "lerna")

    def test_single_package(self):
        with TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            package_json = project_root / "package.json"
            package_json.write_text('{"name": "my-app"}')

            manifests = {"package.json": "npm"}
            workspace_info = detect_workspace_structure(project_root, manifests)

            self.assertEqual(workspace_info["type"], "single")


class TestScanTree(unittest.TestCase):
    def test_basic_scan(self):
        with TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)

            # Create test structure
            (project_root / "src").mkdir()
            (project_root / "src" / "index.ts").write_text("export {}")
            (project_root / "src" / "utils.ts").write_text("export {}")
            (project_root / "tests").mkdir()
            (project_root / "tests" / "index.test.ts").write_text("test()")
            (project_root / "package.json").write_text("{}")
            (project_root / "README.md").write_text("# Project")

            skill_folder = Path("/skill")
            result = scan_tree(project_root, None, skill_folder)

            self.assertEqual(result["languages"]["TypeScript"], 3)
            self.assertEqual(result["total_files"], 5)
            self.assertIn("package.json", result["manifests"])
            self.assertIn("README.md", result["doc_files"])

    def test_skip_folders(self):
        with TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)

            # Create structure with folders that should be skipped
            (project_root / "node_modules").mkdir()
            (project_root / "node_modules" / "lib.js").write_text("code")
            (project_root / "src").mkdir()
            (project_root / "src" / "index.ts").write_text("code")

            skill_folder = Path("/skill")
            result = scan_tree(project_root, None, skill_folder)

            # node_modules should be skipped
            self.assertEqual(result["total_files"], 1)
            self.assertNotIn("node_modules/lib.js", result["files_by_language"].get("JavaScript", []))


if __name__ == "__main__":
    unittest.main()
