#!/usr/bin/env python3
"""Diff the design against the SYNC baseline, element by element, and apply
the mechanical part of the change.

Usage: diff_design.py <design.md> --out <folder> [--print | --check]

Baseline: the git commit recorded in STORY_MAP.md (`git show <commit>:<path>`),
else _meta/baseline/design.md. Elements: sections (by anchor), entities, fields
(one table row each), constraints (one rule row each, by ID) and prose blocks.
Formatting is normalized first (whitespace, wrapping, bullets, emphasis, code
ticks, table alignment, HTML comments), so formatting-only edits are no change.

Without options it writes:
- mechanical changes, applied here: renamed or moved headings become aliases
  in _meta/index.json, and the `design_refs` line of every todo story citing
  the old anchor is rewritten (other stories keep resolving through the alias);
  backticked anchors in module files and _meta/src/*.yaml follow;
- the current design's index, _meta/constraints.md (Manual section kept) and
  _meta/model.json; removed elements are listed in the index `retired` list;
- _meta/sync.json: the story snapshot the sync is checked against;
- the semantic changes, as a journal in the Pending changes section of
  STORY_MAP.md (kind, element, lines, impacted stories with their status).
  Items already checked off keep their mark: an interrupted run resumes.
When nothing semantic is left it runs build_backlog.py (re-baseline) and
prints "in sync". --print writes nothing (the --plan of SYNC). --check writes
nothing and exits 1 when the stories are out of sync (CI, pre-commit hook).
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import re
import subprocess
import sys
from pathlib import Path

import yaml

from common import (FROZEN_STATUSES, SYNC_FILE, STORY_ID_RE, DtusError, dump_json, load_json, manual_blocks,
                    normalize, out_paths, parse_status, pending_items, pending_section, read_design, read_text,
                    rel_to, replace_pending, sha256_file, design_sha256, INCLUDE_LINE, short_hash, split_front_matter,
                    write_text, yaml_inline)
from designparse import analyze, design_index, manual_block_of, model_json, render_constraints_md

EMPTY_HASH = short_hash("")
STORY_FILE_RE = re.compile(r"^([A-Z][A-Z0-9]{1,5}-\d{3})-.+\.md$")
LIST_START_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
EXCERPT = 240


# ------------------------------------------------------------------ baseline

def story_map_facts(out: Path) -> dict:
    """design path, sha256 and commit recorded in STORY_MAP.md."""
    path = out / "STORY_MAP.md"
    if not path.exists():
        raise DtusError("STORY_MAP.md not found: SYNC needs a backlog made by INIT")
    text = read_text(path)
    m = re.search(r"^- Design: `([^`]*)` · sha256 `([0-9a-f]*)` · commit `([^`]*)`", text, re.M)
    if not m:
        raise DtusError("STORY_MAP.md has no `- Design:` line: rerun build_backlog.py")
    return {"design": m.group(1), "sha256": m.group(2), "commit": m.group(3), "text": text}


def load_baseline(out: Path, root: Path, facts: dict):
    """(baseline text, source label). Git commit first, else _meta/baseline/design.md."""
    commit = facts["commit"]
    if re.fullmatch(r"[0-9a-f]{7,40}", commit):
        try:
            proc = subprocess.run(["git", "-C", str(root), "show", f"{commit}:{facts['design']}"],
                                  capture_output=True, timeout=20)
            if proc.returncode == 0:
                text = proc.stdout.decode("utf-8").replace("\r\n", "\n")
                if not INCLUDE_LINE.search(text):   # an entry file: its expanded copy is below
                    return text, f"git {commit[:12]}:{facts['design']}"
        except (OSError, subprocess.SubprocessError, UnicodeDecodeError):
            pass
    path = out / "_meta" / "baseline" / "design.md"
    if not path.exists():
        raise DtusError("no baseline: neither the recorded git commit nor _meta/baseline/design.md is available")
    return read_text(path), "_meta/baseline/design.md"


def baseline_rule_ids(out: Path) -> dict:
    """rule hash -> constraint ID, from the baseline index (IDs as INIT assigned them)."""
    index = load_json(out / "_meta" / "baseline" / "index.json", default={}) or {}
    return {v["hash"]: k.split(":", 1)[1] for k, v in (index.get("elements") or {}).items()
            if k.startswith("constraint:") and isinstance(v, dict) and v.get("hash")}


# ----------------------------------------------------------------- snapshots

class Snapshot:
    """One side of the diff: sections, entities, fields, rules and prose blocks."""

    def __init__(self, analysis):
        self.a = analysis
        self.lines = analysis.lines
        self.sections = {s.anchor: s for s in analysis.sections}
        self.entities = dict(analysis.model.entities)
        self.fields = {f"{e.name}.{f.name}": f for e in analysis.model.entities.values() for f in e.fields}
        self.rules = {c.id: c for c in analysis.constraints if c.kind == "rule"}
        self.constraints = analysis.constraints
        owned = set()
        for f in self.fields.values():
            owned.add(f.line)
        for c in self.rules.values():
            owned.add(c.line)
        for e in self.entities.values():
            owned.update((e.table_line, e.table_line + 1))
        for t in analysis.tables:
            header = [re.sub(r"[^a-z]", "", h.lower()) for h in t.header]
            if t.rows and all(ln in owned for ln, _ in t.rows):
                owned.update((t.start, t.start + 1))
            elif header and header[0] in ("contrainte", "constraint", "rule", "regle", "invariant"):
                owned.update((t.start, t.start + 1))
        self.owned = owned

    def row(self, c) -> str:
        """Normalized source line of a rule (rule and rationale columns)."""
        return normalize(self.lines[c.line - 1])

    def blocks(self, anchor: str) -> list:
        """Prose blocks of a section's own content: (first, last, normalized, raw)."""
        s = self.sections[anchor]
        out, cur = [], None
        mask_start = s.start + 1 if s.level else 1
        for n in range(mask_start, s.own_end + 1):
            line = self.lines[n - 1]
            stripped = line.strip()
            if n in self.owned or not stripped or re.fullmatch(r"(=+|-{2,})", stripped):
                cur = None
                continue
            starts = LIST_START_RE.match(line) or stripped.startswith("|") or cur is None
            if starts or (cur is not None and self.lines[cur[1] - 1].strip().startswith("|")):
                cur = [n, n, [stripped]]
                out.append(cur)
            else:
                cur[1] = n
                cur[2].append(stripped)
        return [(b[0], b[1], normalize(" ".join(b[2])), " ".join(b[2])) for b in out]


