#!/usr/bin/env python3
"""Build _meta/constraints.md and _meta/model.json from the design's data model,
without the model having to rewrite it.

Usage: extract_model.py <design.md> --out <folder> [--print] [--hints N]

One line per constraint: `ID | Entity.field(s) | rule`.
- `Entity:required` (NOT NULL fields), `Entity:fk` (foreign keys),
  `Entity.field:unique|enum|generated|check` come from the field tables;
- `C-nn` (or the design's own constraint name) come from constraint tables and
  from bullets under a Constraints heading; their text stays in the design's language.
The Extracted section is rebuilt on every run, reusing existing C-nn ids for
unchanged rules; the Manual section (prose-only constraints) is kept verbatim.
Exit 2 when no entity table is recognized: write constraints.md yourself.
With --print, writes nothing and prints the rows.
"""
from __future__ import annotations

import argparse
import collections
import re
import sys
from pathlib import Path

from common import DtusError, ascii_fold, dump_json, project_root_for, read_text, rel_to, write_text
from designparse import analyze, manual_block_of, model_json, render_constraints_md

HINT_WORDS = re.compile(
    r"(?i)\b(unique|check|must|never|always|exactly|at most|at least|only|cannot|immutable|"
    r"doit|doivent|jamais|toujours|exactement|au plus|au moins|seule?s?|seulement|uniquement|"
    r"obligatoire|interdite?s?|immuable|refuse)\b|[≤≥⇒⟺]|<=|>=")


def prose_hints(analysis) -> list:
    """Lines outside tables, code and headings that state a rule about a model element."""
    in_table = set()
    for t in analysis.tables:
        in_table.update(range(t.start, t.end + 1))
    headings = {s.start for s in analysis.sections}
    names = set(analysis.model.entities)
    fields = {f.name for e in analysis.model.entities.values() for f in e.fields}
    hints = []
    inside_fence = False
    for n, line in enumerate(analysis.lines, 1):
        if line.lstrip().startswith(("```", "~~~")):
            inside_fence = not inside_fence
            continue
        if inside_fence or n in in_table or n in headings or not HINT_WORDS.search(ascii_fold(line)):
            continue
        ticks = set(re.findall(r"`([^`]+)`", line))
        if any(t in names or t in fields or t.split(".")[0] in names for t in ticks):
            hints.append((n, re.sub(r"\s+", " ", line).strip()[:110]))
    return hints


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("design")
    ap.add_argument("--out", required=True)
    ap.add_argument("--print", action="store_true", help="print the rows; write nothing")
    ap.add_argument("--hints", type=int, default=30, help="prose hint lines to print (0 = none, -1 = all)")
    args = ap.parse_args(argv)
    design, out = Path(args.design).resolve(), Path(args.out).resolve()
    meta = out / "_meta"
    try:
        text = read_text(design)
        previous_path = meta / "constraints.md"
        previous = read_text(previous_path) if previous_path.exists() else None
        analysis = analyze(text, previous)
        if not analysis.model.entities:
            print("NOT RECOGNIZED: no entity table (Field | Type ...) under an entity heading. "
                  "Write _meta/constraints.md yourself: `ID | Entity.field(s) | rule`.")
            return 2
        root = project_root_for(design)
        body = render_constraints_md(analysis.constraints, rel_to(design, root),
                                     manual_block_of(previous) if previous else None)
        if args.print:
            print("\n".join(l for l in body.split("\n") if l.startswith("| ") and not l.startswith("| ID")))
            status = "not written (--print)"
        else:
            s1 = write_text(meta / "constraints.md", body)
            s2 = write_text(meta / "model.json", dump_json(model_json(analysis)))
            status = f"_meta/constraints.md {s1}, _meta/model.json {s2}"
    except DtusError as exc:
        print(f"ERROR: {exc}")
        return 1
    kinds = collections.Counter(c.kind for c in analysis.constraints)
    summary = ", ".join(f"{k} {kinds[k]}" for k in ("required", "unique", "enum", "fk", "generated", "check", "rule") if kinds[k])
    print(f"constraints: {len(analysis.constraints)} ({summary}); {status}")
    for w in analysis.warnings:
        print(f"warning: {w}")
    hints = prose_hints(analysis)
    if hints and args.hints != 0:
        shown = hints if args.hints < 0 else hints[:args.hints]
        print(f"prose hints ({len(hints)} lines may state constraints not in tables; add real ones under Manual):")
        for n, excerpt in shown:
            print(f"  L{n}: {excerpt}")
        if len(shown) < len(hints):
            print(f"  (+{len(hints) - len(shown)} more: --hints -1)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
