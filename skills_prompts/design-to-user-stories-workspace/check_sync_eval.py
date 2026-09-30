#!/usr/bin/env python3
"""Scripted assertions for the phase-2 (SYNC) evals e-j.

Usage: check_sync_eval.py <iteration-dir> [run ...]

A run directory holds fixture/project (the pristine start state, statuses set),
outputs/project (after the skill ran), agents.json at the iteration root maps it
to its subagent transcripts. For each run it writes grading.json (text, passed,
evidence) and outputs/_review.md (story diff, pending section) for the viewer.
"""
from __future__ import annotations

import difflib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

SKILL = Path(__file__).resolve().parent.parent / "design-to-user-stories"
TRANSCRIPTS = Path("/home/rkonan/.claude/projects/-home-rkonan-Bureau-RodrigueKONAN-SAAS-Distribo-back-end/"
                   "2fc6c869-84d3-4311-87dc-a8b76db8a7b1/subagents")
STORY_RE = re.compile(r"(?:^|/)([A-Z][A-Z0-9]{1,5}-\d{3})-[a-z0-9-]+\.md$")
STORY_TOKEN_RE = re.compile(r"\b(?!ADR-)([A-Z][A-Z0-9]{1,5}-\d{3})(?:-[a-z0-9-]*\*?|\*)\.md")
BOOKKEEPING = re.compile(r"^docs/(design\.md|stories/(STORY_MAP\.md|STATUS\.md|CHANGELOG\.md|OPEN_QUESTIONS\.md|"
                         r"_meta/(index\.json|sync\.json|constraints\.md|model\.json|backlog\.json|order\.md|"
                         r"traceability\.md|baseline/.*)))$")


# ------------------------------------------------------------------- helpers

def files(project: Path) -> dict:
    return {p.relative_to(project).as_posix(): p.read_bytes() for p in sorted(project.rglob("*"))
            if p.is_file() and ".git" not in p.relative_to(project).parts}


def front(text: str) -> dict:
    if not text.startswith("---"):
        return {}
    try:
        return yaml.safe_load(text.split("\n---", 1)[0][3:]) or {}
    except yaml.YAMLError:
        return {}


def story_id(rel: str):
    m = STORY_RE.search(rel)
    return m.group(1) if m and "/modules/" in rel else None


def pending_body(project: Path) -> str:
    text = (project / "docs/stories/STORY_MAP.md").read_text()
    return text.split("## Pending changes\n", 1)[1].strip() if "## Pending changes\n" in text else "?"


def validate(project: Path):
    proc = subprocess.run([sys.executable, str(SKILL / "scripts/validate.py"), "--out",
                           str(project / "docs/stories")], capture_output=True, text=True)
    return proc.returncode == 0, (proc.stdout.strip().splitlines() or ["(no output)"])


def tool_calls(transcript: Path) -> list:
    calls = []
    for line in transcript.read_text(encoding="utf-8").splitlines():
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        content = (d.get("message") or {}).get("content")
        if isinstance(content, list):
            for c in content:
                if isinstance(c, dict) and c.get("type") == "tool_use":
                    calls.append((c.get("name"), c.get("input") or {}))
    return calls


READERS = re.compile(r"(^|[|;&(]\s*|\s)(cat|head|tail|less|more|sed|awk|bat|nl)\s")


