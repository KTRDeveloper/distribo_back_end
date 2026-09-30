#!/usr/bin/env python3
"""Render YAML documents into story files, module files and project files.

Usage: render_stories.py <yaml>... --out <folder> [--update] [--check]

Document kinds (the schema is in references/story-rules.md):
- kind: project -> CONVENTIONS.md, README.md, GLOSSARY.md
- kind: module  -> modules/<module>/MODULE.md, contracts.md, model.md, and one
                   file per story, named <ID>-<slug>.md
- kind: stories -> story files only, for a module already rendered (SYNC); its
                   prefix comes from _meta/index.json
Every story is checked before anything is written: schema, ID and prefix,
labels AC-n / AB-n, tests covering every AC, AB and constraint of the story,
known constraint / ASVS / design anchor / dependency IDs, and budgets. A
document with any error writes nothing. Story files are written once and never
overwritten, so a story whose file exists is skipped, unchecked (SYNC appends
new stories to an existing module YAML). Module and project files are created
when absent; when present and different, they are replaced only with --update.
--check writes nothing. Change, migration and removal stories may cite design
elements a sync retired (index `retired`); change and removal stories name the
story they amend.
"""
from __future__ import annotations

import argparse
import re
import sys
import textwrap
from pathlib import Path

import yaml

import asvs_lookup
from common import (ASSETS, CONVENTIONS_MAX_LINES, CONVENTIONS_MAX_TOKENS, KINDS, MAX_ACCEPTANCE,
                    MAX_CONTEXT_LINES, MAX_PRODUCTION_FILES, MAX_READ_FIRST, MODULE_FILE_MAX_LINES,
                    MODULE_FILE_MAX_TOKENS, README_MAX_LINES, README_MAX_TOKENS, RISKS, SIZES,
                    STORY_ID_RE, STORY_MAX_LINES, STORY_MAX_TOKENS, TEST_LEVELS, DtusError, dump_json,
                    estimate_tokens, fill_template, load_json, load_template, load_yaml_documents,
                    out_paths, read_text, slugify, write_text, yaml_inline)
from designparse import parse_constraints_md

SCENARIO_RE = re.compile(r"^\s*Scenario(?: Outline)?:\s*(.*)$")
LABEL_RE = re.compile(r"^(AC|AB)-(\d+)\b")
ASVS_ID_RE = re.compile(r"^v5\.0\.0-\d+\.\d+\.\d+$")
WSTG_RE = re.compile(r"^WSTG-[A-Z]{4}-\d{2}$")
CWE_RE = re.compile(r"^CWE-\d+$")
SECURITY_ITEM_RE = re.compile(r"^((?:v5\.0\.0-\d+\.\d+\.\d+)(?:\s*,\s*v5\.0\.0-\d+\.\d+\.\d+)*)\s*[:—–-]\s*(.+)$")
ROLE_RE = re.compile(r"^As an? (.+?), I want\b")
TEST_FILE_RE = re.compile(r"(^|/)(tests?|__tests__|spec|e2e)/|\.(test|spec)\.[A-Za-z0-9]+$")
CONFIG_FILE_RE = re.compile(r"(^|/)\.[^/]+$|(^|/)\.github/|\.(json|jsonc|ya?ml|toml|ini|cfg|md|txt|lock|env|example)$"
                            r"|(^|/)(Dockerfile|Makefile|Procfile|LICENSE)$|\.config\.[cm]?[jt]s$")
FRENCH_RE = re.compile(r"[àâäçéèêëîïôöùûüœ]|\b(le|la|les|des|du|une|est|sont|pour|avec|sans|chaque|dont|dans|aucune?|renseign\w*)\b", re.I)
EXACT_VERSION_RE = re.compile(r"^v?\d[\w.+-]*$")
BASELINE_TAGS = ("queries", "authorization", "passwords", "tokens", "rate-limit", "input-size", "security-logging")

PROJECT_REQUIRED = ("kind", "name", "design", "out", "asvs_level", "stack", "commands", "layout",
                    "dependencies", "urls", "roles", "glossary")
PROJECT_OPTIONAL = ("agent", "errors", "logging", "validation", "secrets", "migrations", "baseline", "baseline_omit",
                    "rules")
MODULE_REQUIRED = ("kind", "module", "prefix", "title", "responsibility", "entities", "asvs_level",
                   "asvs_rationale", "stories")
MODULE_OPTIONAL = ("depends_on", "classification", "threats", "constraints", "contracts", "pointers", "model")
STORY_REQUIRED = ("id", "title", "kind", "size", "risk", "story", "context", "acceptance", "implementation",
                  "tests", "command")
STORY_OPTIONAL = ("priority", "rev", "amends", "depends_on", "read_first", "design_refs", "constraints", "asvs",
                  "fields", "abuse", "security", "out_of_scope", "tests_to_update")
