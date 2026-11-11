#!/usr/bin/env python3
"""Build the backlog views from the story files and STATUS.md.

Usage: build_backlog.py --out <folder> [--date YYYY-MM-DD]

Writes, deterministically (no timestamps except in CHANGELOG.md):
- STATUS.md: a `todo` line for each new story; existing lines are never changed;
- _meta/index.json: story file hashes (the design, paths, modules and project keys are kept);
- _meta/backlog.json, _meta/traceability.md, _meta/order.md (topological order + Mermaid graph);
- STORY_MAP.md: design path, hash and commit, template version, modules, next implementable;
- _meta/baseline/: a copy of the design and of its index, the baseline for SYNC;
- CHANGELOG.md: one appended entry when stories were added or the design changed.

SYNC: while Pending changes (STORY_MAP.md) has an unchecked item, the list, the
recorded design hash and commit, the baseline and CHANGELOG.md are left as they
are, so an interrupted sync resumes. Once every item is checked, it clears the
list, re-baselines, closes _meta/sync.json (story hashes after the sync) and
logs the stories added, edited and obsoleted.
"""
from __future__ import annotations

import argparse
import datetime
import heapq
import re
import sys
from pathlib import Path

from common import (STATUSES, STORY_ID_RE, SYNC_FILE, DtusError, dump_json, fill_template, git_commit_for,
                    load_json, load_template, out_paths, parse_status, pending_section, read_text, sha256_file,
                    design_sha256, included_files, read_design, rel_to,
                    skill_version, split_front_matter, status_row, write_text)
from designparse import parse_constraints_md, split_row

STORY_FILE_RE = re.compile(r"^([A-Z][A-Z0-9]{1,5}-\d{3})-.+\.md$")


def story_files(out: Path) -> list:
    return sorted(p for p in (out / "modules").glob("*/*.md") if STORY_FILE_RE.match(p.name))


def tests_of(body: str) -> list:
    rows, inside = [], False
    for line in body.split("\n"):
        if line.startswith("## "):
            inside = line.strip() == "## Tests"
            continue
        if line.startswith("### "):
            inside = inside and not line.lower().startswith("### tests to update")
            continue
        if inside and line.strip().startswith("|"):
            cells = split_row(line)
            if len(cells) >= 4 and cells[0] != "name" and not set(cells[0]) <= set("-: "):
                rows.append(cells)
    return rows


def load_stories(out: Path) -> dict:
    stories = {}
    for path in story_files(out):
        try:
            fm, body, _ = split_front_matter(read_text(path))
        except DtusError as exc:
            print(f"warning: {path.relative_to(out).as_posix()}: {exc}")
            continue
        sid = str(fm.get("id") or STORY_FILE_RE.match(path.name).group(1))
        fm["module"] = fm.get("module") or path.parent.name
        stories[sid] = {"fm": fm, "path": path.relative_to(out).as_posix(), "sha256": sha256_file(path),
                        "tests": tests_of(body)}
    return stories


def number(sid: str) -> int:
    m = STORY_ID_RE.match(sid)
    return int(m.group(2)) if m else 0


def topological_order(stories: dict):
    ids = sorted(stories)
    deps = {i: [d for d in (stories[i]["fm"].get("depends_on") or []) if d in stories] for i in ids}
    module_of = {i: str(stories[i]["fm"].get("module")) for i in ids}
    module_deps = {}
    for i in ids:
        for d in deps[i]:
            if module_of[d] != module_of[i]:
                module_deps.setdefault(module_of[i], set()).add(module_of[d])
    modules = sorted(set(module_of.values()), key=lambda m: (m != "foundation", m))
    rank, remaining = {}, list(modules)
    while remaining:
        ready = [m for m in remaining if not (module_deps.get(m, set()) - set(rank))]
        pick = ready[0] if ready else remaining[0]
        rank[pick] = len(rank)
        remaining.remove(pick)

    def key(i):
        return (rank[module_of[i]], number(i), i)

    indegree = {i: len(deps[i]) for i in ids}
    children = {i: [] for i in ids}
    for i in ids:
        for d in deps[i]:
            children[d].append(i)
    heap = [(key(i), i) for i in ids if indegree[i] == 0]
    heapq.heapify(heap)
    order = []
    while heap:
        _, i = heapq.heappop(heap)
        order.append(i)
        for c in children[i]:
            indegree[c] -= 1
            if indegree[c] == 0:
                heapq.heappush(heap, (key(c), c))
    cyclic = sorted((i for i in ids if i not in set(order)), key=key)
    return order + cyclic, cyclic, [m for m, _ in sorted(rank.items(), key=lambda kv: kv[1])]


