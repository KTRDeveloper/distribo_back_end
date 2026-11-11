#!/usr/bin/env python3
"""Index a design: every section and data-model element with its line range
and normalized content hash.

Usage: index_design.py <design.md> --out <folder> [--print]

Anchors are heading paths (orders/payment/constraints): section numbers are
dropped, duplicates get -2, -3, and explicit ids (<!-- id: X --> or {#X}) win.
Writes the `design` and `paths` keys of <out>/_meta/index.json, keeping its
other keys. With --print, writes nothing. Always prints the outline, so later
steps can open line ranges instead of rereading the design.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from common import (DtusError, design_sha256, dump_json, included_files, load_json, project_root_for, read_design,
                    read_text, rel_to, write_text)
from designparse import analyze, design_index


def outline(analysis) -> list:
    by_anchor = {e.anchor: e for e in analysis.model.entities.values()}
    rows = []
    for s in analysis.sections:
        mark = ""
        ent = by_anchor.get(s.anchor)
        if ent:
            mark = f"  [entity {ent.name}, {len(ent.fields)} fields]"
        rows.append(f"L{s.start}-{s.end}  {s.anchor}{mark}")
    return rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("design")
    ap.add_argument("--out", required=True)
    ap.add_argument("--print", action="store_true", help="print only; write nothing")
    args = ap.parse_args(argv)
    design, out = Path(args.design).resolve(), Path(args.out).resolve()
    try:
        text = read_design(design)
        previous = out / "_meta" / "constraints.md"
        analysis = analyze(text, read_text(previous) if previous.exists() else None)
        root = project_root_for(design)
        index = load_json(out / "_meta" / "index.json", default={}) or {}
        design_part = design_index(analysis)
        design_part.update({"path": rel_to(design, root), "sha256": design_sha256(design),
                            "lines": len(analysis.lines)})
        for key in ("aliases", "retired"):   # written by diff_design.py in SYNC
            kept = (index.get("design") or {}).get(key)
            if kept:
                design_part[key] = kept
        index["design"] = design_part
        index["paths"] = {"design": rel_to(design, root), "out": rel_to(out, root)}
        if Path(index["paths"]["out"]).is_absolute():
            index["paths"]["root"] = root.as_posix()
        status = "not written (--print)"
        if not args.print:
            status = write_text(out / "_meta" / "index.json", dump_json(index))
            if included_files(design):   # the text that line numbers refer to
                write_text(out / "_meta" / "design.md", text)
    except DtusError as exc:
        print(f"ERROR: {exc}")
        return 1
    m = analysis.model
    print(f"index: {len(analysis.sections)} sections, {len(m.entities)} entities, "
          f"{sum(len(e.fields) for e in m.entities.values())} fields, {len(analysis.constraints)} constraints; "
          f"_meta/index.json {status}")
    for row in outline(analysis):
        print(row)
    for w in analysis.warnings:
        print(f"warning: {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