IMPL_KEYS = ("read", "create", "modify", "pattern", "signatures", "types", "errors", "dependencies")


class Problems:
    def __init__(self, where: str):
        self.where = where
        self.items = []

    def add(self, path: str, msg: str):
        self.items.append(f"{self.where}: {path}: {msg}")


def _as_list(value) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _dedent(text) -> str:
    return textwrap.dedent(str(text or "")).strip("\n").rstrip()


def _bullets(items, empty: str = "- None.") -> str:
    items = [str(i).strip() for i in _as_list(items) if str(i).strip()]
    return "\n".join(f"- {i}" for i in items) if items else empty


def _cells(row: str, count: int):
    cells = [c.strip() for c in re.split(r"(?<!\\)\|", str(row))]
    return cells if len(cells) == count else None


def _table_rows(rows, count: int, problems: Problems, path: str, empty_cells: int) -> str:
    out = []
    for k, row in enumerate(_as_list(rows)):
        cells = _cells(row, count)
        if cells is None:
            problems.add(f"{path}[{k}]", f"expected {count} cells separated by |")
            continue
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out) if out else "| " + " | ".join(["—"] * empty_cells) + " |"


def _check_keys(doc: dict, required, optional, problems: Problems, path: str):
    if not isinstance(doc, dict):
        problems.add(path, "must be a mapping")
        return False
    for key in required:
        if key not in doc or doc[key] is None or doc[key] == "":
            if key not in ("entities",) or key not in doc:
                problems.add(path, f"missing key `{key}`")
    for key in doc:
        if key not in required and key not in optional:
            problems.add(path, f"unknown key `{key}`")
    return True


def is_production_file(path: str) -> bool:
    return not TEST_FILE_RE.search(path) and not CONFIG_FILE_RE.search(path)


