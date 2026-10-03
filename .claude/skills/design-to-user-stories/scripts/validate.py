#!/usr/bin/env python3
"""Check every invariant of a stories folder. Prints failures only, then one summary line.

Usage: validate.py --out <folder>

Checks: front matter and sections match assets/story.md; budgets (lines and
~chars/4 tokens); unique IDs; depends_on targets exist, no cycles; design anchors
resolve; ASVS IDs exist; every constraint covered by a story and a test; every
AC and AB tested; every file read, modified or used as pattern exists or is
created by a dependency; every Entity.field exists in the design index; STATUS.md
lists every story; lint (unlisted packages, disabled checks or weakened tests,
secret-like strings, unlisted URLs, vague terms); 4-line blocks repeated across stories.
Design elements retired by a sync (index `retired`) stay citable by frozen stories
(in_progress, blocked, done, obsolete) and by change, migration and removal stories.
After a sync (_meta/sync.json): no pending change left; no story ID lost; done,
in_progress, blocked and non-impacted stories byte-identical; stories edited in
place have a higher rev; manual blocks kept; entity ownership and the module list
changed only with an accepted ADR. Always: `amends` targets exist and change or
removal stories have one; a change to a done story lists its tests to update; a
todo story's read_first never points to a done story. Module health (size,
cycles, ASVS levels above the module's) and the pattern files of todo stories
(too long, or growing because many todo stories modify them) print warnings,
which never fail.
Exit 1 when anything fails.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import asvs_lookup
import yaml

from common import (ASSETS, ASVS_CSV, CONVENTIONS_MAX_LINES, CONVENTIONS_MAX_TOKENS, FROZEN_STATUSES, KINDS,
                    MAX_ACCEPTANCE, MAX_PRODUCTION_FILES, MAX_READ_FIRST, MODULE_FILE_MAX_LINES,
                    MODULE_FILE_MAX_TOKENS, PATTERN_MAX_LINES, PATTERN_MAX_MODIFIERS, README_MAX_LINES,
                    README_MAX_TOKENS, RISKS, SIZES, STATUSES,
                    STORY_ID_RE, STORY_MAX_LINES, STORY_MAX_TOKENS, SYNC_FILE, TEST_LEVELS, DtusError,
                    estimate_tokens, find_secrets, load_json, load_template, manual_blocks, out_paths,
                    parse_status, pending_items, read_text, sha256_file, split_front_matter,
                    template_front_matter_keys, template_sections)
from designparse import parse_constraints_md, split_row
from render_stories import CWE_RE, WSTG_RE, is_production_file

STORY_FILE_RE = re.compile(r"^([A-Z][A-Z0-9]{1,5}-\d{3})-[a-z0-9-]+\.md$")
SCENARIO_LABEL_RE = re.compile(r"^\s*Scenario(?: Outline)?:\s*((AC|AB)-(\d+))?")
ENTITY_FIELD_RE = re.compile(r"\b([A-Z][A-Za-z0-9_]*)\.([a-z_][a-z0-9_]*)\b")
URL_RE = re.compile(r"https?://[^\s)>\]`'\"|]+")
INSTALL_RE = re.compile(r"\b(?:npm (?:install|i|add)|pnpm (?:add|install)|yarn add|pip install|poetry add|cargo add|go get)\s+([^\n`;&|]+)")
WEAKEN_RE = re.compile(
    r"(?i)\b(skip|skipping|disable|disabling|delete|deleting|remove|removing|weaken|weakening|relax|"
    r"comment(?:ing)? out|bypass|turn(?:ing)? off|mute|muting)\b[^.\n]{0,40}?\b(tests?|specs?|assertions?|"
    r"lint(?:er|ing)?|lint rules?|checks?|scans?|hooks?|csrf|auth(?:entication|orization)?|validation)\b")
MARKERS_RE = re.compile(r"(\.skip\(|\bxit\(|\bxdescribe\(|\.only\(|--no-verify|eslint-disable|@ts-ignore|"
                        r"@ts-nocheck|#\s*noqa|#\s*nosec|istanbul ignore|c8 ignore|NODE_TLS_REJECT_UNAUTHORIZED|"
                        r"rejectUnauthorized:\s*false|verify\s*=\s*False)")
VAGUE_TERMS = ["as appropriate", "etc.", "fast", "user-friendly", "handle properly", "if possible", "as needed",
               "and so on", "properly", "appropriately", "gracefully", "user friendly", "intuitive", "robust",
               "seamless", "reasonable"]
VAGUE_RE = re.compile(r"(?i)(?<![\w-])(" + "|".join(re.escape(t) if t != "etc." else r"etc\b\.?" for t in VAGUE_TERMS) + r")(?![\w-])")
NODE_BUILTINS = {"assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https", "net", "os",
                 "path", "process", "querystring", "readline", "stream", "string_decoder", "timers", "tls",
                 "url", "util", "worker_threads", "zlib", "test"}
STEP_RE = re.compile(r"^\s*(Given|When|Then|And|But|\*|\||Examples:|Background:|Feature:|Rule:|#)")


SHIPPED_KINDS = ("change", "migration", "removal")


class Report:
    def __init__(self):
        self.failures = []
        self.warnings = []

    def fail(self, where: str, msg: str):
        self.failures.append((where, msg))

    def warn(self, where: str, msg: str):
        self.warnings.append((where, msg))


def accepted_adrs(out: Path) -> list:
    """Texts of the ADRs whose status is accepted."""
    texts = []
    for path in sorted((out / "decisions").glob("ADR-*.md")):
        text = read_text(path)
        if re.search(r"(?im)^\s*status:\s*\**accepted\b", text):
            texts.append(text)
    return texts


def mentions(texts: list, name: str) -> bool:
    return any(re.search(rf"(?<![\w-]){re.escape(name)}(?![\w-])", t) for t in texts)


def discovery_checks(out: Path, rep: Report, stories: dict, constraints: dict, index: dict):
    """Checks for DISCOVERY outputs: PROJECT_PROFILE.md and implemented_by coverage."""
    profile_path = out / "PROJECT_PROFILE.md"
    if not profile_path.exists():
        return  # No discovery was run

    profile_text = read_text(profile_path)

    # Extract evidence paths (format: file:line or file)
    evidence_pattern = re.compile(r'`([^`]+(?::\d+)?)`')
    for match in evidence_pattern.finditer(profile_text):
        evidence = match.group(1)
        # Skip if it's not a path-like string
        if not ('/' in evidence or evidence.endswith(('.ts', '.js', '.py', '.md', '.json', '.yml', '.yaml', '.toml'))):
            continue

        # Parse file:line format
        if ':' in evidence:
            file_part, line_part = evidence.rsplit(':', 1)
            if line_part.isdigit():
                evidence_file = out.parent / file_part
                if not evidence_file.exists():
                    rep.fail("PROJECT_PROFILE.md", f"evidence path does not exist: {file_part}")
                elif evidence_file.is_file():
                    # Check line count
                    try:
                        line_count = len(evidence_file.read_text().splitlines())
                        required_line = int(line_part)
                        if required_line > line_count:
                            rep.fail("PROJECT_PROFILE.md", f"evidence path {evidence} line {required_line} exceeds file length {line_count}")
                    except Exception:
                        pass
            else:
                # Not file:line format, treat as plain path
                evidence_file = out.parent / evidence
                if not evidence_file.exists():
                    rep.fail("PROJECT_PROFILE.md", f"evidence path does not exist: {evidence}")
        else:
            evidence_file = out.parent / evidence
            if not evidence_file.exists():
                rep.fail("PROJECT_PROFILE.md", f"evidence path does not exist: {evidence}")

    # Check constraint coverage: every constraint must be covered by a story or implemented_by
    implemented_by = index.get("implemented_by", {})
    covered_constraints = set()

    # Collect constraints from stories
    for story in stories.values():
        story_constraints = story["fm"].get("constraints", [])
        if story_constraints:
            covered_constraints.update(story_constraints)

    # Collect constraints from implemented_by
    for impl_entry in implemented_by.values():
        if isinstance(impl_entry, dict) and "constraints" in impl_entry:
            covered_constraints.update(impl_entry["constraints"])

    # Check all constraints are covered
    for cid in constraints:
        if cid not in covered_constraints:
            rep.fail("constraints", f"constraint {cid} not covered by any story or implemented_by entry")

    # Warn about implemented constraints without tests
    for impl_path, impl_data in implemented_by.items():
        if isinstance(impl_data, dict):
            impl_constraints = impl_data.get("constraints", [])
            has_tests = impl_data.get("tested", False)
            if impl_constraints and not has_tests:
                rep.warn("coverage", f"{impl_path} implements constraints but has no tests: {', '.join(impl_constraints)}")

    # Check conforming elements have no story
    conforming = index.get("conforming", {})
    for element_id, element_path in conforming.items():
        # Check if any story exists for this element
        for sid, story in stories.items():
            story_elements = story["fm"].get("implements", [])
            if element_id in story_elements:
                rep.fail(story["rel"], f"story implements element {element_id} already marked as conforming (implemented_by: {element_path})")


def sync_checks(out: Path, rep: Report, stories: dict, status: dict, index: dict):
    """Checks of the last sync, against the snapshot diff_design.py took (_meta/sync.json)."""
    sync = load_json(out / SYNC_FILE, default=None)
    if not sync:
        return None
    story_map = out / "STORY_MAP.md"
    unchecked = [i for i in pending_items(read_text(story_map)) if not i[1]] if story_map.exists() else []
    if unchecked:
        rep.fail("STORY_MAP.md", f"Pending changes has {len(unchecked)} unchecked items "
                                 f"({', '.join(i[0] for i in unchecked[:5])}): finish the sync")
        return sync
    if sync.get("status") != "closed":
        rep.fail(SYNC_FILE, "the sync is still open: run build_backlog.py")
        return sync
    before, after = sync.get("before") or {}, sync.get("after") or {}
    impacted, mechanical = sync.get("impacted") or {}, sync.get("mechanical") or {}
    for sid, b in sorted(before.items()):
        if sid not in stories:
            rep.fail(b.get("path", sid), f"{sid} existed before the sync and is gone (IDs are permanent)")
            continue
        a = after.get(sid)
        if not a or a.get("sha256") == b.get("sha256"):
            continue
        rel = stories[sid]["rel"]
        if b.get("status") in FROZEN_STATUSES:
            rep.fail(rel, f"{sid} was {b['status']} and the sync edited it: restore it and add a change story")
        elif sid not in impacted:
            rep.fail(rel, f"the sync edited {sid}, which no pending change reported as impacted")
        elif mechanical.get(sid) == a.get("sha256"):
            continue
        elif not isinstance(a.get("rev"), int) or not isinstance(b.get("rev"), int) or a["rev"] <= b["rev"]:
            rep.fail(rel, f"{sid} was edited in place: bump rev (was {b.get('rev')})")
    for sid, blocks in sorted((sync.get("manual") or {}).items()):
        s = stories.get(sid)
        if not s or (after.get(sid) or {}).get("sha256") != sha256_file(out / s["rel"]):
            continue
        for block in blocks:
            if block not in s["text"]:
                rep.fail(s["rel"], f"a <!-- manual --> block of {sid} was changed or dropped: restore it")
    adrs = accepted_adrs(out)
    modules = index.get("modules") or {}
    owners_now = {e: m for m, info in modules.items() for e in info.get("entities") or []}
    for entity, owner in sorted((sync.get("owners") or {}).items()):
        now = owners_now.get(entity)
        if now is not None and now != owner and not mentions(adrs, entity):
            rep.fail("_meta/index.json", f"{entity} moved from {owner} to {now} without an accepted ADR")
    for m in sorted(set(modules) - set(sync.get("modules") or [])):
        if not mentions(adrs, m):
            rep.fail(f"modules/{m}", f"new module {m} without an accepted ADR")
    return sync


def health_warnings(out: Path, rep: Report, stories: dict, status: dict, index: dict, sync):
    """Module health after a sync: ADR triggers, printed as warnings only."""
    try:
        defaults = yaml.safe_load(read_text(ASSETS / "defaults.yaml")) or {}
    except (DtusError, yaml.YAMLError):
        defaults = {}
    limits = defaults.get("module_health") or {}
    max_entities, max_active = int(limits.get("max_entities", 8)), int(limits.get("max_active_stories", 25))
    modules = index.get("modules") or {}
    for m, info in sorted(modules.items()):
        n = len(info.get("entities") or [])
        if n > max_entities:
            rep.warn(f"modules/{m}", f"{n} entities (> {max_entities}): consider a split ADR")
        active = [sid for sid, s in stories.items() if s["module_dir"] == m
                  and status.get(sid, {}).get("status", "todo") in ("todo", "in_progress", "blocked")]
        if len(active) > max_active:
            rep.warn(f"modules/{m}", f"{len(active)} active stories (> {max_active}): consider a split ADR")
    graph = {m: set(info.get("depends_on") or []) for m, info in modules.items()}
    for sid, s in stories.items():
        for d in s["fm"].get("depends_on") or []:
            if d in stories and stories[d]["module_dir"] != s["module_dir"]:
                graph.setdefault(s["module_dir"], set()).add(stories[d]["module_dir"])
    seen, cycles = {}, set()

    def visit(m, trail):
        seen[m] = 1
        for d in sorted(graph.get(m, ())):
            if seen.get(d) == 1:
                cycles.add(" -> ".join(trail[trail.index(d):] + [d]) if d in trail else f"{m} -> {d}")
            elif d not in seen:
                visit(d, trail + [d])
        seen[m] = 2
    for m in sorted(graph):
        if m not in seen:
            visit(m, [m])
    for c in sorted(cycles):
        rep.warn("modules", f"dependency cycle between modules: {c}")
    if not sync or sync.get("status") != "closed":
        return
    levels = {}
    try:
        import csv
        with open(ASVS_CSV, encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                levels["v5.0.0-" + row["req_id"].lstrip("V")] = int(row["L"])
    except (OSError, KeyError, ValueError):
        return
    before, after = sync.get("before") or {}, sync.get("after") or {}
    touched = [sid for sid in after if sid not in before or after[sid].get("sha256") != before[sid].get("sha256")]
    for sid in sorted(touched):
        s = stories.get(sid)
        if not s:
            continue
        declared = str((modules.get(s["module_dir"]) or {}).get("asvs_level", "L2")).lstrip("L")
        high = [a for a in s["fm"].get("asvs") or [] if levels.get(str(a), 0) > int(declared or 2)]
        if high:
            rep.warn(s["rel"], f"cites {', '.join(high)} above the module's ASVS L{declared}: "
                               "the module may now mix data needing different levels")


def sections_of(body: str, first_line: int) -> list:
    """(title, start_line, lines) for each ## section of a story body."""
    out, current = [], None
    for n, line in enumerate(body.split("\n"), first_line):
        if line.startswith("## "):
            current = [line[3:].strip(), n, []]
            out.append(current)
        elif current is not None:
            current[2].append((n, line))
    return out