def compress(ids: list) -> str:
    """FND-000, AUTH-001, AUTH-002, AUTH-003 -> FND-000, AUTH-001..AUTH-003"""
    parts, run = [], []
    for sid in sorted(ids, key=lambda s: (s.split("-")[0], number(s))):
        if run and sid.split("-")[0] == run[-1].split("-")[0] and number(sid) == number(run[-1]) + 1:
            run.append(sid)
            continue
        if run:
            parts.append(run[0] if len(run) == 1 else f"{run[0]}..{run[-1]}")
        run = [sid]
    if run:
        parts.append(run[0] if len(run) == 1 else f"{run[0]}..{run[-1]}")
    return ", ".join(parts)


def node(sid: str) -> str:
    return sid.replace("-", "_")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", required=True)
    ap.add_argument("--date", help="CHANGELOG date (default: today)")
    args = ap.parse_args(argv)
    out = Path(args.out).resolve()
    meta = out / "_meta"
    try:
        index = load_json(meta / "index.json", default=None)
        if not index or not index.get("design"):
            raise DtusError("_meta/index.json has no design index: run index_design.py first")
        root, out_rel, design_rel = out_paths(out)
        design_path = root / (design_rel or index["design"]["path"])
        version = skill_version()
        stories = load_stories(out)
        order, cyclic, module_order = topological_order(stories)

        # STATUS.md: append new stories as todo, never touch existing lines
        status_path = out / "STATUS.md"
        added_status = []
        if status_path.exists():
            text = read_text(status_path)
            rows = parse_status(text)
            added_status = [i for i in order if i not in rows]
            if added_status:
                write_text(status_path, text.rstrip("\n") + "\n" + "\n".join(status_row(i) for i in added_status) + "\n")
        else:
            added_status = list(order)
            write_text(status_path, fill_template(load_template("STATUS.md"),
                                                  {"rows": "\n".join(status_row(i) for i in order)}, "STATUS.md"))
        status = parse_status(read_text(status_path))

        def state(i):
            return status.get(i, {}).get("status", "todo")

        # index.json and CHANGELOG
        previous_ids = set((index.get("stories") or {}).keys())
        previous_design = (meta / "baseline" / "index.json")
        previous_sha = (load_json(previous_design, default={}) or {}).get("sha256")
        index["stories"] = {i: {"path": stories[i]["path"], "sha256": stories[i]["sha256"]} for i in sorted(stories)}
        index["template_version"] = version
        write_text(meta / "index.json", dump_json(index))

        # backlog.json
        backlog = []
        for n, i in enumerate(order, 1):
            fm = stories[i]["fm"]
            deps = [str(d) for d in fm.get("depends_on") or []]
            backlog.append({"order": n, "id": i, "title": fm.get("title"), "module": fm.get("module"),
                            "kind": fm.get("kind"), "size": fm.get("size"), "risk": fm.get("risk"),
                            "status": state(i), "depends_on": deps, "path": stories[i]["path"],
                            "implementable": state(i) == "todo" and all(d in stories and state(d) == "done" for d in deps)})
        write_text(meta / "backlog.json", dump_json({"template_version": version, "stories": backlog}))

        # order.md
        lines = ["# Implementation order", "",
                 "Topological order of depends_on: modules in dependency order, then story number.", ""]
        lines += [f"{n}. {i} {stories[i]['fm'].get('title', '')} ({stories[i]['fm'].get('module')})"
                  for n, i in enumerate(order, 1)]
        if cyclic:
            lines += ["", "Dependency cycle (fix depends_on): " + ", ".join(cyclic)]
        lines += ["", "```mermaid", "graph TD"]
        lines += [f'  {node(i)}["{i}"]' for i in order]
        for i in order:
            for d in stories[i]["fm"].get("depends_on") or []:
                if d in stories:
                    lines.append(f"  {node(d)} --> {node(i)}")
        lines.append("```")
        write_text(meta / "order.md", "\n".join(lines))

        # traceability.md
        constraints_path = meta / "constraints.md"
        rows = parse_constraints_md(read_text(constraints_path)) if constraints_path.exists() else []
        trace = ["# Traceability", "", "Built by build_backlog.py. A dash means not covered yet.", "",
                 "## Constraints", "| constraint | stories | tests |", "|---|---|---|"]
        for r in rows:
            cid = r["id"]
            in_stories = [i for i in order if cid in (stories[i]["fm"].get("constraints") or [])]
            tests = [f"{i}: {t[0]}" for i in order for t in stories[i]["tests"]
                     if cid in [c.strip() for c in t[2].split(",")]]
            trace.append(f"| {cid} | {', '.join(in_stories) or '—'} | {'; '.join(tests) or '—'} |")
        anchors = {}
        asvs = {}
        for i in order:
            for a in stories[i]["fm"].get("design_refs") or []:
                anchors.setdefault(str(a), []).append(i)
            for a in stories[i]["fm"].get("asvs") or []:
                asvs.setdefault(str(a), []).append(i)
        trace += ["", "## Design anchors", "| anchor | stories |", "|---|---|"]
        trace += [f"| {a} | {', '.join(ids)} |" for a, ids in sorted(anchors.items())]
        trace += ["", "## ASVS 5.0.0", "| requirement | stories |", "|---|---|"]
        trace += [f"| {a} | {', '.join(ids)} |" for a, ids in
                  sorted(asvs.items(), key=lambda kv: tuple(int(x) for x in kv[0].split("-")[-1].split(".")))]
        write_text(meta / "traceability.md", "\n".join(trace))

        # STORY_MAP.md
        modules_info = index.get("modules") or {}
        module_names = list(dict.fromkeys([m for m in module_order] + sorted(modules_info)))
        table = []
        for m in module_names:
            info = modules_info.get(m, {})
            ids = [i for i in order if stories[i]["fm"].get("module") == m]
            prefix = info.get("prefix") or (ids[0].split("-")[0] if ids else "?")
            numbers = [number(i) for i in stories if i.startswith(prefix + "-")]
            next_id = f"{prefix}-{(max(numbers) + 1) if numbers else (0 if m == 'foundation' else 1):03d}"
            counts = [sum(1 for i in ids if state(i) == s) for s in STATUSES]
            entities = ", ".join(info.get("entities") or []) or "—"
            table.append(f"| {m} | {prefix} | {entities} | " + " | ".join(str(c) for c in counts)
                         + f" | {next_id} | {info.get('asvs_level', '—')} |")
        implementable = [b for b in backlog if b["implementable"]][:5]
        nexts = "\n".join(f"{n}. {b['id']}: {b['title']} (`{b['path']}`, risk {b['risk']})"
                          for n, b in enumerate(implementable, 1)) or "None: every todo story waits for a dependency or a review."
        pending, recorded = "None.", None
        story_map = out / "STORY_MAP.md"
        if story_map.exists():
            text = read_text(story_map)
            section = pending_section(text)
            if "- [ ]" in section:
                pending = section
                m = re.search(r"^- Design: `([^`]*)` · sha256 `([0-9a-f]*)` · commit `([^`]*)`", text, re.M)
                recorded = (m.group(1), m.group(2), m.group(3),
                            "".join("\n" + line for line in re.findall(r"^- Included: .*$", text, re.M))) if m else None
        sync_open = pending != "None."
        totals = f"{len(stories)} (" + ", ".join(f"{s} {sum(1 for i in stories if state(i) == s)}" for s in STATUSES) + ")"
        design_shown = design_rel or index["design"]["path"]
        design_sha = design_sha256(design_path) if design_path.exists() else index["design"].get("sha256", "")
        commit = git_commit_for(root, design_shown) or "none (design not committed)"
        included = "".join(f"\n- Included: `{rel_to(p, root)}` · sha256 `{sha256_file(p)}` · commit "
                           f"`{git_commit_for(root, rel_to(p, root)) or 'none'}`"
                           for p in (included_files(design_path) if design_path.exists() else []))
        if recorded:   # stories still describe the baseline: keep its path, hash, commit and files
            design_shown, design_sha, commit, included = recorded
        write_text(story_map, fill_template(load_template("STORY_MAP.md"), {
            "design": design_shown, "design_sha256": design_sha, "design_commit": commit, "included": included,
            "template_version": version, "out": out_rel, "totals": totals, "modules": "\n".join(table),
            "next": nexts, "pending": pending}, "STORY_MAP.md"))

        # baseline (kept while a sync is in progress)
        if not sync_open:
            if design_path.exists():
                write_text(meta / "baseline" / "design.md", read_design(design_path))
            write_text(meta / "baseline" / "index.json", dump_json(index["design"]))

        # _meta/sync.json: close the sync once every pending change is applied
        sync_path = out / SYNC_FILE
        sync = load_json(sync_path, default=None)
        closed = None
        if sync and sync.get("status") == "open" and not sync_open:
            before = sync.get("before") or {}
            after = {}
            for i in sorted(stories):
                fm = stories[i]["fm"]
                after[i] = {"sha256": stories[i]["sha256"], "rev": fm.get("rev", 1), "status": state(i)}
            closed = {
                "edited": sorted(i for i in after if i in before and after[i]["sha256"] != before[i]["sha256"]),
                "obsoleted": sorted(i for i in after if after[i]["status"] == "obsolete"
                                    and (before.get(i) or {}).get("status") != "obsolete"),
            }
            sync.update({"status": "closed", "after": after, **closed})
            write_text(sync_path, dump_json(sync))

        # CHANGELOG.md
        new_ids = sorted(set(stories) - previous_ids)
        changed_design = previous_sha is not None and previous_sha != index["design"].get("sha256")
        changelog = out / "CHANGELOG.md"
        entry_written = False
        if (new_ids or changed_design) and not sync_open:
            date = args.date or datetime.date.today().isoformat()
            label = "init" if not previous_ids else ("sync" if closed is not None else "update")
            entry = [f"## {date}: {label}", f"- Design: `{design_rel}` (sha256 {index['design'].get('sha256', '')[:16]})"]
            if new_ids:
                entry.append(f"- Stories added ({len(new_ids)}): {compress(new_ids)}")
            for key in ("edited", "obsoleted"):
                if closed and closed[key]:
                    entry.append(f"- Stories {key} ({len(closed[key])}): {compress(closed[key])}")
            if changed_design:
                entry.append("- Design changed since the previous baseline")
            base = read_text(changelog) if changelog.exists() else load_template("CHANGELOG.md")
            write_text(changelog, base.rstrip("\n") + "\n\n" + "\n".join(entry) + "\n")
            entry_written = True
    except DtusError as exc:
        print(f"ERROR: {exc}")
        return 1
    print(f"backlog: {len(stories)} stories in {len(module_names)} modules; STATUS.md +{len(added_status)} lines; "
          f"STORY_MAP.md, _meta/index.json, backlog.json, order.md, traceability.md"
          f"{' written; baseline kept: Pending changes has unchecked items' if sync_open else ', baseline written'}; "
          f"CHANGELOG {'+1 entry' if entry_written else 'unchanged'}"
          + ("; sync closed" if closed is not None else ""))
    if cyclic:
        print("warning: dependency cycle: " + ", ".join(cyclic))
    return 0


if __name__ == "__main__":
    sys.exit(main())
