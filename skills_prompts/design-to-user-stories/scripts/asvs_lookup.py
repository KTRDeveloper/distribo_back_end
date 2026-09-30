#!/usr/bin/env python3
"""Query the OWASP ASVS 5.0.0 CSV without loading it into context.

Usage:
  asvs_lookup.py [--level L1|L2|L3] [--chapter V6|6|name] [--section 6.2]
                 [--keyword REGEX]... [--id ID]... [--limit N] [--width N]
  asvs_lookup.py --check ID [ID ...]      exit 1 if any ID does not exist
  asvs_lookup.py --chapters               list chapters with counts per level

Prints one line per requirement: `v5.0.0-<chapter>.<section>.<req> L<n> <text>`.
--level L2 keeps requirements of level 1 and 2. Keywords are case-insensitive
regular expressions matched against the requirement and its section name; all
must match. IDs are accepted as v5.0.0-6.2.1, V6.2.1 or 6.2.1.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

from common import ASVS_CSV, ASVS_VERSION, DtusError

ID_RE = re.compile(r"^(?:v?5\.0\.0-|V)?(\d+)\.(\d+)\.(\d+)$")
VERSIONED_RE = re.compile(r"^v5\.0\.0-(\d+)\.(\d+)\.(\d+)$")


def canonical(asvs_id: str):
    m = ID_RE.match(asvs_id.strip())
    if not m:
        return None
    return f"v{ASVS_VERSION}-{int(m.group(1))}.{int(m.group(2))}.{int(m.group(3))}"


def load(csv_path: Path = ASVS_CSV) -> dict:
    """{canonical_id: {level, chapter_id, chapter, section_id, section, text}} in standard order."""
    try:
        with open(csv_path, encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
    except OSError as exc:
        raise DtusError(f"cannot read ASVS CSV {csv_path}: {exc.strerror}") from None
    reqs = {}
    for r in rows:
        cid = canonical(r["req_id"])
        if cid is None:
            continue
        reqs[cid] = {"level": int(r["L"]), "chapter_id": r["chapter_id"], "chapter": r["chapter_name"],
                     "section_id": r["section_id"], "section": r["section_name"],
                     "text": re.sub(r"\s+", " ", r["req_description"]).strip()}
    return dict(sorted(reqs.items(), key=lambda kv: tuple(int(x) for x in kv[0].split("-")[1].split("."))))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--level", choices=["L1", "L2", "L3"])
    ap.add_argument("--chapter")
    ap.add_argument("--section")
    ap.add_argument("--keyword", action="append", default=[])
    ap.add_argument("--id", action="append", default=[])
    ap.add_argument("--check", nargs="+")
    ap.add_argument("--chapters", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--width", type=int, default=0, help="truncate text to N characters (0 = full)")
    ap.add_argument("--csv", default=str(ASVS_CSV))
    args = ap.parse_args(argv)
    try:
        reqs = load(Path(args.csv))
    except DtusError as exc:
        print(f"ERROR: {exc}")
        return 1

    if args.check:
        unknown = [i for i in args.check if not VERSIONED_RE.match(i) or canonical(i) not in reqs]
        for i in unknown:
            print(f"unknown or unversioned ASVS id: {i} (expected v{ASVS_VERSION}-<chapter>.<section>.<req>)")
        print(f"checked {len(args.check)} ids: {len(unknown)} unknown")
        return 1 if unknown else 0

    if args.chapters:
        chapters = {}
        for r in reqs.values():
            c = chapters.setdefault(r["chapter_id"], [r["chapter"], 0, 0, 0])
            c[r["level"]] += 1
        for cid, (name, l1, l2, l3) in chapters.items():
            print(f"{cid} {name}: L1 {l1}, L2 {l2}, L3 {l3}")
        return 0

    level = int(args.level[1]) if args.level else 3
    wanted_ids = {canonical(i) for i in args.id} if args.id else None
    chapter = args.chapter.strip().lower() if args.chapter else None
    section = args.section.strip().lstrip("Vv") if args.section else None
    patterns = []
    for kw in args.keyword:
        try:
            patterns.append(re.compile(kw, re.I))
        except re.error:
            patterns.append(re.compile(re.escape(kw), re.I))
    shown = 0
    for cid, r in reqs.items():
        if wanted_ids is not None and cid not in wanted_ids:
            continue
        if r["level"] > level:
            continue
        if chapter and chapter not in (r["chapter_id"].lower(), r["chapter_id"][1:].lower()) and chapter not in r["chapter"].lower():
            continue
        if section and r["section_id"].lstrip("V") != section:
            continue
        haystack = f"{r['section']} {r['text']}"
        if not all(p.search(haystack) for p in patterns):
            continue
        text = r["text"]
        if args.width and len(text) > args.width:
            text = text[:args.width - 1].rstrip() + "…"
        print(f"{cid} L{r['level']} {text}")
        shown += 1
        if args.limit and shown >= args.limit:
            break
    if shown == 0:
        print("no matching requirement")
    return 0


if __name__ == "__main__":
    sys.exit(main())