def backticked(line: str) -> list:
    return re.findall(r"`([^`]+)`", line)


def strip_code_spans(line: str) -> str:
    return re.sub(r"`[^`]*`", "``", line)


def parse_allowlist(conventions: str):
    section = re.search(r"## Dependencies and URLs\n(.*?)(?=\n## |\Z)", conventions, re.S)
    packages, urls = set(), []
    if section:
        for token in re.findall(r"`([^`\s]+@[^`\s]+)`", section.group(1)):
            packages.add(token.rsplit("@", 1)[0])
        urls = re.findall(r"^- (https?://\S+)", section.group(1), re.M)
    return packages, urls


def package_name(token: str) -> str:
    token = token.strip().strip("`")
    if token.startswith("@"):
        parts = token.split("@")
        return "@" + parts[1] if len(parts) > 1 else token
    return token.split("@")[0]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    out = Path(args.out).resolve()
    rep = Report()
    try:
        root, out_rel, _ = out_paths(out)
        template = load_template("story.md")
        expected_keys = template_front_matter_keys(template)
        expected_sections = template_sections(template)
        index = load_json(out / "_meta" / "index.json", default=None) or {}
        asvs = asvs_lookup.load()
    except DtusError as exc:
        print(f"ERROR: {exc}")
        return 1

    def need(rel: str):
        path = out / rel
        if not path.exists():
            rep.fail(rel, "missing")
            return None
        return read_text(path)

    design = index.get("design") or {}
    if not design:
        rep.fail("_meta/index.json", "no design index (run index_design.py)")
    anchors = set(design.get("sections") or {}) | set(design.get("aliases") or {})
    retired = set(design.get("retired") or [])
    elements = design.get("elements") or {}
    entities = {k.split(":", 1)[1] for k in elements if k.startswith("entity:")}
    fields = {k.split(":", 1)[1] for k in elements if k.startswith("field:")}
    constraints_text = need("_meta/constraints.md")
    constraints = [r["id"] for r in parse_constraints_md(constraints_text)] if constraints_text else []
    conventions = need("CONVENTIONS.md") or ""
    allowed_packages, allowed_urls = parse_allowlist(conventions)
    status_text = need("STATUS.md")
    status = parse_status(status_text) if status_text else {}
    need("STORY_MAP.md")
    questions = need("OPEN_QUESTIONS.md")
    if questions is not None and ("## Questions" not in questions or "## Answers" not in questions):
        rep.fail("OPEN_QUESTIONS.md", "needs a `## Questions` and an `## Answers` section")
    for rel, max_lines, max_tokens in (("CONVENTIONS.md", CONVENTIONS_MAX_LINES, CONVENTIONS_MAX_TOKENS),
                                       ("README.md", README_MAX_LINES, README_MAX_TOKENS)):
        text = conventions if rel == "CONVENTIONS.md" else need(rel)
        if text and (text.count("\n") > max_lines or estimate_tokens(text) > max_tokens):
            rep.fail(rel, f"{text.count(chr(10))} lines / ~{estimate_tokens(text)} tokens; budget {max_lines} / {max_tokens}")
    for path in sorted((out / "modules").glob("*/*.md")) + sorted((out / "modules").glob("*/model/*.md")):
        if STORY_FILE_RE.match(path.name) or re.match(r"^[A-Z][A-Z0-9]{1,5}-\d{3}-", path.name):
            continue
        text = read_text(path)
        if text.count("\n") > MODULE_FILE_MAX_LINES or estimate_tokens(text) > MODULE_FILE_MAX_TOKENS:
            rep.fail(path.relative_to(out).as_posix(),
                     f"{text.count(chr(10))} lines / ~{estimate_tokens(text)} tokens; budget {MODULE_FILE_MAX_LINES} / {MODULE_FILE_MAX_TOKENS}")

    # ------------------------------------------------------------ stories
    stories = {}
    for path in sorted((out / "modules").glob("*/*.md")):
        if not re.match(r"^[A-Z][A-Z0-9]{1,5}-\d{3}-", path.name):
            continue
        rel = path.relative_to(out).as_posix()
        m = STORY_FILE_RE.match(path.name)
        if not m:
            rep.fail(rel, "file name must be <ID>-<kebab-slug>.md")
            continue
        text = read_text(path)
        try:
            fm, body, first = split_front_matter(text)
        except DtusError as exc:
            rep.fail(rel, str(exc))
            continue
        sid = str(fm.get("id"))
        if sid in stories:
            rep.fail(rel, f"duplicate story ID {sid} (also {stories[sid]['rel']})")
            continue
        stories[sid] = {"rel": rel, "fm": fm, "body": body, "first": first, "text": text, "file_id": m.group(1),
                        "module_dir": path.parent.name}

    if "FND-000" not in stories:
        rep.fail("modules/foundation", "FND-000 (walking skeleton) is missing")

    created_by = {}
    for sid, s in stories.items():
        s["impl"] = {"read": [], "create": [], "modify": [], "pattern": [], "dependencies": []}
        for title, start, lines in sections_of(s["body"], s["first"]):
            if title == "Implementation":
                for n, line in lines:
                    m = re.match(r"^- (Read|Create|Modify|Pattern|Dependencies):(.*)$", line)
                    if m:
                        s["impl"][m.group(1).lower()] += backticked(m.group(2))
        for f in s["impl"]["create"]:
            created_by.setdefault(f, []).append(sid)
    for f, ids in sorted(created_by.items()):
        if len(ids) > 1:
            rep.fail(f, f"created by several stories: {', '.join(sorted(ids))}")

    def closure(sid, seen=None):
        seen = set() if seen is None else seen
        for d in stories.get(sid, {}).get("fm", {}).get("depends_on") or []:
            if d not in seen:
                seen.add(d)
                closure(d, seen)
        return seen

    covered_by_story, covered_by_test = set(), set()
    blocks = {}
    for sid, s in sorted(stories.items()):
        rel, fm, body = s["rel"], s["fm"], s["body"]
        # history may cite what a sync retired from the design
        tolerant = (status.get(sid, {}).get("status") in FROZEN_STATUSES + ("obsolete",)
                    or fm.get("kind") in SHIPPED_KINDS)

        def gone(key: str) -> bool:
            return tolerant and key in retired
        # front matter
        keys = list(fm.keys())
        want = [k for k in expected_keys if k != "priority" or "priority" in fm]
        if keys != want:
            rep.fail(rel, f"front matter keys must be {', '.join(want)} in this order")
        if sid != s["file_id"] or not STORY_ID_RE.match(sid):
            rep.fail(rel, f"id {sid} does not match the file name")
        if fm.get("module") != s["module_dir"]:
            rep.fail(rel, f"module `{fm.get('module')}` does not match folder `{s['module_dir']}`")
        for key, allowed in (("kind", KINDS), ("size", SIZES), ("risk", RISKS)):
            if fm.get(key) not in allowed:
                rep.fail(rel, f"{key} must be one of {', '.join(allowed)}")
        if not isinstance(fm.get("rev"), int) or fm.get("rev") < 1:
            rep.fail(rel, "rev must be an integer >= 1")
        for key in ("amends", "depends_on", "read_first", "design_refs", "constraints", "asvs"):
            if not isinstance(fm.get(key), list):
                rep.fail(rel, f"{key} must be a list")
                fm[key] = []
        if fm.get("kind") == "migration" and fm.get("risk") != "high":
            rep.fail(rel, "a migration story is risk: high")
        for d in fm["depends_on"] + fm["amends"]:
            if d not in stories:
                rep.fail(rel, f"references unknown story {d}")
        if fm.get("kind") in ("change", "removal") and not fm["amends"]:
            rep.fail(rel, f"a {fm.get('kind')} story names the story it amends in `amends`")
        if (fm.get("kind") == "change" and "### Tests to update" not in body
                and any(status.get(d, {}).get("status") == "done" for d in fm["amends"])):
            rep.fail(rel, "a change to a done story needs `tests_to_update` (existing test | reason | new expectation)")
        if status.get(sid, {}).get("status", "todo") == "todo":
            for r in fm["read_first"]:
                m_story = re.search(r"(?:^|/)([A-Z][A-Z0-9]{1,5}-\d{3})-[^/]*\.md$", str(r))
                if m_story and status.get(m_story.group(1), {}).get("status") == "done":
                    rep.fail(rel, f"read_first points to done story {m_story.group(1)}: point to the code, "
                                  "contracts.md or model.md instead")
        for a in fm["design_refs"]:
            if a not in anchors and not gone(f"section:{a}"):
                rep.fail(rel, f"design anchor `{a}` does not resolve in _meta/index.json")
        for c in fm["constraints"]:
            if c not in constraints and not gone(f"constraint:{c}"):
                rep.fail(rel, f"unknown constraint {c}")
            covered_by_story.add(c)
        for a in fm["asvs"]:
            if not asvs_lookup.VERSIONED_RE.match(str(a)) or a not in asvs:
                rep.fail(rel, f"ASVS ID `{a}` does not exist in ASVS 5.0.0")
        if len([r for r in fm["read_first"] if not str(r).endswith("CONVENTIONS.md")]) > MAX_READ_FIRST:
            rep.fail(rel, f"read_first lists more than {MAX_READ_FIRST} files besides CONVENTIONS.md")
        if sid not in status:
            rep.fail("STATUS.md", f"no line for {sid} (run build_backlog.py)")

        # body structure and budgets
        lines = s["text"].count("\n")
        if lines > STORY_MAX_LINES or estimate_tokens(s["text"]) > STORY_MAX_TOKENS:
            rep.fail(rel, f"{lines} lines / ~{estimate_tokens(s['text'])} tokens; budget {STORY_MAX_LINES} / {STORY_MAX_TOKENS}")
        h1 = next((l for l in body.split("\n") if l.startswith("# ")), "")
        if not h1.startswith(f"# {sid} — "):
            rep.fail(rel, f"first heading must be `# {sid} — <title>`")
        secs = sections_of(body, s["first"])
        if [t for t, _, _ in secs] != expected_sections:
            rep.fail(rel, "sections must be: " + ", ".join(expected_sections))
        by_title = {t: (start, ls) for t, start, ls in secs}

        labels = {"AC": [], "AB": []}
        for title, kind in (("Acceptance criteria", "AC"), ("Abuse cases", "AB")):
            for n, line in by_title.get(title, (0, []))[1]:
                m = SCENARIO_LABEL_RE.match(line)
                if m and line.strip().startswith("Scenario"):
                    if not m.group(1) or m.group(2) != kind:
                        rep.fail(f"{rel}:{n}", f"scenario must start with its label {kind}-n")
                    else:
                        labels[kind].append(m.group(1))
            if labels[kind] != [f"{kind}-{i}" for i in range(1, len(labels[kind]) + 1)]:
                rep.fail(rel, f"{kind} labels must be {kind}-1..{kind}-n in order")
        if not labels["AC"]:
            rep.fail(rel, "no acceptance criteria")
        if len(labels["AC"]) > MAX_ACCEPTANCE:
            rep.fail(rel, f"{len(labels['AC'])} acceptance criteria; max {MAX_ACCEPTANCE}")
        if not labels["AB"] and (fm.get("kind") == "feature" or fm.get("risk") == "high"):
            rep.fail(rel, "feature and risk: high stories need abuse cases")

        tested = set()
        for n, line in by_title.get("Tests", (0, []))[1]:
            if line.startswith("### "):
                break
            if not line.strip().startswith("|"):
                continue
            cells = split_row(line)
            if cells[0] == "name" or set(cells[0]) <= set("-: "):
                continue
            if len(cells) != 4:
                rep.fail(f"{rel}:{n}", "test row needs 4 cells: name | level | covers | input → expected")
                continue
            if cells[1] not in TEST_LEVELS:
                rep.fail(f"{rel}:{n}", f"test level must be one of {', '.join(TEST_LEVELS)}")
            for t in [c.strip() for c in cells[2].split(",") if c.strip()]:
                if t in labels["AC"] or t in labels["AB"] or t in fm["constraints"] or t in fm["asvs"] \
                        or WSTG_RE.match(t) or CWE_RE.match(t):
                    tested.add(t)
                    if t in fm["constraints"]:
                        covered_by_test.add(t)
                else:
                    rep.fail(f"{rel}:{n}", f"covers unknown or unlisted ID `{t}`")
        for label in labels["AC"] + labels["AB"] + list(fm["constraints"]):
            if label not in tested:
                rep.fail(rel, f"{label} has no test")
        if not re.search(r"^Command: `[^`]+`", "\n".join(l for _, l in by_title.get("Tests", (0, []))[1]), re.M):
            rep.fail(rel, "Tests must end with `Command: `<exact command>``")

        impl = s["impl"]
        production = [f for f in impl["create"] + impl["modify"] if is_production_file(f)]
        if len(production) > MAX_PRODUCTION_FILES:
            rep.fail(rel, f"{len(production)} production files; max {MAX_PRODUCTION_FILES}")
        deps = closure(sid)
        for f in list(fm["read_first"]) + impl["read"] + impl["modify"] + impl["pattern"]:
            f = str(f)
            if (root / f).exists() or (out / f).exists():
                continue
            if any(c in deps for c in created_by.get(f, [])):
                continue
            rep.fail(rel, f"`{f}` does not exist and no dependency creates it")
        for d in impl["dependencies"]:
            name = package_name(d)
            if name in ("none added",) or name.startswith("node:") or name in NODE_BUILTINS:
                continue
            if name not in allowed_packages:
                rep.fail(rel, f"package `{name}` is not in the CONVENTIONS.md allowlist")

        # security bullets
        for n, line in by_title.get("Security", (0, []))[1]:
            if line.startswith("- ") and not line.startswith("- None beyond"):
                ids = re.findall(r"v5\.0\.0-\d+\.\d+\.\d+", line.split(":", 1)[0])
                if not ids:
                    rep.fail(f"{rel}:{n}", "security rule must start with its ASVS ID")
                for a in ids:
                    if a not in fm["asvs"]:
                        rep.fail(f"{rel}:{n}", f"{a} is not listed in front matter asvs")

        # lint, line by line
        in_fence, section = False, ""
        content_lines = []
        for n, line in enumerate(body.split("\n"), s["first"]):
            if line.startswith("## "):
                section = line[3:].strip()
            if line.startswith("### Tests to update"):
                section = "Tests to update"
            if line.strip().startswith("```"):
                in_fence = not in_fence
                continue
            plain = strip_code_spans(line)
            if not in_fence and section != "Tests to update":
                if WEAKEN_RE.search(plain) or MARKERS_RE.search(line):
                    rep.fail(f"{rel}:{n}", "instruction to disable a check or skip, weaken or delete tests")
            for m in VAGUE_RE.finditer(plain):
                rep.fail(f"{rel}:{n}", f"vague term `{m.group(1)}`: be specific")
            for url in URL_RE.findall(line):
                if not any(url.startswith(a) for a in allowed_urls):
                    rep.fail(f"{rel}:{n}", f"URL not listed in CONVENTIONS.md: {url}")
            for m in INSTALL_RE.finditer(line):
                for token in m.group(1).split():
                    if token.startswith("-"):
                        continue
                    if package_name(token) not in allowed_packages:
                        rep.fail(f"{rel}:{n}", f"installs `{package_name(token)}`, not in the allowlist")
            for m in ENTITY_FIELD_RE.finditer(line):
                ref = f"{m.group(1)}.{m.group(2)}"
                if m.group(1) in entities and ref not in fields and not gone(f"field:{ref}"):
                    rep.fail(f"{rel}:{n}", f"`{m.group(1)}.{m.group(2)}` is not a field of the design")
            stripped = line.strip()
            if (stripped and not in_fence and not stripped.startswith(("#", "|---", "| name |", "```"))
                    and not STEP_RE.match(stripped)):
                content_lines.append((n, stripped))
            elif stripped and in_fence and stripped.startswith("Scenario"):
                content_lines.append((n, stripped))
        for line_no, line in find_secrets(s["text"]):
            rep.fail(f"{rel}:{line_no}", "secret-like string (never copy credentials)")
        for k in range(len(content_lines) - 3):
            window = tuple(l for _, l in content_lines[k:k + 4])
            blocks.setdefault(window, []).append((sid, content_lines[k][0]))

    reported = set()
    for window, hits in blocks.items():
        owners = sorted({sid for sid, _ in hits})
        if len(owners) > 1 and tuple(owners) not in reported:
            reported.add(tuple(owners))
            rep.fail(stories[owners[0]]["rel"], f"4-line block repeated in {', '.join(owners)} "
                                                f"(\"{window[0][:50]}\"): move it to CONVENTIONS.md or the module files")

    for c in constraints:
        if c not in covered_by_story:
            rep.fail("_meta/constraints.md", f"{c} is covered by no story")
        elif c not in covered_by_test:
            rep.fail("_meta/constraints.md", f"{c} is covered by no test")
    for sid, row in status.items():
        if row["status"] not in STATUSES:
            rep.fail("STATUS.md", f"{sid}: status `{row['status']}` is not one of {', '.join(STATUSES)}")
        if sid not in stories:
            rep.fail("STATUS.md", f"{sid} has no story file (IDs are never deleted)")

    # patterns: every todo story that cites one reads it whole
    citers, modifiers = {}, {}
    for sid, s in stories.items():
        if status.get(sid, {}).get("status", "todo") == "todo":
            for f in s["impl"]["pattern"]:
                citers.setdefault(str(f), set()).add(sid)
            for f in s["impl"]["modify"]:
                modifiers.setdefault(str(f), set()).add(sid)
    for f, ids in sorted(citers.items()):
        path = root / f
        safe = not f.startswith("/") and ".." not in Path(f).parts
        exists = safe and path.is_file()
        lines = len(read_text(path).splitlines()) if exists else 0
        growing = len(modifiers.get(f, ()))
        if lines > PATTERN_MAX_LINES or growing > PATTERN_MAX_MODIFIERS:
            size = f"has {lines} lines" if exists else "does not exist yet"
            rep.warn(f, f"pattern of {len(ids)} todo stories {size} and {growing} todo stories modify it "
                        f"(max {PATTERN_MAX_LINES} / {PATTERN_MAX_MODIFIERS}): prefer a small file no story grows")

    # cycles
    state = {}

    def visit(sid, trail):
        state[sid] = 1
        for d in stories[sid]["fm"].get("depends_on") or []:
            if d not in stories:
                continue
            if state.get(d) == 1:
                rep.fail(stories[sid]["rel"], "dependency cycle: " + " -> ".join(trail + [sid, d]))
            elif state.get(d) is None:
                visit(d, trail + [sid])
        state[sid] = 2

    for sid in sorted(stories):
        if state.get(sid) is None:
            visit(sid, [])

    sync = sync_checks(out, rep, stories, status, index)
    health_warnings(out, rep, stories, status, index, sync)
    for where, msg in sorted(set(rep.failures)):
        print(f"{where}: {msg}")
    for where, msg in sorted(set(rep.warnings)):
        print(f"warning: {where}: {msg}")
    modules = sorted({s["fm"].get("module") for s in stories.values()})
    if rep.failures:
        print(f"validate: {len(set(rep.failures))} failures ({len(stories)} stories, {len(modules)} modules)")
        return 1
    print(f"validate: OK ({len(stories)} stories, {len(modules)} modules, {len(constraints)} constraints covered)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