class Renderer:
    def __init__(self, out: Path, update: bool, check: bool):
        self.out = out.resolve()
        self.meta = self.out / "_meta"
        self.update = update
        self.check = check
        self.root, self.out_rel, self.design_rel = out_paths(self.out)
        self.index = load_json(self.meta / "index.json", default={}) or {}
        self.model = load_json(self.meta / "model.json", default={}) or {}
        cpath = self.meta / "constraints.md"
        self.constraints = ({r["id"]: r for r in parse_constraints_md(read_text(cpath))}
                            if cpath.exists() else None)
        self.asvs = asvs_lookup.load()
        self.existing = {}
        for f in sorted((self.out / "modules").glob("*/*.md")):
            m = re.match(r"^([A-Z][A-Z0-9]{1,5}-\d{3})-", f.name)
            if m:
                self.existing[m.group(1)] = f
        self.texts = {}
        for f in sorted((self.out / "modules").glob("*/model.md")) + sorted((self.out / "modules").glob("*/model/*.md")):
            for m in re.finditer(r"^- `([^`]+)`: (.+)$", read_text(f), re.M):
                self.texts.setdefault(m.group(1), m.group(2).strip())   # English rules already rendered
        self.known_ids = set(self.existing)
        self.results = []
        self.errors = []

    # ------------------------------------------------------------ helpers
    def english(self, cid: str) -> str:
        if cid in self.texts:
            return self.texts[cid]
        row = (self.constraints or {}).get(cid)
        if row is None:
            return ""
        if row["id"].endswith(":required"):
            return "NOT NULL: " + ", ".join(f"`{r.split('.', 1)[1]}`" for r in row["refs"] if "." in r)
        return row["rule"]

    def entity_fields(self, entity: str):
        return ((self.model.get("entities") or {}).get(entity) or {}).get("fields")

    def sections(self) -> set:
        design = self.index.get("design") or {}
        return set(design.get("sections") or {}) | set(design.get("aliases") or {})

    def retired(self) -> set:
        return set((self.index.get("design") or {}).get("retired") or [])

    def write(self, rel: str, content: str, story: bool):
        path = self.out / rel
        if story:
            if self.check:
                self.results.append(f"would create {rel}")
                return
            status = write_text(path, content)
            self.results.append(f"{status} {rel}")
            return
        if path.exists() and path.read_text(encoding="utf-8") != content and not self.update:
            self.results.append(f"differs (kept; rerun with --update to replace) {rel}")
            return
        if self.check:
            self.results.append(f"would write {rel}")
            return
        self.results.append(f"{write_text(path, content)} {rel}")

    def register(self, key: str, name: str, value: dict):
        if self.check:
            return
        self.index.setdefault(key, {})
        if key == "project":
            self.index["project"] = value
        else:
            self.index[key][name] = value
        write_text(self.meta / "index.json", dump_json(self.index))

    # ------------------------------------------------------------ project
    def project(self, doc: dict, src: str):
        p = Problems(f"{src} (project)")
        _check_keys(doc, PROJECT_REQUIRED, PROJECT_OPTIONAL, p, "project")
        if p.items:
            self.errors.extend(p.items)
            return
        if doc["asvs_level"] not in ("L1", "L2", "L3"):
            p.add("asvs_level", "must be L1, L2 or L3")
        defaults = yaml.safe_load(read_text(ASSETS / "defaults.yaml")) or {}
        agent = defaults.get("target_agent") or {}
        agent_text = doc.get("agent") or f"{agent.get('name')} (`{agent.get('model')}`, {agent.get('effort')} effort)"
        commands = doc["commands"] if isinstance(doc["commands"], dict) else {}
        if not commands:
            p.add("commands", "must be a mapping purpose: command")
        deps = doc["dependencies"] if isinstance(doc["dependencies"], dict) else {}
        dep_lines = []
        for scope, pkgs in deps.items():
            if not isinstance(pkgs, dict) or not pkgs:
                p.add(f"dependencies.{scope}", "must map package: exact version")
                continue
            items = []
            for name, version in pkgs.items():
                if not EXACT_VERSION_RE.match(str(version)):
                    p.add(f"dependencies.{scope}.{name}", f"`{version}` is not an exact version")
                items.append(f"`{name}@{version}`")
            dep_lines.append(f"- {str(scope).capitalize()}: " + ", ".join(items))
        for k, url in enumerate(_as_list(doc["urls"])):
            if not re.match(r"^https?://\S+$", str(url)):
                p.add(f"urls[{k}]", "must be an http(s) URL")
        omit = [str(t) for t in _as_list(doc.get("baseline_omit"))]
        for t in omit:
            if t not in BASELINE_TAGS:
                p.add("baseline_omit", f"unknown tag `{t}` (known: {', '.join(BASELINE_TAGS)})")
        glossary = []
        for k, row in enumerate(_as_list(doc["glossary"])):
            cells = _cells(row, 3)
            if cells is None:
                p.add(f"glossary[{k}]", "expected `term | design term(s) | meaning`")
                continue
            glossary.append(cells)
        glossary.sort(key=lambda c: c[0].lower())

        template = load_template("CONVENTIONS.md")
        kept = []
        for line in template.split("\n"):
            m = re.match(r"^- \[([a-z-]+)\] (.*)$", line)
            if m:
                if m.group(1) not in omit:
                    kept.append("- " + m.group(2))
            else:
                kept.append(line)
        conventions = fill_template("\n".join(kept), {
            "name": doc["name"], "asvs_level": doc["asvs_level"], "stack": _bullets(doc["stack"]),
            "commands": "\n".join(f"| {k} | `{v}` |" for k, v in commands.items()),
            "layout": _bullets(doc["layout"]), "errors": _bullets(doc.get("errors"), ""),
            "logging": _bullets(doc.get("logging"), ""), "validation": _bullets(doc.get("validation"), ""),
            "secrets": _bullets(doc.get("secrets"), ""), "migrations": _bullets(doc.get("migrations"), ""),
            "dependencies": "\n".join(dep_lines), "urls": _bullets(doc["urls"], "- None."),
            "baseline": _bullets(doc.get("baseline"), ""),
            "rules": _bullets(doc.get("rules"), "- None beyond this file."),
        }, "CONVENTIONS.md")
        readme = fill_template(load_template("README.md"), {
            "name": doc["name"], "design": doc["design"], "agent": agent_text, "out": doc["out"]}, "README.md")
        glossary_md = fill_template(load_template("GLOSSARY.md"), {
            "rows": "\n".join("| " + " | ".join(c) + " |" for c in glossary)}, "GLOSSARY.md")
        for name, text, max_lines, max_tokens in (("CONVENTIONS.md", conventions, CONVENTIONS_MAX_LINES, CONVENTIONS_MAX_TOKENS),
                                                  ("README.md", readme, README_MAX_LINES, README_MAX_TOKENS)):
            lines = text.count("\n")
            if lines > max_lines or estimate_tokens(text) > max_tokens:
                p.add(name, f"{lines} lines / ~{estimate_tokens(text)} tokens, over budget ({max_lines} / {max_tokens}): shorten")
        if p.items:
            self.errors.extend(p.items)
            return
        self.write("CONVENTIONS.md", conventions, False)
        self.write("README.md", readme, False)
        self.write("GLOSSARY.md", glossary_md, False)
        self.register("project", "project", {"name": doc["name"], "roles": [str(r) for r in _as_list(doc["roles"])],
                                             "asvs_level": doc["asvs_level"], "agent": agent_text})

    # ------------------------------------------------------------- module
    def collect(self, doc: dict):
        if isinstance(doc, dict) and doc.get("kind") in ("module", "stories"):
            for cid, text in (doc.get("constraints") or {}).items():
                self.texts[str(cid)] = re.sub(r"\s+", " ", str(text)).strip()   # the YAML wins over model.md
            for s in _as_list(doc.get("stories")):
                if isinstance(s, dict) and s.get("id"):
                    self.known_ids.add(str(s["id"]))

    def module(self, doc: dict, src: str):
        p = Problems(f"{src} ({doc.get('module', '?')})")
        _check_keys(doc, MODULE_REQUIRED, MODULE_OPTIONAL, p, "module")
        if p.items:
            self.errors.extend(p.items)
            return
        module, prefix = str(doc["module"]), str(doc["prefix"])
        if not re.match(r"^[a-z][a-z0-9-]*$", module):
            p.add("module", "must be kebab-case")
        if not re.match(r"^[A-Z][A-Z0-9]{1,5}$", prefix):
            p.add("prefix", "must be 2-6 uppercase letters or digits")
        if doc["asvs_level"] not in ("L1", "L2", "L3"):
            p.add("asvs_level", "must be L1, L2 or L3")
        entities = [str(e) for e in _as_list(doc["entities"])]
        known_entities = set((self.model.get("entities") or {}).keys())
        for e in entities:
            if known_entities and e not in known_entities and not doc.get("model"):
                p.add("entities", f"`{e}` is not an entity of the design index")
        if self.constraints is None:
            p.add("constraints", "_meta/constraints.md is missing: run extract_model.py or write it first")
        for cid in (doc.get("constraints") or {}):
            if self.constraints is not None and str(cid) not in self.constraints:
                p.add(f"constraints.{cid}", "unknown constraint ID (not in _meta/constraints.md)")
        if not self.index.get("design"):
            p.add("design", "_meta/index.json has no design index: run index_design.py first")

        stories, seen = [], set()
        for k, s in enumerate(_as_list(doc["stories"])):
            sid = s.get("id", f"stories[{k}]") if isinstance(s, dict) else f"stories[{k}]"
            if sid in seen:
                p.add(sid, "duplicate story ID in this document")
            seen.add(sid)
            if str(sid) in self.existing:
                stories.append((str(sid), None, None))
                continue
            rendered = self.story(s, module, prefix, p, str(sid))
            if rendered:
                stories.append(rendered)

        module_files = self.module_files(doc, module, prefix, entities, p)
        if p.items:
            self.errors.extend(p.items)
            return
        for rel, content in module_files:
            self.write(rel, content, False)
        for sid, rel, content in stories:
            if sid in self.existing:
                self.results.append(f"exists (kept, never overwritten) {self.existing[sid].relative_to(self.out).as_posix()}")
            else:
                self.write(rel, content, True)
        self.register("modules", module, {"prefix": prefix, "title": str(doc["title"]), "entities": entities,
                                          "asvs_level": doc["asvs_level"],
                                          "depends_on": [str(m) for m in _as_list(doc.get("depends_on"))]})

    def stories_only(self, doc: dict, src: str):
        """kind: stories: new stories for an existing module; module files untouched."""
        p = Problems(f"{src} ({doc.get('module', '?')} stories)")
        _check_keys(doc, ("kind", "module", "stories"), ("constraints",), p, "stories")
        info = (self.index.get("modules") or {}).get(str(doc.get("module")))
        if info is None and not p.items:
            p.add("module", f"`{doc.get('module')}` is not a rendered module (_meta/index.json modules)")
        if p.items:
            self.errors.extend(p.items)
            return
        rendered = []
        for k, s in enumerate(_as_list(doc["stories"])):
            sid = str(s.get("id", f"stories[{k}]")) if isinstance(s, dict) else f"stories[{k}]"
            if sid in self.existing:
                self.results.append(f"exists (kept, never overwritten) {self.existing[sid].relative_to(self.out).as_posix()}")
                continue
            out = self.story(s, str(doc["module"]), str(info.get("prefix")), p, sid)
            if out:
                rendered.append(out)
        if p.items:
            self.errors.extend(p.items)
            return
        for sid, rel, content in rendered:
            self.write(rel, content, True)

    def story(self, s, module: str, prefix: str, p: Problems, sid: str):
        if not _check_keys(s, STORY_REQUIRED, STORY_OPTIONAL, p, sid):
            return None
        before = len(p.items)
        m = STORY_ID_RE.match(str(s.get("id", "")))
        if not m:
            p.add(sid, "id must look like ABC-001")
        elif m.group(1) != prefix:
            p.add(sid, f"id prefix must be the module prefix {prefix}")
        for key, allowed in (("kind", KINDS), ("size", SIZES), ("risk", RISKS)):
            if s.get(key) not in allowed:
                p.add(sid, f"{key} must be one of {', '.join(allowed)}")
        if s.get("kind") == "migration" and s.get("risk") != "high":
            p.add(sid, "a migration story is risk: high")
        story_text = re.sub(r"\s+", " ", str(s.get("story", ""))).strip()
        role = ROLE_RE.match(story_text)
        if not (role or story_text.startswith("Technical story:")):
            p.add(f"{sid}.story", "must be `As a <role>, I want <action> so that <benefit>` or start with `Technical story:`")
        roles = [r.lower() for r in (self.index.get("project") or {}).get("roles", [])]
        if role and roles and role.group(1).lower() not in roles:
            p.add(f"{sid}.story", f"role `{role.group(1)}` is not a design role ({', '.join(roles)})")
        depends = [str(d) for d in _as_list(s.get("depends_on"))]
        for d in depends:
            if d not in self.known_ids:
                p.add(f"{sid}.depends_on", f"unknown story {d} (render upstream modules first)")
        read_first = [str(r) for r in _as_list(s.get("read_first"))]
        if len([r for r in read_first if not r.endswith("CONVENTIONS.md")]) > MAX_READ_FIRST:
            p.add(f"{sid}.read_first", f"at most {MAX_READ_FIRST} files besides CONVENTIONS.md")
        amends = [str(a) for a in _as_list(s.get("amends"))]
        for a in amends:
            if a not in self.known_ids:
                p.add(f"{sid}.amends", f"unknown story {a}")
        if s.get("kind") in ("change", "removal") and not amends:
            p.add(f"{sid}.amends", f"a {s.get('kind')} story names the story it amends")
        history = self.retired() if s.get("kind") in ("change", "migration", "removal") else set()
        sections = self.sections()
        design_refs = [str(r) for r in _as_list(s.get("design_refs"))]
        for ref in design_refs:
            if ref not in sections and f"section:{ref}" not in history:
                p.add(f"{sid}.design_refs", f"anchor `{ref}` is not in the design index")
        constraints = [str(c) for c in _as_list(s.get("constraints"))]
        for cid in constraints:
            if f"constraint:{cid}" in history and (self.constraints is None or cid not in self.constraints):
                self.texts[cid] = "retired from the design"
            elif self.constraints is not None and cid not in self.constraints:
                p.add(f"{sid}.constraints", f"unknown constraint {cid}")
            elif self.constraints is not None:
                text = self.english(cid)
                if cid not in self.texts and FRENCH_RE.search(text):
                    p.add(f"{sid}.constraints", f"{cid} has no English rule: add it to the `constraints:` map of its module")
        asvs = [str(a) for a in _as_list(s.get("asvs"))]
        for a in asvs:
            if not ASVS_ID_RE.match(a) or a not in self.asvs:
                p.add(f"{sid}.asvs", f"`{a}` is not an ASVS 5.0.0 ID (v5.0.0-<chapter>.<section>.<req>)")

        # context, with inlined fields and constraints
        ctx = [l.rstrip() for l in _dedent(s.get("context")).split("\n") if l.strip()]
        grouped = {}
        for ref in _as_list(s.get("fields")):
            ent, _, fname = str(ref).partition(".")
            fields = self.entity_fields(ent)
            if fields is None:
                p.add(f"{sid}.fields", f"`{ref}`: unknown entity")
                continue
            names = [n.strip() for n in fname.strip("{}").split(",")] if fname else [f["name"] for f in fields]
            for name in names:
                spec = next((f for f in fields if f["name"] == name), None)
                if spec is None:
                    p.add(f"{sid}.fields", f"`{ent}.{name}` is not in the design")
                    continue
                grouped.setdefault(ent, []).append(f"`{name}` {spec.get('type') or '?'}")
        for ent, parts in grouped.items():
            ctx.append(f"- `{ent}` fields: " + "; ".join(parts))
        for cid in constraints:
            ctx.append(f"- `{cid}`: {self.english(cid)}")
        if len(ctx) > MAX_CONTEXT_LINES:
            p.add(f"{sid}.context", f"{len(ctx)} lines with inlined fields and constraints; max {MAX_CONTEXT_LINES}")

        # acceptance and abuse cases
        ac_labels = self.gherkin_labels(s.get("acceptance"), "AC", p, f"{sid}.acceptance")
        if not ac_labels:
            p.add(f"{sid}.acceptance", "needs at least one `Scenario: AC-1 ...`")
        if len(ac_labels) > MAX_ACCEPTANCE:
            p.add(f"{sid}.acceptance", f"{len(ac_labels)} acceptance criteria; max {MAX_ACCEPTANCE}: split the story")
        ab_labels = self.gherkin_labels(s.get("abuse"), "AB", p, f"{sid}.abuse")
        if not ab_labels and (s.get("kind") == "feature" or s.get("risk") == "high"):
            p.add(f"{sid}.abuse", "feature and risk: high stories need abuse cases (AB-n)")

        # implementation
        impl = s.get("implementation") if isinstance(s.get("implementation"), dict) else {}
        for key in impl:
            if key not in IMPL_KEYS:
                p.add(f"{sid}.implementation", f"unknown key `{key}` (known: {', '.join(IMPL_KEYS)})")
        creates, modifies = [str(x) for x in _as_list(impl.get("create"))], [str(x) for x in _as_list(impl.get("modify"))]
        if not creates and not modifies:
            p.add(f"{sid}.implementation", "needs `create` or `modify`")
        for path in creates + modifies + [str(x) for x in _as_list(impl.get("read"))] + read_first + _as_list(impl.get("pattern")):
            if str(path).startswith("/") or ".." in Path(str(path)).parts:
                p.add(f"{sid}.implementation", f"`{path}` must be relative to the project root")
        production = [f for f in creates + modifies if is_production_file(f)]
        if len(production) > MAX_PRODUCTION_FILES:
            p.add(f"{sid}.implementation", f"{len(production)} production files; max {MAX_PRODUCTION_FILES}: split the story")

        # security
        security_lines = []
        for k, item in enumerate(_as_list(s.get("security"))):
            sm = SECURITY_ITEM_RE.match(str(item).strip())
            if not sm:
                p.add(f"{sid}.security[{k}]", "must start with its ASVS ID: `v5.0.0-x.y.z: rule`")
                continue
            for a in re.split(r"\s*,\s*", sm.group(1)):
                if a not in asvs:
                    p.add(f"{sid}.security[{k}]", f"{a} is not listed in `asvs`")
            security_lines.append(f"- {sm.group(1)}: {sm.group(2).strip()}")

        # tests
        test_rows, covered = [], set()
        known_cover = set(ac_labels) | set(ab_labels) | set(constraints) | set(asvs)
        all_constraints = set(self.constraints or {})
        for k, row in enumerate([r for r in _dedent(s.get("tests")).split("\n") if r.strip()]):
            cells = _cells(row.strip().strip("|"), 4)
            if cells is None:
                p.add(f"{sid}.tests[{k}]", "expected `name | level | covers | input → expected`")
                continue
            if cells[1] not in TEST_LEVELS:
                p.add(f"{sid}.tests[{k}]", f"level must be one of {', '.join(TEST_LEVELS)}")
            tokens = [t.strip() for t in cells[2].split(",") if t.strip()]
            if not tokens:
                p.add(f"{sid}.tests[{k}]", "covers is empty")
            for t in tokens:
                if t in known_cover or WSTG_RE.match(t) or CWE_RE.match(t):
                    covered.add(t)
                elif t in all_constraints:
                    p.add(f"{sid}.tests[{k}]", f"covers {t}: add it to the story's `constraints` too")
                else:
                    p.add(f"{sid}.tests[{k}]", f"covers unknown ID `{t}`")
            test_rows.append("| " + " | ".join(cells) + " |")
        for label in ac_labels + ab_labels + constraints:
            if label not in covered:
                p.add(f"{sid}.tests", f"{label} has no test")
        if not str(s.get("command") or "").strip():
            p.add(f"{sid}.command", "the exact command that runs the story's tests is required")
        tests_md = ("| name | level | covers | input → expected |\n|---|---|---|---|\n" + "\n".join(test_rows)
                    + f"\n\nCommand: `{str(s.get('command', '')).strip()}`")
        if s.get("tests_to_update"):
            tests_md += ("\n\n### Tests to update\n| existing test | reason | new expectation |\n|---|---|---|\n"
                         + _table_rows(s.get("tests_to_update"), 3, p, f"{sid}.tests_to_update", 3))

        if len(p.items) > before:
            return None
        title = re.sub(r"\s+", " ", str(s["title"])).strip()
        front = {"id": s["id"], "title": title, "module": module, "kind": s["kind"], "rev": int(s.get("rev", 1)),
                 "amends": amends, "priority": s.get("priority"),
                 "size": s["size"], "risk": s["risk"], "depends_on": depends, "read_first": read_first,
                 "design_refs": design_refs, "constraints": constraints, "asvs": asvs}
        template = load_template("story.md")
        if front["priority"] in (None, ""):
            template = template.replace("priority: {{priority}}\n", "")
            front.pop("priority")
        values = {k: yaml_inline(v) for k, v in front.items()}
        values.update({
            "id_text": s["id"], "title_text": title, "story": story_text, "context": "\n".join(ctx),
            "acceptance": "```gherkin\n" + _dedent(s["acceptance"]) + "\n```",
            "abuse": ("```gherkin\n" + _dedent(s["abuse"]) + "\n```") if ab_labels else "None: no protected resource or action.",
            "implementation": self.implementation(impl),
            "security": "\n".join(security_lines) or "- None beyond CONVENTIONS.md.",
            "tests": tests_md, "out_of_scope": _bullets(s.get("out_of_scope"), "- Nothing beyond this story."),
        })
        content = fill_template(template, values, f"{sid} (story.md)")
        lines = content.count("\n")
        if lines > STORY_MAX_LINES or estimate_tokens(content) > STORY_MAX_TOKENS:
            p.add(sid, f"{lines} lines / ~{estimate_tokens(content)} tokens, over budget "
                       f"({STORY_MAX_LINES} / {STORY_MAX_TOKENS}): split it (SPIDR) or cut lines")
            return None
        return str(s["id"]), f"modules/{module}/{s['id']}-{slugify(title, 48)}.md", content

    @staticmethod
    def gherkin_labels(block, kind: str, p: Problems, path: str) -> list:
        labels = []
        for line in _dedent(block).split("\n"):
            m = SCENARIO_RE.match(line)
            if not m:
                continue
            lm = LABEL_RE.match(m.group(1).strip())
            if not lm or lm.group(1) != kind:
                p.add(path, f"scenario `{m.group(1).strip()[:40]}` must start with its label {kind}-n")
                continue
            labels.append(f"{kind}-{int(lm.group(2))}")
        expected = [f"{kind}-{i}" for i in range(1, len(labels) + 1)]
        if labels != expected:
            p.add(path, f"labels must be {kind}-1..{kind}-{len(labels)} in order, got {', '.join(labels)}")
        return labels

    @staticmethod
    def implementation(impl: dict) -> str:
        out = []
        for key, label in (("read", "Read"), ("create", "Create"), ("modify", "Modify")):
            items = _as_list(impl.get(key))
            if items:
                out.append(f"- {label}: " + ", ".join(f"`{i}`" for i in items))
        if impl.get("pattern"):
            out.append(f"- Pattern: `{impl['pattern']}`")
        for key, label in (("signatures", "Signatures"), ("types", "Types")):
            items = _as_list(impl.get(key))
            if items:
                out.append(f"- {label}:")
                out.extend(f"  - `{i}`" for i in items)
        errors = _as_list(impl.get("errors"))
        if errors:
            out.append("- Errors: " + ", ".join(re.sub(r"^(\S+)", r"`\1`", str(e).strip()) for e in errors))
        deps = _as_list(impl.get("dependencies"))
        out.append("- Dependencies: " + (", ".join(f"`{d}`" for d in deps) if deps else "none added"))
        return "\n".join(out)

    def module_files(self, doc: dict, module: str, prefix: str, entities: list, p: Problems) -> list:
        files = []
        model_entities = self.model.get("entities") or {}
        entity_lines = []
        for e in entities:
            anchor = (model_entities.get(e) or {}).get("anchor")
            entity_lines.append(f"- `{e}`" + (f" (design `{anchor}`)" if anchor else ""))
        blocks = self.model_blocks(entities, doc, p)
        split = sum(b.count("\n") + 2 for _, b in blocks) + 6 > MODULE_FILE_MAX_LINES
        model_pointer = "`model.md` (one file per entity in `model/`)" if split else "`model.md`"
        pointers = _as_list(doc.get("pointers")) or [f"Conventions: `{self.out_rel}/CONVENTIONS.md`"]
        module_md = fill_template(load_template("MODULE.md"), {
            "title": doc["title"], "module": module, "responsibility": _dedent(doc["responsibility"]),
            "prefix": prefix, "asvs_level": doc["asvs_level"], "asvs_rationale": str(doc["asvs_rationale"]).strip(),
            "depends_on": ", ".join(f"`{m}`" for m in _as_list(doc.get("depends_on"))) or "none",
            "model_pointer": model_pointer, "entities": "\n".join(entity_lines) or "- None (technical module).",
            "classification": _table_rows(doc.get("classification"), 3, p, "classification", 3),
            "threats": _table_rows(doc.get("threats"), 5, p, "threats", 5),
            "pointers": _bullets(pointers),
        }, f"{module}/MODULE.md")
        files.append((f"modules/{module}/MODULE.md", module_md))
        contracts = doc.get("contracts") or {}
        provides = []
        for k, c in enumerate(_as_list(contracts.get("provides"))):
            if not isinstance(c, dict) or not c.get("name"):
                p.add(f"contracts.provides[{k}]", "needs name, file, items (and story, used_by)")
                continue
            head = f"### {c['name']}"
            if c.get("file"):
                head += f" (`{c['file']}`"
                head += f", created by {c['story']})" if c.get("story") else ")"
            provides.append(head)
            for item in _as_list(c.get("items")):
                sig, sep, desc = str(item).partition(" — ")
                provides.append(f"- `{sig.strip()}`" + (f": {desc.strip()}" if sep else ""))
            if c.get("used_by"):
                provides.append("- Used by: " + ", ".join(f"`{u}`" for u in _as_list(c["used_by"])))
        contracts_md = fill_template(load_template("contracts.md"), {
            "module": module, "provides": "\n".join(provides) or "- Nothing yet.",
            "consumes": _bullets(contracts.get("consumes"), "- Nothing."),
        }, f"{module}/contracts.md")
        files.append((f"modules/{module}/contracts.md", contracts_md))
        if split:
            index_lines = [f"- `{e}`: `model/{e}.md`" for e, _ in blocks]
            files.append((f"modules/{module}/model.md",
                          fill_template(load_template("model.md"), {"module": module, "entities": "\n".join(index_lines)},
                                        f"{module}/model.md")))
            for e, block in blocks:
                files.append((f"modules/{module}/model/{e}.md",
                              fill_template(load_template("model.md"), {"module": f"{module} / {e}", "entities": block},
                                            f"{module}/model/{e}.md")))
        else:
            files.append((f"modules/{module}/model.md",
                          fill_template(load_template("model.md"), {
                              "module": module, "entities": "\n\n".join(b for _, b in blocks) or "No owned entity."},
                              f"{module}/model.md")))
        for rel, content in files:
            if content.count("\n") > MODULE_FILE_MAX_LINES or estimate_tokens(content) > MODULE_FILE_MAX_TOKENS:
                p.add(rel, f"{content.count(chr(10))} lines / ~{estimate_tokens(content)} tokens, over budget "
                           f"({MODULE_FILE_MAX_LINES} / {MODULE_FILE_MAX_TOKENS})")
        return files

    def model_blocks(self, entities: list, doc: dict, p: Problems) -> list:
        blocks = []
        model_entities = self.model.get("entities") or {}
        rows = list((self.constraints or {}).values())
        for e in entities:
            spec = model_entities.get(e)
            if spec is None:
                if doc.get("model"):
                    continue
                p.add("entities", f"`{e}` has no extracted model: add a `model:` block")
                continue
            lines = [f"## {e}", f"Design: `{spec.get('anchor')}`", "",
                     "| field | type | constraints |", "|---|---|---|"]
            mine = [r for r in rows if any(ref == e or ref.startswith(e + ".") for ref in r["refs"])]
            for f in spec["fields"]:
                ids = [r["id"] for r in mine if f"{e}.{f['name']}" in r["refs"] and not r["id"].endswith(":required")]
                lines.append(f"| {f['name']} | {str(f.get('type') or '?').replace('|', '/')} | {', '.join(ids)} |")
            lines.append("")
            for r in mine:
                text = self.english(r["id"])
                if r["id"] not in self.texts and FRENCH_RE.search(text):
                    p.add(f"constraints.{r['id']}", "no English rule: add it to this module's `constraints:` map")
                lines.append(f"- `{r['id']}`: {text}")
            blocks.append((e, "\n".join(lines).rstrip()))
        if doc.get("model"):
            blocks.append(("extra", _dedent(doc["model"])))
        return blocks


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("yaml", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--update", action="store_true", help="replace differing module and project files")
    ap.add_argument("--check", action="store_true", help="validate and report; write nothing")
    args = ap.parse_args(argv)
    try:
        r = Renderer(Path(args.out), args.update, args.check)
        documents = []
        for path in args.yaml:
            for doc in load_yaml_documents(Path(path)):
                documents.append((Path(path).name, doc))
        for _, doc in documents:
            r.collect(doc)
        for src, doc in documents:
            kind = doc.get("kind") if isinstance(doc, dict) else None
            if kind == "project":
                r.project(doc, src)
            elif kind == "module":
                r.module(doc, src)
            elif kind == "stories":
                r.stories_only(doc, src)
            else:
                r.errors.append(f"{src}: document needs `kind: project`, `kind: module` or `kind: stories`")
    except DtusError as exc:
        print(f"ERROR: {exc}")
        return 1
    for line in r.results:
        print(line)
    for line in r.errors:
        print(f"ERROR {line}")
    created = sum(1 for x in r.results if x.startswith(("created", "would create")))
    print(f"render: {created} created, {sum(1 for x in r.results if x.startswith('exists'))} kept, "
          f"{len(r.errors)} errors")
    return 1 if r.errors else 0


if __name__ == "__main__":
    sys.exit(main())