def _excerpt(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= EXCERPT else text[:EXCERPT - 1] + "…"


def looks_like_wording(old: str, new: str) -> bool:
    """True when old -> new only fixes spelling: same words but at most two, each
    close to the original, no digit or identifier changed."""
    a, b = re.findall(r"\w+", old), re.findall(r"\w+", new)
    if len(a) != len(b) or a == b:
        return False
    changed = [(x, y) for x, y in zip(a, b) if x != y]
    if len(changed) > 2:
        return False
    for x, y in changed:
        if re.search(r"\d", x + y) or "_" in x + y or x.isupper() or y.isupper():
            return False
        if difflib.SequenceMatcher(None, x.lower(), y.lower()).ratio() < 0.75:
            return False
    return True


# ------------------------------------------------------------ section match

def _parent(anchor: str) -> str:
    return anchor.rsplit("/", 1)[0] if "/" in anchor else ""


def _title_key(title: str) -> str:
    return normalize(re.sub(r"^\s*(?:\d+(?:\.\d+)*\.?|[A-Z](?:\.\d+)+\.?)\s+", "", title)).lower()


def match_sections(old: Snapshot, new: Snapshot):
    """old anchor -> new anchor, and the renames [(old, new, 'rename' | 'move')]."""
    mapping = {a: a for a in old.sections if a in new.sections}
    uo = [a for a in old.sections if a not in mapping]
    un = [a for a in new.sections if a not in set(mapping.values())]

    def pair(o, n):
        mapping[o] = n
        uo.remove(o)
        un.remove(n)
        # children follow a renamed parent
        for child in sorted([c for c in uo if c.startswith(o + "/")], key=len):
            candidate = n + child[len(o):]
            if candidate in un:
                pair(child, candidate)

    def unique_pairs(key):
        ko, kn = {}, {}
        for o in uo:
            ko.setdefault(key(old, o), []).append(o)
        for n in un:
            kn.setdefault(key(new, n), []).append(n)
        return [(os_[0], kn[k][0]) for k, os_ in ko.items() if k is not None and len(os_) == 1
                and len(kn.get(k, [])) == 1]

    def full(snap, a):
        s = snap.sections[a]
        return (s.level, s.full_hash) if s.full_hash != EMPTY_HASH else None

    def own(snap, a):
        s = snap.sections[a]
        return (s.level, s.hash) if s.hash != EMPTY_HASH else None

    def title(snap, a):
        s = snap.sections[a]
        return (s.level, _title_key(s.title))

    for key in (full, own, title):
        for o, n in sorted(unique_pairs(key), key=lambda p: old.sections[p[0]].level):
            if o in uo and n in un:
                pair(o, n)
    # same parent (after mapping), same level, similar title: renamed and edited
    for o in sorted(list(uo), key=lambda a: old.sections[a].level):
        so = old.sections[o]
        best, best_ratio = None, 0.5
        for n in un:
            sn = new.sections[n]
            if sn.level != so.level or mapping.get(_parent(o), _parent(o)) != _parent(n):
                continue
            ratio = difflib.SequenceMatcher(None, _title_key(so.title), _title_key(sn.title)).ratio()
            if ratio > best_ratio:
                best, best_ratio = n, ratio
        if best is not None:
            pair(o, best)
    renames = []
    for o, n in sorted(mapping.items()):
        if o != n:
            kind = "move" if mapping.get(_parent(o), _parent(o)) != _parent(n) else "rename"
            renames.append((o, n, kind))
    return mapping, renames


# --------------------------------------------------------------- the stories

def load_stories(out: Path) -> dict:
    """Front matter, status, inlined fields and hashes of every story file.

    hand_edited: the file differs from its hash in the index, so a human edited
    it. During an open sync the answer recorded when the sync opened is kept,
    since the skill's own edits also change the hash."""
    index = load_json(out / "_meta" / "index.json", default={}) or {}
    known = index.get("stories") or {}
    sync = load_json(out / SYNC_FILE, default=None) or {}
    recorded = set(sync.get("hand_edited") or []) if sync.get("status") == "open" else None
    status_path = out / "STATUS.md"
    status = parse_status(read_text(status_path)) if status_path.exists() else {}
    stories = {}
    for path in sorted((out / "modules").glob("*/*.md")):
        m = STORY_FILE_RE.match(path.name)
        if not m:
            continue
        text = read_text(path)
        try:
            fm, body, _ = split_front_matter(text)
        except DtusError:
            fm, body = {}, text
        sid = str(fm.get("id") or m.group(1))
        inlined = set()
        for line in body.split("\n"):
            fm_line = re.match(r"^- `([A-Za-z_]\w*)` fields: (.*)$", line)
            if fm_line:
                inlined.update(f"{fm_line.group(1)}.{n}" for n in re.findall(r"`(\w+)`", fm_line.group(2)))
        sha = sha256_file(path)
        stories[sid] = {
            "path": path, "rel": path.relative_to(out).as_posix(), "fm": fm, "sha256": sha,
            "status": status.get(sid, {}).get("status", "todo"), "inlined": inlined,
            "manual": manual_blocks(text),
            "hand_edited": (sid in recorded) if recorded is not None
            else bool(known.get(sid)) and known[sid].get("sha256") != sha,
        }
    return stories


def _list(fm: dict, key: str) -> list:
    value = fm.get(key) or []
    return [str(v) for v in value] if isinstance(value, list) else [str(value)]


# ---------------------------------------------------------------------- diff

class Diff:
    def __init__(self, old: Snapshot, new: Snapshot, stories: dict, modules: dict):
        self.old, self.new, self.stories, self.modules = old, new, stories, modules
        self.mapping, self.renames = match_sections(old, new)
        self.items = []
        self.retired = []
        self._compare()

    # impact helpers
    def _cites(self, pred) -> list:
        return sorted(sid for sid, s in self.stories.items()
                      if s["status"] != "obsolete" and pred(s))

    def _field_impact(self, key: str, table_story: bool = False) -> list:
        """Stories that inline the field or cite a constraint on it; with
        table_story, also those citing `<Entity>:required` (they create the table)."""
        entity = key.split(".")[0]
        cids = {c.id for side in (self.old, self.new) for c in side.constraints if key in c.refs}
        if table_story:
            cids.add(f"{entity}:required")
        return self._cites(lambda s: key in s["inlined"] or cids & set(_list(s["fm"], "constraints")))

    def _anchor_impact(self, anchors) -> list:
        anchors = set(anchors)
        return self._cites(lambda s: anchors & set(_list(s["fm"], "design_refs")))

    def _owner(self, entity: str):
        for name, info in self.modules.items():
            if entity in (info.get("entities") or []):
                return name
        return None

    def add(self, kind: str, element: str, lines: str, impacts: list, details: list, hint: str = ""):
        key = "|".join([kind, element] + details)
        pid = "P-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:8]
        self.items.append({"id": pid, "kind": kind, "element": element, "lines": lines,
                           "impacts": impacts, "details": details, "hint": hint})

    # comparison
    def _compare(self):
        old, new = self.old, self.new
        added_entities = [e for e in new.entities if e not in old.entities]
        for e in added_entities:
            ent = new.entities[e]
            sec = new.sections.get(ent.anchor)
            fks = sorted({f.fk for f in ent.fields if f.fk})
            owners = [f"{t} ({self._owner(t) or 'new'})" for t in fks]
            rules = sorted(c.id for c in new.rules.values() if c.refs and c.refs != ["*"]
                           and all(r.split(".")[0] in added_entities for r in c.refs))
            details = [f"fields: {', '.join(f.name for f in ent.fields)}"]
            if owners:
                details.append("references: " + ", ".join(owners))
            if rules:
                details.append("constraints: " + ", ".join(rules))
            self.add("entity added", e, f"L{sec.start}-{sec.end}" if sec else f"L{ent.line}", [], details)
        for e in old.entities:
            if e not in new.entities:
                ent = old.entities[e]
                cids = {c.id for c in old.constraints if any(r.split(".")[0] == e for r in c.refs)}
                impacts = self._cites(lambda s, e=e: any(f.startswith(e + ".") for f in s["inlined"])
                                      or cids & set(_list(s["fm"], "constraints")))
                impacts = sorted(set(impacts) | set(self._anchor_impact([ent.anchor])))
                self.add("entity removed", e, f"baseline L{ent.line}", impacts, [])
                self.retired.append(f"entity:{e}")
        for key, f in new.fields.items():
            entity = key.split(".")[0]
            if entity in added_entities:
                continue
            before = old.fields.get(key)
            row = _excerpt(new.lines[f.line - 1])
            if before is None:
                self.add("field added", key, f"L{f.line}", self._field_impact(key, True), [f"now: {row}"])
            elif before.row_hash != f.row_hash:
                was = _excerpt(old.lines[before.line - 1])
                self.add("field changed", key, f"L{f.line}", self._field_impact(key),
                         [f"was: {was}", f"now: {row}"], "wording" if looks_like_wording(was, row) else "")
        for key, f in old.fields.items():
            if key not in new.fields and key.split(".")[0] in new.entities:
                self.add("field removed", key, f"baseline L{f.line}", self._field_impact(key, True),
                         [f"was: {_excerpt(old.lines[f.line - 1])}"])
                self.retired.append(f"field:{key}")
        for cid, c in new.rules.items():
            before = old.rules.get(cid)
            if before is None:
                if c.refs != ["*"] and all(r.split(".")[0] in added_entities for r in c.refs):
                    continue   # folded into its "entity added" item
                refs = set(c.refs) - {"*"}
                related = {x.id for side in (old, new) for x in side.constraints
                           if x.id != cid and refs & set(x.refs)}
                impacts = self._cites(lambda s: related & set(_list(s["fm"], "constraints")))
                self.add("constraint added", cid, f"L{c.line}", impacts, [f"now: {_excerpt(c.rule)}"])
            elif before.hash != c.hash or old.row(before) != new.row(c):
                was, now = old.lines[before.line - 1], new.lines[c.line - 1]
                hint = ("only the rationale changed" if before.hash == c.hash
                        else "wording" if looks_like_wording(before.rule, c.rule) else "")
                self.add("constraint changed", cid, f"L{c.line}",
                         self._cites(lambda s, cid=cid: cid in _list(s["fm"], "constraints")),
                         [f"was: {_excerpt(was)}", f"now: {_excerpt(now)}"], hint)
        for cid, c in old.rules.items():
            if cid not in new.rules:
                self.add("constraint removed", cid, f"baseline L{c.line}",
                         self._cites(lambda s, cid=cid: cid in _list(s["fm"], "constraints")),
                         [f"was: {_excerpt(c.rule)}"])
                self.retired.append(f"constraint:{cid}")
        for c in old.constraints:
            if c.kind != "rule" and c.id not in {x.id for x in new.constraints}:
                self.retired.append(f"constraint:{c.id}")
        mapped_new = set(self.mapping.values())
        entity_anchors = {e.anchor for e in new.entities.values() if e.name in added_entities}
        for n, s in new.sections.items():
            if n not in mapped_new and n not in entity_anchors and not any(
                    n.startswith(a + "/") for a in entity_anchors):
                self.add("section added", n, f"L{s.start}-{s.end}", [], [f"title: {s.title}"])
        for o, s in old.sections.items():
            if o not in self.mapping:
                if not any(e.anchor == o for e in old.entities.values() if e.name not in new.entities):
                    self.add("section removed", o, f"baseline L{s.start}-{s.end}", self._anchor_impact([o]),
                             [f"title: {s.title}"])
                self.retired.append(f"section:{o}")
        for o, n in sorted(self.mapping.items(), key=lambda p: new.sections[p[1]].start):
            if old.sections[o].hash == new.sections[n].hash:
                continue
            ob, nb = old.blocks(o), new.blocks(n)
            sm = difflib.SequenceMatcher(None, [b[2] for b in ob], [b[2] for b in nb], autojunk=False)
            for tag, i1, i2, j1, j2 in sm.get_opcodes():
                if tag == "equal":
                    continue
                was = " / ".join(b[3] for b in ob[i1:i2])
                now = " / ".join(b[3] for b in nb[j1:j2])
                if j2 > j1:
                    first, last = nb[j1][0], nb[j2 - 1][1]
                    lines = f"L{first}" if first == last else f"L{first}-{last}"
                else:
                    at = nb[j1][0] if j1 < len(nb) else new.sections[n].own_end
                    lines = f"L{at}"
                details = ([f"was: {_excerpt(was)}"] if was else []) + ([f"now: {_excerpt(now)}"] if now else [])
                impacts = self._anchor_impact({n, o})
                hint = "wording" if was and now and looks_like_wording(was, now) else (
                    "" if impacts else "no story cites this section: cross-cutting?")
                self.add("text changed", n, lines, impacts, details, hint)

    def semantic(self) -> bool:
        return bool(self.items)


# -------------------------------------------------------------------- output

def item_line(item: dict, stories: dict, checked=False, note: str = "") -> list:
    def who(sid):
        s = stories[sid]
        return f"{sid} ({s['status']}{', edited by hand' if s['hand_edited'] else ''})"
    impacts = ", ".join(who(i) for i in item["impacts"]) or "none"
    head = (f"- [{'x' if checked else ' '}] {item['id']} · {item['kind']} · {item['element']} · "
            f"{item['lines']} · impacts: {impacts}")
    if item["hint"]:
        head += f" · hint: {item['hint']}"
    if note:
        head += f" → {note}"
    return [head] + [f"  - {d}" for d in item["details"]]


def pending_body(diff: Diff, previous: dict, base_sha: str, design_sha: str) -> str:
    lines = [f"Sync from baseline `{base_sha[:16]}` to design `{design_sha[:16]}`. Apply each item, then "
             "check it off and append ` → <what you did>`. build_backlog.py clears this list once every "
             "item is checked.", ""]
    for item in diff.items:
        checked, note = previous.get(item["id"], (False, ""))
        lines += item_line(item, diff.stories, checked, note)
    return "\n".join(lines)


def next_free_ids(stories: dict, modules: dict) -> list:
    out = []
    for name, info in sorted(modules.items()):
        prefix = info.get("prefix")
        numbers = [int(STORY_ID_RE.match(s).group(2)) for s in stories if s.startswith(f"{prefix}-")]
        out.append(f"{prefix}-{(max(numbers) + 1) if numbers else 1:03d}")
    return out


# ------------------------------------------------------------------- writing

def rewrite_design_refs(path: Path, renames: dict) -> bool:
    """Replace renamed anchors on the design_refs line only. True when changed."""
    text = read_text(path)
    lines = text.split("\n")
    for k, line in enumerate(lines):
        if line.strip() == "---" and k > 0:
            break
        m = re.match(r"^design_refs: (.*)$", line)
        if m:
            refs = yaml.safe_load(m.group(1)) or []
            new_refs = [renames.get(str(r), str(r)) for r in refs]
            if new_refs != [str(r) for r in refs]:
                lines[k] = "design_refs: " + yaml_inline(new_refs)
                write_text(path, "\n".join(lines))
                return True
    return False


def replace_ticked(path: Path, renames: dict) -> bool:
    text = read_text(path)
    new = text
    for o, n in renames.items():
        new = new.replace(f"`{o}`", f"`{n}`")
    if new != text:
        write_text(path, new)
        return True
    return False


def replace_yaml_refs(path: Path, renames: dict) -> bool:
    text = read_text(path)

    def fix(m):
        items = [i.strip() for i in m.group(2).split(",")]
        return m.group(1) + ", ".join(renames.get(i.strip("'\""), i) for i in items) + "]"
    new = re.sub(r"^(\s*design_refs:\s*\[)([^\]\n]*)\]", fix, text, flags=re.M)
    if new != text:
        write_text(path, new)
        return True
    return False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("design")
    ap.add_argument("--out", required=True)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--print", action="store_true", help="print the change plan; write nothing")
    mode.add_argument("--check", action="store_true", help="exit 1 when the stories are out of sync; write nothing")
    args = ap.parse_args(argv)
    design, out = Path(args.design).resolve(), Path(args.out).resolve()
    meta = out / "_meta"
    try:
        facts = story_map_facts(out)
        root, out_rel, _ = out_paths(out)
        if not design.exists():
            raise DtusError(f"design file not found: {design}")
        design_sha = design_sha256(design)
        open_items = [i for i in pending_items(facts["text"]) if not i[1]]
        if design_sha == facts["sha256"] and not pending_section(facts["text"]).startswith("Sync from"):
            print("in sync: the design is the baseline; nothing to do")
            return 0
        base_text, source = load_baseline(out, root, facts)
        old = Snapshot(analyze(base_text, None, baseline_rule_ids(out)))
        cpath = meta / "constraints.md"
        current_constraints = read_text(cpath) if cpath.exists() else None
        new_analysis = analyze(read_design(design), current_constraints)
        new = Snapshot(new_analysis)
        index = load_json(meta / "index.json", default={}) or {}
        modules = index.get("modules") or {}
        stories = load_stories(out)
        diff = Diff(old, new, stories, modules)
    except DtusError as exc:
        print(f"ERROR: {exc}")
        return 1

    renames = {o: n for o, n, _ in diff.renames}
    rename_todo = sorted(sid for sid, s in stories.items() if s["status"] == "todo"
                         and set(_list(s["fm"], "design_refs")) & set(renames))
    rename_alias = sorted(sid for sid, s in stories.items() if s["status"] != "todo"
                          and set(_list(s["fm"], "design_refs")) & set(renames))
    print(f"diff: baseline {source} -> {rel_to(design, root)}: {len(diff.items)} semantic changes, "
          f"{len(diff.renames)} renames or moves")
    for o, n, kind in diff.renames:
        print(f"  {kind}: {o} -> {n}")
    if diff.renames:
        print(f"  design_refs: rewritten in {', '.join(rename_todo) or 'no todo story'}; "
              f"kept through aliases in {', '.join(rename_alias) or 'no other story'}")
    for item in diff.items:
        for line in item_line(item, stories):
            print(line)
    print("next free IDs: " + ", ".join(next_free_ids(stories, modules)))

    if args.check:
        out_of_sync = diff.semantic() or diff.renames or open_items
        print("check: " + ("OUT OF SYNC: run the skill to sync the stories" if out_of_sync
                           else "in sync (formatting-only changes)"))
        return 1 if out_of_sync else 0
    if args.print:
        return 0

    # ---- mechanical changes
    mechanical = {}
    for sid in rename_todo:
        if rewrite_design_refs(stories[sid]["path"], renames):
            mechanical[sid] = sha256_file(stories[sid]["path"])
    for path in sorted((out / "modules").glob("*/*.md")) + sorted((out / "modules").glob("*/model/*.md")):
        if not STORY_FILE_RE.match(path.name):
            replace_ticked(path, renames)
    for path in sorted((meta / "src").glob("*.yaml")):
        replace_yaml_refs(path, renames)

    # ---- the current design's index, constraints and model
    design_part = design_index(new_analysis)
    old_design = index.get("design") or {}
    aliases = {k: renames.get(v, v) for k, v in (old_design.get("aliases") or {}).items()}
    aliases.update(renames)
    retired = sorted(set(old_design.get("retired") or []) | set(diff.retired))
    design_part.update({"path": rel_to(design, root), "sha256": design_sha, "lines": len(new_analysis.lines)})
    if aliases:
        design_part["aliases"] = dict(sorted(aliases.items()))
    if retired:
        design_part["retired"] = retired
    index["design"] = design_part
    index.setdefault("paths", {})["design"] = rel_to(design, root)
    stories_index = index.get("stories") or {}
    for sid, sha in mechanical.items():
        if sid in stories_index:
            stories_index[sid]["sha256"] = sha
    write_text(meta / "index.json", dump_json(index))
    if INCLUDE_LINE.search(read_text(design)):   # the text that line numbers refer to
        write_text(meta / "design.md", read_design(design))
    write_text(cpath, render_constraints_md(new_analysis.constraints, rel_to(design, root),
                                            manual_block_of(current_constraints) if current_constraints else None))
    write_text(meta / "model.json", dump_json(model_json(new_analysis)))

    # ---- sync.json: the snapshot the sync is validated against
    sync_path = out / SYNC_FILE
    sync = load_json(sync_path, default=None)
    impacted = {sid: stories[sid]["status"] for item in diff.items for sid in item["impacts"]}
    impacted.update({sid: stories[sid]["status"] for sid in mechanical})
    if not sync or sync.get("status") != "open":
        sync = {"status": "open", "from_sha256": facts["sha256"],
                "before": {sid: {"sha256": s["sha256"], "rev": s["fm"].get("rev", 1), "status": s["status"],
                                 "path": s["rel"]} for sid, s in stories.items()},
                "manual": {sid: s["manual"] for sid, s in stories.items() if s["manual"]},
                "hand_edited": sorted(sid for sid, s in stories.items() if s["hand_edited"]),
                "owners": {e: name for name, info in modules.items() for e in info.get("entities") or []},
                "modules": sorted(modules), "impacted": {}, "mechanical": {}}
    sync["to_sha256"] = design_sha
    sync["impacted"] = dict(sorted({**sync.get("impacted", {}), **impacted}.items()))
    sync["mechanical"] = dict(sorted({**sync.get("mechanical", {}), **mechanical}.items()))
    write_text(sync_path, dump_json(sync))

    # ---- the journal
    previous = {pid: (checked, rest.split(" → ", 1)[1] if " → " in rest else "")
                for pid, checked, rest in pending_items(facts["text"])}
    story_map = out / "STORY_MAP.md"
    if diff.semantic():
        write_text(story_map, replace_pending(read_text(story_map),
                                              pending_body(diff, previous, facts["sha256"], design_sha)))
        left = sum(1 for i in diff.items if not previous.get(i["id"], (False,))[0])
        print(f"pending: {len(diff.items)} items in STORY_MAP.md ({left} to apply); _meta index, constraints, "
              "model and sync.json written")
        return 0
    write_text(story_map, replace_pending(read_text(story_map), "None."))
    import build_backlog
    code = build_backlog.main(["--out", str(out)])
    if code == 0:
        print("in sync: " + ("mechanical changes applied, " if diff.renames else "formatting only, ")
              + "re-baselined")
    return code


if __name__ == "__main__":
    sys.exit(main())