def opened(calls: list, project: Path) -> dict:
    """What the run opened: story IDs, whole-design reads, index.json reads, glob reads."""
    out = {"stories": set(), "design_whole": [], "index_json": [], "glob_reads": [], "greps": []}
    for name, inp in calls:
        if name in ("Read", "Edit", "Write", "MultiEdit"):
            path = str(inp.get("file_path", ""))
            sid = story_id(path)
            if sid:
                out["stories"].add(sid)
            if path.endswith("docs/design.md") and name == "Read" and not inp.get("limit"):
                out["design_whole"].append(f"Read {path}")
            if path.endswith("_meta/index.json") and name == "Read":
                out["index_json"].append(f"Read {path}")
        elif name == "Bash":
            for seg in re.split(r"\n|;|&&|\|\||\|", str(inp.get("command", ""))):
                seg = seg.strip()
                verb = re.sub(r"^(?:\w+=\S*\s+|cd\s+\S+\s*)*", "", seg).split(" ", 1)[0]
                ids = [m.group(1) for m in STORY_TOKEN_RE.finditer(seg) if m.group(1) != "ADR"]
                if verb in ("grep", "rg", "egrep"):
                    if ids or "modules" in seg:
                        out["greps"].append(seg[:160])
                    continue
                if verb not in ("cat", "head", "tail", "less", "more", "sed", "awk", "bat", "nl", "python3"):
                    continue
                if verb == "python3" and "open(" not in seg:
                    continue
                out["stories"].update(ids)
                unpinned = STORY_TOKEN_RE.sub("", seg)
                if re.search(r"modules/\S*\*\S*\.md|modules/\*", unpinned):
                    out["glob_reads"].append(seg[:160])
                if "_meta/index.json" in seg:
                    out["index_json"].append(seg[:160])
                if verb == "cat" and re.search(r"(^|\s|/)design\.md\b", seg) and "baseline" not in seg:
                    out["design_whole"].append(seg[:160])
        elif name == "Grep" and "modules" in str(inp.get("path", "")) and inp.get("output_mode") == "content":
            out["greps"].append(json.dumps(inp)[:160])
    return out


class Grader:
    def __init__(self):
        self.items = []

    def check(self, text, passed, evidence):
        self.items.append({"text": text, "passed": bool(passed), "evidence": str(evidence)[:1500]})


# -------------------------------------------------------------- expectations

def expected_story_change(eval_name: str, rel: str, sid: str, added: bool, fixture_ids: set) -> bool:
    """Is a change of this story file expected for the eval?"""
    if eval_name == "h":
        return not added and sid in {"ORD-003", "ORD-004", "ORD-005", "ORD-006", "ORD-007"}
    allowed = set()
    if eval_name in ("f", "j"):
        allowed.add("SHOP-002")
        if added and sid.startswith("SHOP-") and int(sid[-3:]) >= 6:
            return True
    if eval_name in ("g", "j"):
        if added and sid.startswith("CAT-") and int(sid[-3:]) >= 10:
            return True
    return not added and sid in allowed


def expected_other(eval_name: str, rel: str) -> bool:
    if BOOKKEEPING.match(rel):
        return True
    modules = {"f": ["shops"], "g": ["catalog"], "j": ["shops", "catalog"]}.get(eval_name, [])
    for m in modules:
        if rel.startswith(f"docs/stories/modules/{m}/") or re.match(rf"^docs/stories/_meta/src/{m}(\.sync)?\.yaml$", rel):
            return True
    if eval_name in ("g", "j") and re.match(r"^docs/stories/decisions/ADR-\d{3}-.*\.md$", rel):
        return True
    if eval_name in ("g", "j") and rel in ("docs/stories/GLOSSARY.md", "docs/stories/_meta/src/project.yaml"):
        return True   # a new domain concept gets a glossary row (sync.md §7)
    if eval_name == "h" and rel == "docs/stories/_meta/src/orders.yaml":
        return True
    return False


# ------------------------------------------------------------------- grading

