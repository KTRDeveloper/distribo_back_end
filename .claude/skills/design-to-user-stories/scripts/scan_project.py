#!/usr/bin/env python3
"""Project scanner for DISCOVERY phase.

Scans existing project structure, detects languages, frameworks, conventions,
and generates fingerprints per profile section for change detection.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any

from common import DtusError, load_json, write_text, dump_json


# Folders to skip (vendored, generated, build outputs)
SKIP_FOLDERS = {
    "node_modules", ".venv", "venv", "env", "__pycache__", ".pytest_cache",
    "dist", "build", "target", ".next", ".nuxt", "out", "coverage",
    ".git", ".svn", ".hg", "vendor", "third_party", "packages",
    ".tox", ".mypy_cache", ".ruff_cache", "htmlcov"
}

# File extensions by language
LANGUAGE_EXTENSIONS = {
    "TypeScript": {".ts", ".tsx", ".mts", ".cts"},
    "JavaScript": {".js", ".jsx", ".mjs", ".cjs"},
    "Python": {".py", ".pyx", ".pyi"},
    "Java": {".java"},
    "Kotlin": {".kt", ".kts"},
    "Go": {".go"},
    "Rust": {".rs"},
    "C": {".c", ".h"},
    "C++": {".cpp", ".cc", ".cxx", ".hpp", ".hxx"},
    "C#": {".cs"},
    "Ruby": {".rb"},
    "PHP": {".php"},
    "Swift": {".swift"},
}

# Manifest files
MANIFEST_FILES = {
    "package.json": "npm",
    "requirements.txt": "pip",
    "pyproject.toml": "python",
    "Pipfile": "pipenv",
    "poetry.lock": "poetry",
    "Cargo.toml": "cargo",
    "go.mod": "go",
    "pom.xml": "maven",
    "build.gradle": "gradle",
    "Gemfile": "bundler",
    "composer.json": "composer",
}

# CI config files
CI_FILES = {
    ".github/workflows": "github-actions",
    ".gitlab-ci.yml": "gitlab-ci",
    "Jenkinsfile": "jenkins",
    ".circleci/config.yml": "circleci",
    ".travis.yml": "travis",
    "azure-pipelines.yml": "azure-pipelines",
}

# Security tooling
SECURITY_FILES = {
    ".github/dependabot.yml": "dependabot",
    ".snyk": "snyk",
    "SECURITY.md": "security-policy",
    ".github/workflows/codeql.yml": "codeql",
}

# ORM and migration tools
ORM_INDICATORS = {
    "prisma/schema.prisma": "prisma",
    "alembic.ini": "alembic",
    "migrations": "django-migrations",  # folder
    "flyway.conf": "flyway",
    "liquibase.properties": "liquibase",
}

# Documentation files
DOC_FILES = {
    "CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md", "README.md",
    "README", "docs/adr", "docs/decisions"
}

MAX_DEPTH = 6


def compute_fingerprint(files: list[str]) -> str:
    """Compute SHA256 fingerprint of sorted file paths."""
    if not files:
        return ""
    content = "\n".join(sorted(files))
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def should_skip(path: Path, project_root: Path, output_folder: Path | None, skill_folder: Path) -> bool:
    """Check if path should be skipped."""
    # Skip hidden folders except .github
    if path.name.startswith(".") and path.name not in {".github", ".gitlab"}:
        return True

    # Skip known folders
    if path.name in SKIP_FOLDERS:
        return True

    # Skip output folder
    if output_folder and path == output_folder:
        return True

    # Skip skill folder
    if path == skill_folder:
        return True

    return False


def scan_tree(
    project_root: Path,
    output_folder: Path | None,
    skill_folder: Path,
    max_depth: int = MAX_DEPTH
) -> dict[str, Any]:
    """Scan project tree and collect file information."""
    files_by_lang: dict[str, list[str]] = defaultdict(list)
    manifests: dict[str, str] = {}
    ci_tools: dict[str, str] = {}
    security_tools: dict[str, str] = {}
    orm_tools: list[str] = []
    doc_files: list[str] = []
    all_files: list[str] = []

    def walk(path: Path, depth: int = 0):
        if depth > max_depth:
            return

        try:
            for item in path.iterdir():
                if item.is_file():
                    rel_path = str(item.relative_to(project_root))
                    all_files.append(rel_path)

                    # Language detection
                    for lang, exts in LANGUAGE_EXTENSIONS.items():
                        if item.suffix in exts:
                            files_by_lang[lang].append(rel_path)
                            break

                    # Manifest detection
                    if item.name in MANIFEST_FILES:
                        manifests[rel_path] = MANIFEST_FILES[item.name]

                    # CI detection
                    for ci_file, ci_tool in CI_FILES.items():
                        if ci_file in rel_path:
                            ci_tools[rel_path] = ci_tool

                    # Security detection
                    for sec_file, sec_tool in SECURITY_FILES.items():
                        if sec_file in rel_path:
                            security_tools[rel_path] = sec_tool

                    # Documentation
                    if item.name in DOC_FILES or "README" in item.name:
                        doc_files.append(rel_path)

                elif item.is_dir():
                    if should_skip(item, project_root, output_folder, skill_folder):
                        continue

                    # ORM folder detection
                    for orm_indicator, orm_name in ORM_INDICATORS.items():
                        if orm_indicator in str(item.relative_to(project_root)):
                            if orm_name not in orm_tools:
                                orm_tools.append(orm_name)

                    walk(item, depth + 1)

        except PermissionError:
            pass  # Skip inaccessible directories

    walk(project_root)

    return {
        "languages": {lang: len(files) for lang, files in files_by_lang.items()},
        "files_by_language": dict(files_by_lang),
        "manifests": manifests,
        "ci_tools": ci_tools,
        "security_tools": security_tools,
        "orm_tools": orm_tools,
        "doc_files": doc_files,
        "total_files": len(all_files),
    }


def detect_runtime_versions(project_root: Path, manifests: dict[str, str]) -> dict[str, Any]:
    """Extract runtime and dependency versions from manifests."""
    versions: dict[str, Any] = {}

    for manifest_path, pkg_mgr in manifests.items():
        full_path = project_root / manifest_path

        if pkg_mgr == "npm" and full_path.name == "package.json":
            try:
                data = load_json(full_path)
                if "engines" in data:
                    versions["node"] = data["engines"].get("node")
                    versions["npm"] = data["engines"].get("npm")

                # Key dependencies
                deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
                for key_dep in ["express", "fastify", "prisma", "typeorm", "vitest", "jest"]:
                    if key_dep in deps:
                        versions[key_dep] = deps[key_dep]
            except Exception:
                pass

        elif pkg_mgr in {"pip", "python"} and full_path.name in {"requirements.txt", "pyproject.toml"}:
            try:
                if full_path.suffix == ".txt":
                    content = full_path.read_text()
                    for line in content.splitlines():
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        # Parse package==version or package>=version
                        match = re.match(r"([a-zA-Z0-9_-]+)(==|>=|<=)([0-9.]+)", line)
                        if match:
                            pkg, _, ver = match.groups()
                            if pkg in {"django", "flask", "fastapi", "sqlalchemy", "pytest"}:
                                versions[pkg] = ver
            except Exception:
                pass

    return versions


def detect_test_framework(project_root: Path, manifests: dict[str, str], files_by_lang: dict[str, list[str]]) -> dict[str, Any]:
    """Detect test framework and commands."""
    test_info: dict[str, Any] = {"framework": None, "commands": []}

    # Check package.json scripts
    for manifest_path, pkg_mgr in manifests.items():
        if pkg_mgr == "npm":
            full_path = project_root / manifest_path
            try:
                data = load_json(full_path)
                scripts = data.get("scripts", {})

                # Detect framework from scripts or dependencies
                deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
                if "vitest" in deps:
                    test_info["framework"] = "vitest"
                elif "jest" in deps:
                    test_info["framework"] = "jest"
                elif "mocha" in deps:
                    test_info["framework"] = "mocha"

                # Extract test commands
                for script_name, script_cmd in scripts.items():
                    if "test" in script_name:
                        test_info["commands"].append(f"npm run {script_name}")
            except Exception:
                pass

    # Check for Python test frameworks
    if "Python" in files_by_lang:
        for manifest_path, pkg_mgr in manifests.items():
            if pkg_mgr in {"pip", "python"}:
                full_path = project_root / manifest_path
                content = full_path.read_text() if full_path.exists() else ""
                if "pytest" in content:
                    test_info["framework"] = "pytest"
                    test_info["commands"].append("pytest")
                elif "unittest" in content:
                    test_info["framework"] = "unittest"
                    test_info["commands"].append("python -m unittest")

    return test_info


def detect_commit_conventions(project_root: Path) -> list[str]:
    """Analyze recent commit messages for conventions."""
    try:
        result = subprocess.run(
            ["git", "log", "--oneline", "-20"],
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            commits = result.stdout.strip().split("\n")
            conventions = []

            # Check for conventional commits
            conventional = sum(1 for c in commits if re.match(r"^[a-f0-9]+ (feat|fix|docs|chore|refactor|test|style|perf)(\(.+\))?:", c))
            if conventional > len(commits) * 0.5:
                conventions.append("conventional-commits")

            # Check for ticket refs
            ticket_refs = sum(1 for c in commits if re.search(r"(#\d+|[A-Z]+-\d+)", c))
            if ticket_refs > len(commits) * 0.3:
                conventions.append("ticket-refs")

            return conventions
    except Exception:
        pass

    return []


def detect_workspace_structure(project_root: Path, manifests: dict[str, str]) -> dict[str, Any]:
    """Detect monorepo vs single package."""
    workspace_info: dict[str, Any] = {"type": "single", "packages": []}

    # Check for npm workspaces
    for manifest_path, pkg_mgr in manifests.items():
        if pkg_mgr == "npm" and manifest_path == "package.json":
            full_path = project_root / manifest_path
            try:
                data = load_json(full_path)
                if "workspaces" in data:
                    workspace_info["type"] = "monorepo"
                    workspace_info["tool"] = "npm-workspaces"
                    workspace_info["packages"] = data["workspaces"]
            except Exception:
                pass

    # Check for lerna
    if (project_root / "lerna.json").exists():
        workspace_info["type"] = "monorepo"
        workspace_info["tool"] = "lerna"

    # Check for multiple package.json files
    package_jsons = [m for m in manifests if m.endswith("package.json")]
    if len(package_jsons) > 1:
        workspace_info["type"] = "monorepo"
        workspace_info["packages"] = [str(Path(p).parent) for p in package_jsons if p != "package.json"]

    return workspace_info


def compute_section_fingerprints(
    project_root: Path,
    scan_data: dict[str, Any],
    manifests: dict[str, str],
    ci_tools: dict[str, str],
    doc_files: list[str]
) -> dict[str, str]:
    """Compute fingerprints per profile section for change detection."""
    fingerprints = {}

    # Stack section: manifests + language files
    stack_files = list(manifests.keys())
    fingerprints["stack"] = compute_fingerprint(stack_files)

    # Test section: test framework config + test files
    test_files = [f for f in scan_data.get("files_by_language", {}).get("TypeScript", []) if "test" in f or "spec" in f]
    test_files += [f for f in scan_data.get("files_by_language", {}).get("Python", []) if "test" in f]
    test_files += [m for m in manifests if "vitest.config" in m or "jest.config" in m or "pytest.ini" in m]
    fingerprints["test"] = compute_fingerprint(test_files)

    # CI section: CI config files
    fingerprints["ci"] = compute_fingerprint(list(ci_tools.keys()))

    # Data layer section: ORM files
    data_files = [f for f in scan_data.get("files_by_language", {}).get("TypeScript", []) if "schema.prisma" in f or "migration" in f]
    data_files += [f for f in scan_data.get("files_by_language", {}).get("Python", []) if "models.py" in f or "migration" in f]
    fingerprints["data_layer"] = compute_fingerprint(data_files)

    # Docs section: documentation files
    fingerprints["docs"] = compute_fingerprint(doc_files)

    return fingerprints


def scan_project(project_root: Path, output_folder: Path | None, skill_folder: Path, check_mode: bool = False) -> dict[str, Any]:
    """Main scan function."""
    # Scan the tree
    scan_data = scan_tree(project_root, output_folder, skill_folder)

    # Extract additional information
    versions = detect_runtime_versions(project_root, scan_data["manifests"])
    test_info = detect_test_framework(project_root, scan_data["manifests"], scan_data["files_by_language"])
    commit_conventions = detect_commit_conventions(project_root)
    workspace_info = detect_workspace_structure(project_root, scan_data["manifests"])

    # Compute fingerprints
    fingerprints = compute_section_fingerprints(
        project_root,
        scan_data,
        scan_data["manifests"],
        scan_data["ci_tools"],
        scan_data["doc_files"]
    )

    result = {
        "project_root": str(project_root),
        "languages": scan_data["languages"],
        "manifests": scan_data["manifests"],
        "versions": versions,
        "test_framework": test_info,
        "ci_tools": scan_data["ci_tools"],
        "security_tools": scan_data["security_tools"],
        "orm_tools": scan_data["orm_tools"],
        "commit_conventions": commit_conventions,
        "workspace": workspace_info,
        "doc_files": scan_data["doc_files"],
        "total_files": scan_data["total_files"],
        "fingerprints": fingerprints,
    }

    if check_mode:
        return result

    return result


def main():
    parser = argparse.ArgumentParser(description="Scan project for DISCOVERY phase")
    parser.add_argument("project_root", type=Path, help="Project root directory")
    parser.add_argument("--out", type=Path, help="Output file for scan results")
    parser.add_argument("--check", action="store_true", help="Check mode: compare with previous scan")
    parser.add_argument("--skill-folder", type=Path, help="Skill folder to skip")
    parser.add_argument("--output-folder", type=Path, help="Output folder to skip")

    args = parser.parse_args()

    if not args.project_root.is_dir():
        raise DtusError(f"Project root not found: {args.project_root}")

    skill_folder = args.skill_folder or Path(__file__).resolve().parent.parent

    result = scan_project(
        args.project_root,
        args.output_folder,
        skill_folder,
        check_mode=args.check
    )

    if args.check:
        # Compare with previous scan
        if args.out and args.out.exists():
            prev_scan = load_json(args.out)
            prev_fingerprints = prev_scan.get("fingerprints", {})
            curr_fingerprints = result["fingerprints"]

            changed_sections = []
            for section, curr_fp in curr_fingerprints.items():
                prev_fp = prev_fingerprints.get(section, "")
                if curr_fp != prev_fp:
                    changed_sections.append(section)

            if changed_sections:
                print(f"Changed sections: {', '.join(changed_sections)}")
                exit(1)
            else:
                print("No changes detected")
                exit(0)
        else:
            print("No previous scan found, skipping comparison")
            exit(0)

    # Output results
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        write_text(args.out, dump_json(result))
        print(f"Scan complete: {result['total_files']} files, {len(result['languages'])} languages")
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except DtusError as e:
        print(f"Error: {e}")
        exit(1)