def grade(run: Path, eval_name: str, agents: list) -> dict:
    g = Grader()
    before_p, after_p = run / "fixture/project", run / "outputs/project"
    before, after = files(before_p), files(after_p)
    changed = sorted(k for k in before if k in after and before[k] != after[k])
    added = sorted(k for k in after if k not in before)
    removed = sorted(k for k in before if k not in after)
    fixture_ids = {story_id(k) for k in before if story_id(k)}
    sync = json.loads(after.get("docs/stories/_meta/sync.json", b"{}") or b"{}")

    ok, out = validate(after_p)
    g.check("validate.py passes", ok, " / ".join(out[-3:]))

    unexpected = []
    for rel in changed + added:
        sid = story_id(rel)
        if eval_name == "i":
            if rel != "docs/stories/_meta/run.lock":
                unexpected.append(rel)
            continue
        if sid:
            if not expected_story_change(eval_name, rel, sid, rel in added, fixture_ids):
                unexpected.append(rel)
        elif not expected_other(eval_name, rel):
            unexpected.append(rel)
    unexpected += [f"removed {r}" for r in removed if r != "docs/stories/_meta/run.lock"]
    g.check("every file outside the expected set is byte-identical to the fixture", not unexpected,
            f"unexpected: {unexpected}" if unexpected else f"changed {len(changed)}, added {len(added)}, all expected")

    body = pending_body(after_p)
    g.check("Pending changes is empty at the end", body == "None.", body[:300])
    g.check("the run lock is released", "docs/stories/_meta/run.lock" not in after,
            "run.lock present" if "docs/stories/_meta/run.lock" in after else "no run.lock")

    impacted = set((sync.get("impacted") or {}).keys())
    created = {story_id(k) for k in added if story_id(k)}
    seen = {"stories": set(), "design_whole": [], "index_json": [], "glob_reads": [], "greps": []}
    found = []
    for aid in agents:
        t = TRANSCRIPTS / f"agent-{aid}.jsonl"
        if t.exists():
            found.append(t)
            shutil.copy(t, run / f"transcript-{aid}.jsonl")
            o = opened(tool_calls(t), after_p)
            seen["stories"] |= o["stories"]
            for k in ("design_whole", "index_json", "glob_reads", "greps"):
                seen[k] += o[k]
    if found:
        extra = sorted(seen["stories"] - impacted - created)
        bad = extra or seen["glob_reads"] or seen["index_json"] or seen["design_whole"]
        g.check("the run opened only impacted story files (transcript), never the whole design or _meta/index.json",
                not bad, f"opened {sorted(seen['stories'])}; impacted {sorted(impacted)}; created {sorted(created)}; "
                         f"not allowed {extra}; glob reads {seen['glob_reads']}; index.json {seen['index_json']}; "
                         f"whole design {seen['design_whole']}; greps (informational) {seen['greps'][:3]}")
    else:
        g.check("the run opened only impacted story files (transcript)", False, "no transcript found")

    getattr(sys.modules[__name__], f"specific_{eval_name}")(g, before, after, changed, added, after_p, run)

    review = [f"# {run.parent.parent.name}", "", "## Pending changes", "", body, "", "## Story and module diffs", ""]
    for rel in changed + added:
        if rel.startswith("docs/stories/modules/") or rel.startswith("docs/stories/decisions/"):
            old = before.get(rel, b"").decode().splitlines()
            new = after[rel].decode().splitlines()
            review += ["```diff"] + list(difflib.unified_diff(old, new, rel, rel, lineterm="", n=1))[:120] + ["```", ""]
    (run / "outputs" / "_review.md").write_text("\n".join(review))
    passed = sum(1 for i in g.items if i["passed"])
    result = {"expectations": g.items,
              "summary": {"passed": passed, "failed": len(g.items) - passed, "total": len(g.items),
                          "pass_rate": round(passed / len(g.items), 3)}}
    (run / "grading.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
    return result


def stories_after(after: dict) -> dict:
    return {story_id(k): (k, v.decode()) for k, v in after.items() if story_id(k)}


def specific_e(g, before, after, changed, added, project, run):
    touched = [k for k in changed + added if k.startswith("docs/stories/modules/")]
    g.check("(e) no story or module file changed", not touched, touched or "modules/ byte-identical")
    g.check("(e) STATUS.md unchanged", before["docs/stories/STATUS.md"] == after["docs/stories/STATUS.md"], "")


def change_story_checks(g, before, after, added, done_id, todo_id, tag):
    s = stories_after(after)
    path, text = s[todo_id]
    fm = front(text)
    old_fm = front(before[path].decode())
    g.check(f"({tag}) todo story {todo_id} edited in place, same ID and file, rev bumped",
            path in before and fm.get("rev") == old_fm.get("rev", 1) + 1 and before[path] != after[path],
            f"rev {old_fm.get('rev')} -> {fm.get('rev')}")
    g.check(f"({tag}) {todo_id} now states the new limit (60) and no longer the old one (80) for the name",
            re.search(r"\b60\b", text) and not re.search(r"1 to 80|1 à 80|80 char", text),
            [l for l in text.splitlines() if re.search(r"\b(60|80)\b", l)][:6])
    done_path = next(k for k in before if story_id(k) == done_id)
    g.check(f"({tag}) done story {done_id} byte-identical", before[done_path] == after[done_path], "")
    amending = [(k, t) for sid, (k, t) in s.items() if k in added and done_id in (front(t).get("amends") or [])]
    text_all = "\n".join(t for _, t in amending).lower()
    g.check(f"({tag}) a new story amends {done_id} (kind change or migration)",
            amending and all(front(t).get("kind") in ("change", "migration") for _, t in amending),
            [(k, front(t).get("kind"), front(t).get("risk")) for k, t in amending])
    g.check(f"({tag}) the change for {done_id} audits and backfills existing rows before enforcing",
            "audit" in text_all and "backfill" in text_all, "audit/backfill found" if text_all else "no amending story")
    g.check(f"({tag}) the change for {done_id} lists its tests to update",
            "### tests to update" in text_all, "")
    g.check(f"({tag}) migration stories are risk: high",
            all(front(t).get("risk") == "high" for _, t in amending if front(t).get("kind") == "migration"), "")


def specific_f(g, before, after, changed, added, project, run):
    change_story_checks(g, before, after, added, "SHOP-001", "SHOP-002", "f")


def new_entity_checks(g, before, after, added, project, tag):
    s = stories_after(after)
    new = sorted(sid for sid, (k, _) in s.items() if k in added and sid.startswith("CAT-"))
    adrs = [k for k in added if "/decisions/" in k and "favorite" in after[k].decode().lower()
            and re.search(r"(?im)^status:\s*proposed", after[k].decode())]
    expected = [f"CAT-{n:03d}" for n in range(10, 10 + len(new))]
    g.check(f"({tag}) Favorite gets new catalog stories with the next free IDs (or a proposed ADR)",
            (new and new == expected) or adrs, f"new CAT stories {new}; proposed ADRs {adrs}")
    idx = json.loads(after["docs/stories/_meta/index.json"])
    ents = (idx.get("modules") or {}).get("catalog", {}).get("entities", [])
    model_md = after.get("docs/stories/modules/catalog/model.md", b"").decode()
    g.check(f"({tag}) catalog module files describe Favorite (index entities, model.md)",
            adrs or ("Favorite" in ents and "## Favorite" in model_md), f"entities {ents}")
    cov = "\n".join(t for sid, (k, t) in s.items() if sid in new)
    g.check(f"({tag}) the Favorite rule C-13 is covered by a new story",
            adrs or "C-13" in cov, "C-13 cited" if "C-13" in cov else "C-13 not cited")


def specific_g(g, before, after, changed, added, project, run):
    touched = [k for k in changed if story_id(k)]
    g.check("(g) no existing story changed", not touched, touched or "none")
    new_entity_checks(g, before, after, added, project, "g")


def specific_h(g, before, after, changed, added, project, run):
    ok, ev = True, []
    for sid in ("ORD-003", "ORD-004", "ORD-005", "ORD-006", "ORD-007"):
        k = next(k for k in before if story_id(k) == sid)
        diff = [l for l in difflib.ndiff(before[k].decode().splitlines(), after[k].decode().splitlines())
                if l[:1] in "+-"]
        good = (len(diff) == 2 and all(l[2:].startswith("design_refs:") for l in diff)
                and "commandes/parcours-de-commande" in diff[1])
        ok &= good
        ev.append(f"{sid}: {'design_refs only' if good else diff[:4]}")
    g.check("(h) todo stories ORD-003..007 differ only by design_refs, now the new anchor", ok, ev)
    k2 = next(k for k in before if story_id(k) == "ORD-002")
    g.check("(h) done story ORD-002 byte-identical (resolves through the alias)", before[k2] == after[k2], "")
    idx = json.loads(after["docs/stories/_meta/index.json"])
    g.check("(h) alias commandes/parcours -> commandes/parcours-de-commande recorded",
            idx["design"].get("aliases", {}).get("commandes/parcours") == "commandes/parcours-de-commande",
            idx["design"].get("aliases"))
    new = [k for k in added if story_id(k)]
    g.check("(h) no new story", not new, new or "none")
    model = [k for k in changed if re.search(r"model\.md$|model\.json$|constraints\.md$", k)]
    g.check("(h) no model edit (model.md, model.json, constraints.md unchanged)", not model, model or "unchanged")


def specific_i(g, before, after, changed, added, project, run):
    diff = [k for k in changed + added if k != "docs/stories/_meta/run.lock"]
    g.check("(i) the second sync changed nothing (whole project byte-identical)", not diff, diff or "identical")


def specific_j(g, before, after, changed, added, project, run):
    change_story_checks(g, before, after, added, "SHOP-001", "SHOP-002", "j")
    new_entity_checks(g, before, after, added, project, "j")
    ref = run.parent.parent.parent / "eval-j-reference" / "with_skill" / "run-1"
    if run.parent.parent.name == "eval-j-reference" or not ref.exists():
        return
    ref_after = files(ref / "outputs/project")
    # deterministic state: what scripts derive from the design and the journal
    same, diffs = True, []
    for rel in ("docs/stories/_meta/constraints.md", "docs/stories/_meta/model.json",
                "docs/stories/_meta/baseline/design.md", "docs/stories/_meta/baseline/index.json"):
        a_text, b_text = after.get(rel, b"").decode(), ref_after.get(rel, b"").decode()
        if rel.endswith("constraints.md"):
            a_text, b_text = a_text.split("## Manual")[0], b_text.split("## Manual")[0]
        if a_text != b_text:
            same = False
            diffs.append(rel)
    ia, ib = json.loads(after["docs/stories/_meta/index.json"]), json.loads(ref_after["docs/stories/_meta/index.json"])
    if ia["design"] != ib["design"]:
        same, diffs = False, diffs + ["index design part"]
    sa, sb = (json.loads(x["docs/stories/_meta/sync.json"]) for x in (after, ref_after))
    for key in ("status", "edited", "obsoleted", "impacted", "from_sha256", "to_sha256"):
        if sa.get(key) != sb.get(key):
            same, diffs = False, diffs + [f"sync.json {key}: {sa.get(key)} vs {sb.get(key)}"]
    if pending_body(project) != "None." or pending_body(ref / "outputs/project") != "None.":
        same, diffs = False, diffs + ["a journal is not empty"]

    def amends_graph(fs):
        return sorted((front(v.decode()).get("kind"), tuple(front(v.decode()).get("amends") or []),
                       front(v.decode()).get("risk"), story_id(k).split("-")[0])
                      for k, v in fs.items() if story_id(k) and front(v.decode()).get("amends"))
    if amends_graph(after) != amends_graph(ref_after):
        same, diffs = False, diffs + [f"amends: {amends_graph(after)} vs {amends_graph(ref_after)}"]
    g.check("(j) same final state as the uninterrupted run: index, constraints, model, baseline, journal, "
            "edited stories (with revs), amends graph", same, diffs or "identical")

    def new_ids(fs):
        return sorted(story_id(k) for k in fs if story_id(k) and story_id(k) not in
                      {story_id(x) for x in files(run / "fixture/project")})
    na, nb = new_ids(after), new_ids(ref_after)
    g.check("(j, variance, informational) same new story IDs as the uninterrupted run",
            na == nb, f"interrupted {na}; reference {nb} (how a new entity is sliced is the model's choice)")


def main():
    iteration = Path(sys.argv[1]).resolve()
    agents = json.loads((iteration / "agents.json").read_text())
    only = set(sys.argv[2:])
    for rel, ids in sorted(agents.items()):
        run = iteration / rel
        name = run.parent.parent.name
        if only and name not in only:
            continue
        eval_name = name.split("-")[1] if name.startswith("eval-") else name
        if not (run / "outputs/project").exists():
            print(f"{name}: no outputs")
            continue
        r = grade(run, eval_name, ids)
        s = r["summary"]
        print(f"{name}: {s['passed']}/{s['total']}")
        for i in r["expectations"]:
            if not i["passed"]:
                print(f"  FAIL {i['text']}: {i['evidence'][:400]}")


if __name__ == "__main__":
    main()
