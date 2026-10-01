"""Parse a Markdown design: headings, sections, tables, data model, constraints.

Two data-model formats are recognized, and can be mixed:
- inline: a heading naming the entity (e.g. ### 1.1 `Person`) followed by a table
  `Field | Type | Description` (French headers accepted: Champ, Type, Description),
  where the Type cell carries PK, FK -> Target, enum [A / B], nullable, unique...
- constraints column: the same table with an extra `Constraints` column.
Tables whose first column is `Constraint` / `Contrainte` / `Rule` hold one rule per
row; bullet lists under a heading named Constraints / Contraintes too.
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field

from common import ascii_fold, normalize, short_hash, slugify

FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})(.*)$")
ATX_RE = re.compile(r"^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*$")
SETEXT_RE = re.compile(r"^\s{0,3}(=+|-{2,})\s*$")
ID_COMMENT_RE = re.compile(r"<!--\s*id\s*:\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*-->")
ID_ATTR_RE = re.compile(r"\s*\{#([A-Za-z0-9][A-Za-z0-9._-]*)\}\s*$")
NUMBERING_RE = re.compile(r"^\s*(?:\d+(?:\.\d+)*\.?|[A-Z](?:\.\d+)+\.?|[A-Z]\.|[IVXLC]+\.)\s+")
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SEP_CELL_RE = re.compile(r"^:?-+:?$")
RULE_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]*$")

HEADER_FIELD = {"champ", "champs", "field", "fields", "attribute", "attributes", "attribut", "attributs",
                "column", "columns", "colonne", "colonnes", "name", "nom", "property", "properties",
                "propriete", "proprietes"}
HEADER_TYPE = {"type", "types"}
HEADER_CONSTRAINTS = {"constraint", "constraints", "contrainte", "contraintes", "rule", "rules",
                      "regle", "regles"}
HEADER_DESC = {"description", "descriptions", "note", "notes", "comment", "comments", "commentaire",
               "commentaires", "details", "meaning", "signification"}
HEADER_RULE = {"constraint", "constraints", "contrainte", "contraintes", "rule", "rules", "regle",
               "regles", "invariant", "invariants"}
HEADER_ID = {"id", "identifiant", "code", "nom", "name", "ref", "reference"}
RULE_SECTION_TITLES = ("constraints", "contraintes", "invariants", "business rules", "regles metier")
GENERIC_TITLES = {"fields", "champs", "attributes", "attributs", "columns", "colonnes", "properties", "proprietes",
                  "data", "donnees", "model", "modele", "schema", "constraints", "contraintes", "notes",
                  "description", "overview", "structure", "table", "tables", "entities", "entites", "definition"}

NULLABLE_TOKENS = {"nullable", "optional", "optionnel", "optionnelle", "facultatif", "facultative", "null"}
REQUIRED_TOKENS = {"not null", "required", "obligatoire", "non null", "non nul", "mandatory", "requis"}


# ------------------------------------------------------------------- headings

@dataclass
class Heading:
    level: int
    text: str
    line: int
    span: int = 1
    explicit_id: str | None = None


@dataclass
class Section:
    anchor: str
    title: str
    level: int
    start: int
    end: int
    own_end: int
    parent: str | None
    explicit: bool
    hash: str = ""
    full_hash: str = ""


def strip_inline(text: str) -> str:
    t = re.sub(r"<!--.*?-->", "", text)
    t = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("`", "").replace("**", "").replace("__", "")
    t = re.sub(r"(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])", r"\1", t)
    return re.sub(r"\s+", " ", t).strip()


def code_mask(lines: list) -> list:
    """True for lines inside fenced code blocks (fences included)."""
    mask = [False] * len(lines)
    fence_char, fence_len = None, 0
    for i, line in enumerate(lines):
        m = FENCE_RE.match(line)
        if fence_char is None:
            if m:
                fence_char, fence_len = m.group(1)[0], len(m.group(1))
                mask[i] = True
        else:
            mask[i] = True
            if m and m.group(1)[0] == fence_char and len(m.group(1)) >= fence_len and not m.group(2).strip():
                fence_char = None
    return mask


def _plain_paragraph_line(line: str) -> bool:
    s = line.strip()
    return bool(s) and not re.match(r"^(#|\||>|[-*+]\s|\d+[.)]\s|<!--)", s)


def parse_headings(lines: list, mask: list) -> list:
    headings = []
    i = 0
    while i < len(lines):
        if mask[i]:
            i += 1
            continue
        line = lines[i]
        m = ATX_RE.match(line)
        heading = None
        if m and m.group(2):
            text = re.sub(r"\s+#+\s*$", "", m.group(2)).strip()
            heading = Heading(len(m.group(1)), text, i + 1)
        elif (i + 1 < len(lines) and not mask[i + 1] and SETEXT_RE.match(lines[i + 1])
              and _plain_paragraph_line(line) and (i == 0 or not lines[i - 1].strip() or mask[i - 1])):
            level = 1 if lines[i + 1].strip().startswith("=") else 2
            heading = Heading(level, line.strip(), i + 1, span=2)
        if heading is None:
            i += 1
            continue
        mid = ID_COMMENT_RE.search(heading.text)
        mattr = ID_ATTR_RE.search(heading.text)
        if mid:
            heading.explicit_id = mid.group(1)
            heading.text = ID_COMMENT_RE.sub("", heading.text).strip()
        elif mattr:
            heading.explicit_id = mattr.group(1)
            heading.text = ID_ATTR_RE.sub("", heading.text).strip()
        else:
            j = i + heading.span
            while j < len(lines) and j < i + heading.span + 2 and not lines[j].strip():
                j += 1
            if j < len(lines) and not mask[j]:
                mnext = ID_COMMENT_RE.fullmatch(lines[j].strip())
                if mnext:
                    heading.explicit_id = mnext.group(1)
        headings.append(heading)
        i += heading.span
    return headings


def heading_segment(text: str) -> str:
    return slugify(NUMBERING_RE.sub("", strip_inline(text))) or "section"


def build_sections(lines: list, headings: list, warnings: list) -> list:
    n = len(lines)
    sections = []
    if headings and headings[0].line > 1 and any(l.strip() for l in lines[:headings[0].line - 1]):
        body = "\n".join(lines[:headings[0].line - 1])
        sections.append(Section("_front", "", 0, 1, headings[0].line - 1, headings[0].line - 1, None,
                                False, short_hash(body), short_hash(body)))
    doc_title = bool(headings) and headings[0].level == 1 and sum(1 for h in headings if h.level == 1) == 1
    used = set()
    stack = []
    for idx, h in enumerate(headings):
        end = n
        for later in headings[idx + 1:]:
            if later.level <= h.level:
                end = later.line - 1
                break
        own_end = headings[idx + 1].line - 1 if idx + 1 < len(headings) else n
        while stack and stack[-1][0] >= h.level:
            stack.pop()
        parent = stack[-1][1] if stack else None
        if idx == 0 and doc_title:
            anchor, parent = "_doc", None
        else:
            if h.explicit_id:
                base = h.explicit_id
            else:
                seg = heading_segment(h.text)
                base = seg if parent in (None, "_doc") else f"{parent}/{seg}"
            anchor, k = base, 2
            while anchor in used:
                anchor = f"{base}-{k}"
                k += 1
            if h.explicit_id and anchor != base:
                warnings.append(f"line {h.line}: explicit id {base} is duplicated; indexed as {anchor}")
        used.add(anchor)
        stack.append((h.level, anchor))
        first_body = h.line - 1 + h.span
        own = "\n".join(lines[first_body:own_end])
        full = "\n".join(lines[first_body:end])
        sections.append(Section(anchor, strip_inline(h.text), h.level, h.line, end, own_end, parent,
                                bool(h.explicit_id), short_hash(own), short_hash(full)))
    return sections


def section_at(sections: list, line: int):
    best = None
    for s in sections:
        if s.start <= line <= s.own_end:
            best = s
    return best


# --------------------------------------------------------------------- tables

@dataclass
class Table:
    start: int
    end: int
    header: list
    rows: list
    section: str | None


def split_row(line: str) -> list:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    cells, cur, i = [], [], 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s) and s[i + 1] == "|":
            cur.append("|")
            i += 2
            continue
        if s[i] == "|":
            cells.append("".join(cur).strip())
            cur = []
        else:
            cur.append(s[i])
        i += 1
    cells.append("".join(cur).strip())
    return cells


def _is_separator(line: str) -> bool:
    if not line.strip().startswith("|"):
        return False
    cells = split_row(line)
    return bool(cells) and all(SEP_CELL_RE.match(c.replace(" ", "")) for c in cells)


def parse_tables(lines: list, mask: list, sections: list) -> list:
    tables = []
    i, n = 0, len(lines)
    while i < n:
        if (not mask[i] and lines[i].lstrip().startswith("|") and i + 1 < n and not mask[i + 1]
                and _is_separator(lines[i + 1])):
            header = split_row(lines[i])
            rows, j = [], i + 2
            while j < n and not mask[j] and lines[j].lstrip().startswith("|"):
                rows.append((j + 1, split_row(lines[j])))
                j += 1
            sec = section_at(sections, i + 1)
            tables.append(Table(i + 1, j, header, rows, sec.anchor if sec else None))
            i = j
        else:
            i += 1
    return tables


def norm_header(cell: str) -> str:
    return re.sub(r"[^a-z]", "", ascii_fold(strip_inline(cell)).lower())


def classify_table(header: list):
    names = [norm_header(c) for c in header]

    def first(options, exclude=()):
        for k, name in enumerate(names):
            if name in options and k not in exclude:
                return k
        return None

    name_i, type_i = first(HEADER_FIELD), first(HEADER_TYPE)
    if name_i is not None and type_i is not None:
        cons_i = first(HEADER_CONSTRAINTS, exclude=(name_i, type_i))
        desc_i = first(HEADER_DESC, exclude=(name_i, type_i))
        return {"kind": "fields", "name": name_i, "type": type_i, "constraints": cons_i, "desc": desc_i}
    if names and names[0] in HEADER_RULE:
        return {"kind": "rules", "id": None, "rule": 0}
    if len(names) >= 2 and names[0] in HEADER_ID and names[1] in HEADER_RULE:
        return {"kind": "rules", "id": 0, "rule": 1}
    return None


# ---------------------------------------------------------------------- model

@dataclass
class Field:
    entity: str
    name: str
    line: int
    raw_type: str
    base: str = ""
    nullable: bool | None = None
    pk: bool = False
    unique: bool = False
    fk: str | None = None
    polymorphic: bool = False
    enum: list | None = None
    generated: bool = False
    default: str | None = None
    checks: list = field(default_factory=list)
    row_hash: str = ""


@dataclass
class Entity:
    name: str
    anchor: str
    line: int
    table_line: int
    fields: list = field(default_factory=list)
    has_constraints_column: bool = False


@dataclass
class RuleRow:
    line: int
    explicit_id: str | None
    rule: str
    rationale: str
    anchor: str | None
    hash: str


@dataclass
class Constraint:
    id: str
    kind: str
    entity: str | None
    refs: list
    rule: str
    line: int
    hash: str


def entity_name_from_title(raw_title: str):
    ticks = [t.strip() for t in re.findall(r"`([^`]+)`", raw_title)]
    idents = [t for t in ticks if IDENT_RE.match(t) and ascii_fold(t).lower() not in GENERIC_TITLES]
    if len(idents) == 1:
        return idents[0]
    plain = NUMBERING_RE.sub("", strip_inline(raw_title)).strip()
    m = re.match(r"(?i)^(?:entit(?:y|é|e)|table|model|mod[eè]le)\s*:?\s*([A-Za-z_][A-Za-z0-9_]*)$", plain)
    if m:
        return m.group(1)
    if IDENT_RE.match(plain) and plain[0].isupper() and ascii_fold(plain).lower() not in GENERIC_TITLES:
        return plain
    return None


def _clean_cell(text: str) -> str:
    return text.replace("**", "").replace("`", "").strip()


def split_tokens(text: str) -> list:
    tokens, cur, depth = [], [], 0
    for ch in text:
        if ch in "[(":
            depth += 1
        elif ch in "])":
            depth = max(0, depth - 1)
        if ch in ",;" and depth == 0:
            tokens.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    tokens.append("".join(cur).strip())
    return [t for t in tokens if t]


def parse_type(raw_type: str, raw_constraints: str = "") -> dict:
    spec = {"base": "", "nullable": None, "pk": False, "unique": False, "fk": None, "polymorphic": False,
            "enum": None, "generated": False, "default": None, "checks": []}
    type_tokens = split_tokens(_clean_cell(raw_type))
    all_tokens = type_tokens + split_tokens(_clean_cell(raw_constraints or ""))
    for pos, tok in enumerate(all_tokens):
        key = re.sub(r"\s+", " ", ascii_fold(tok).lower()).strip()
        if re.match(r"^(pk|primary key|cle primaire|clef primaire)\b", key):
            spec["pk"] = True
            spec["base"] = spec["base"] or "PK"
            continue
        m = re.match(r"^fk\b\s*(?:(?:→|->|=>|vers|to|references?|ref)\s*([A-Za-z_][A-Za-z0-9_]*))?", tok, re.I)
        if m:
            spec["fk"] = m.group(1) or ""
            spec["base"] = spec["base"] or "FK"
            continue
        if key.startswith("enum"):
            values = re.search(r"[\[(](.*)[\])]", tok)
            if values:
                spec["enum"] = [v.strip().strip("'\"") for v in re.split(r"\s*[/,|]\s*", values.group(1)) if v.strip()]
            else:
                spec["enum"] = []
            spec["base"] = spec["base"] or "enum"
            continue
        if key in NULLABLE_TOKENS:
            spec["nullable"] = True
            continue
        if key in REQUIRED_TOKENS:
            spec["nullable"] = False
            continue
        if key == "unique":
            spec["unique"] = True
            continue
        if re.search(r"generated|computed|calcule|genere", key):
            spec["generated"] = True
            continue
        if "polymorph" in key:
            spec["polymorphic"] = True
            continue
        m = re.match(r"^(?:default|defaut|par defaut)\b\s*:?\s*(.*)$", key)
        if m:
            spec["default"] = tok[len(tok) - len(m.group(1)):].strip() if m.group(1) else ""
            continue
        if pos == 0 and pos < len(type_tokens):
            spec["base"] = tok
            continue
        spec["checks"].append(tok)
    return spec


@dataclass
class Model:
    entities: dict
    rules: list
    format: str
    nullability: str
    other_formats: list
    warnings: list


def _rule_bullets(lines: list, mask: list, section: Section):
    out = []
    for ln in range(section.start + 1, section.own_end + 1):
        line = lines[ln - 1]
        if mask[ln - 1]:
            continue
        m = re.match(r"^(?:[-*+]|\d+[.)])\s+(.*)$", line)
        if m and m.group(1).strip():
            out.append((ln, m.group(1).strip()))
    return out


def parse_model(lines: list, mask: list, sections: list, tables: list) -> Model:
    warnings = []
    by_anchor = {s.anchor: s for s in sections}
    heading_text = {}
    entities = {}
    rules = []
    formats = set()

    for t in tables:
        cls = classify_table(t.header)
        if cls is None:
            continue
        if cls["kind"] == "rules":
            for ln, cells in t.rows:
                if cls["rule"] >= len(cells) or not cells[cls["rule"]].strip():
                    continue
                rule = cells[cls["rule"]].replace("**", "").strip()
                rid = None
                if cls["id"] is not None and cls["id"] < len(cells):
                    candidate = strip_inline(cells[cls["id"]])
                    rid = candidate if RULE_ID_RE.match(candidate) else None
                others = [strip_inline(c) for k, c in enumerate(cells) if k not in (cls["rule"], cls["id"]) and c.strip()]
                rules.append(RuleRow(ln, rid, rule, " — ".join(others), t.section, short_hash(rule)))
            continue
        # a field table: find the entity from the enclosing headings
        name, anchor, heading_line = None, t.section, t.start
        probe, depth = t.section, 0
        while probe and probe in by_anchor and depth < 3:
            sec = by_anchor[probe]
            raw = heading_text.get(probe)
            if raw is None:
                raw = lines[sec.start - 1] if sec.start >= 1 else ""
                raw = re.sub(r"^\s{0,3}#{1,6}\s+", "", raw)
                heading_text[probe] = raw
            name = entity_name_from_title(raw)
            if name:
                anchor, heading_line = probe, sec.start
                break
            probe, depth = sec.parent, depth + 1
        if not name:
            warnings.append(f"line {t.start}: field table without an entity heading; ignored")
            continue
        formats.add("constraints-column" if cls["constraints"] is not None else "inline")
        ent = entities.get(name)
        if ent is None:
            ent = Entity(name, anchor, heading_line, t.start)
            entities[name] = ent
        elif ent.anchor != anchor:
            warnings.append(f"line {t.start}: entity {name} is defined again (first at line {ent.line}); fields merged")
        ent.has_constraints_column = ent.has_constraints_column or cls["constraints"] is not None
        seen = {f.name for f in ent.fields}
        for ln, cells in t.rows:
            if cls["name"] >= len(cells):
                continue
            fname = re.sub(r"\s*\(.*?\)\s*$", "", strip_inline(cells[cls["name"]])).strip()
            if not IDENT_RE.match(fname):
                continue
            raw_type = cells[cls["type"]] if cls["type"] < len(cells) else ""
            raw_cons = cells[cls["constraints"]] if cls["constraints"] is not None and cls["constraints"] < len(cells) else ""
            spec = parse_type(raw_type, raw_cons)
            if fname in seen:
                warnings.append(f"line {ln}: field {name}.{fname} is listed twice")
                continue
            seen.add(fname)
            if not _clean_cell(raw_type):
                warnings.append(f"line {ln}: field {name}.{fname} has no type")
            if spec["enum"] == []:
                warnings.append(f"line {ln}: enum {name}.{fname} lists no values")
            ent.fields.append(Field(name, fname, ln, _clean_cell(raw_type), row_hash=short_hash(lines[ln - 1]), **spec))

    for s in sections:
        title = ascii_fold(NUMBERING_RE.sub("", s.title)).lower()
        if any(title.startswith(p) for p in RULE_SECTION_TITLES):
            for ln, text in _rule_bullets(lines, mask, s):
                rules.append(RuleRow(ln, None, text.replace("**", ""), "", s.anchor, short_hash(text)))
    rules.sort(key=lambda r: r.line)

    for ent in entities.values():
        if not ent.fields:
            warnings.append(f"line {ent.table_line}: entity {ent.name} has no fields")
        for f in ent.fields:
            if f.fk and f.fk not in entities:
                warnings.append(f"line {f.line}: {ent.name}.{f.name} references {f.fk}, which is not an entity of the design")

    all_fields = [f for e in entities.values() for f in e.fields]
    says_nullable = any(f.nullable is True for f in all_fields)
    says_required = any(f.nullable is False for f in all_fields)
    if says_nullable and not says_required:
        nullability = "not-null-default"
    elif says_required and not says_nullable:
        nullability = "nullable-default"
    elif says_nullable and says_required:
        nullability = "explicit"
        for f in all_fields:
            if f.nullable is None and not f.pk and not f.generated:
                warnings.append(f"line {f.line}: nullability of {f.entity}.{f.name} is not stated")
    else:
        nullability = "unknown"
        if all_fields:
            warnings.append("nullability is never stated: no NOT NULL constraint extracted; ask")

    text = "\n".join(lines)
    other = []
    if re.search(r"```\s*mermaid[^`]*?erDiagram", text):
        other.append("mermaid-erDiagram")
    if re.search(r"^\s*model\s+[A-Z]\w*\s*\{", text, re.M):
        other.append("prisma")
    if re.search(r"(?i)\bcreate\s+table\b", text):
        other.append("sql-ddl")
    fmt = "none" if not formats else ("mixed" if len(formats) > 1 else formats.pop())
    return Model(entities, rules, fmt, nullability, other, warnings)


# ---------------------------------------------------------------- constraints

_SPAN_RE = re.compile(r"`([^`]+)`|([A-Za-z_][A-Za-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)")
_WORD_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?")


def resolve_refs(text: str, entities: dict) -> list:
    """Entity.field references mentioned in a rule, in order of first mention.

    `Entity.field` is taken anywhere; an entity name (plain or in backticks) sets
    the context for the bare fields that follow it; a bare field counts when it is
    in backticks, or contains an underscore, and belongs to the context entity or
    to exactly one entity. Entities mentioned without any field are listed alone.
    """
    fields = {name: {f.name for f in ent.fields} for name, ent in entities.items()}
    owners = {}
    for name, names in fields.items():
        for f in names:
            owners.setdefault(f, []).append(name)
    refs, mentioned, current = [], [], None

    def add(ref):
        if ref not in refs:
            refs.append(ref)

    for m in _SPAN_RE.finditer(text):
        in_ticks = m.group(1) is not None
        for word in _WORD_RE.findall(m.group(1) if in_ticks else m.group(2)):
            ent, _, fname = word.partition(".")
            if ent in fields:
                current = ent
                if fname and fname in fields[ent]:
                    add(f"{ent}.{fname}")
                elif not fname and ent not in mentioned:
                    mentioned.append(ent)
                continue
            if fname or not (in_ticks or "_" in word):
                continue
            if current and word in fields[current]:
                add(f"{current}.{word}")
            elif len(owners.get(word, [])) == 1:
                add(f"{owners[word][0]}.{word}")
    for ent in mentioned:
        if not any(r.startswith(ent + ".") for r in refs):
            add(ent)
    return refs or ["*"]


SIMILAR_RULE_RATIO = 0.6


def _similar_rule_ids(rows: list, previous_rule_ids: dict, taken: set) -> dict:
    """Row index -> previous ID for edited rules: a rule whose text changed keeps
    its C-nn when it is still the closest previous rule (ratio >= 0.6), pairing
    the best matches first. Why: SYNC reports "C-04 changed", not "C-04 removed,
    C-13 added", and the stories citing C-04 stay valid."""
    free = {rid: text for text, rid in previous_rule_ids.items() if rid not in taken}
    if not free or not rows:
        return {}
    pairs = []
    for k, row in rows:
        new = normalize(row.rule)
        for rid, old in free.items():
            ratio = difflib.SequenceMatcher(None, old, new, autojunk=False).ratio()
            if ratio >= SIMILAR_RULE_RATIO:
                pairs.append((-ratio, k, rid))
    out, used = {}, set()
    for _, k, rid in sorted(pairs):
        if k not in out and rid not in used:
            out[k] = rid
            used.add(rid)
    return out


def build_constraints(model: Model, previous_rule_ids: dict | None = None,
                      rule_ids_by_hash: dict | None = None) -> list:
    """Deterministic constraint list. previous_rule_ids maps normalized rule text
    to an existing ID, so re-running on the same design keeps the same IDs; an
    edited rule keeps its ID when it is clearly the same rule (_similar_rule_ids).
    rule_ids_by_hash (rule hash -> ID, from an index) wins over both."""
    previous_rule_ids = previous_rule_ids or {}
    rule_ids_by_hash = rule_ids_by_hash or {}
    out = []
    for ent in model.entities.values():
        e = ent.name
        required = [f for f in ent.fields if not f.pk and not f.generated and (
            f.nullable is False or (f.nullable is None and model.nullability == "not-null-default"))]
        if required:
            out.append(Constraint(f"{e}:required", "required", e, [f"{e}.{f.name}" for f in required],
                                  "NOT NULL", ent.table_line,
                                  short_hash("required " + " ".join(f.name for f in required))))
        for f in ent.fields:
            if f.unique:
                out.append(Constraint(f"{e}.{f.name}:unique", "unique", e, [f"{e}.{f.name}"], "unique",
                                      f.line, short_hash(f"unique {e}.{f.name}")))
        for f in ent.fields:
            if f.enum:
                out.append(Constraint(f"{e}.{f.name}:enum", "enum", e, [f"{e}.{f.name}"],
                                      "one of " + ", ".join(f.enum), f.line,
                                      short_hash(f"enum {e}.{f.name} " + " ".join(f.enum))))
        fks = [f for f in ent.fields if f.fk]
        if fks:
            rule = "references " + "; ".join(f"{f.name} → {f.fk}" for f in fks)
            out.append(Constraint(f"{e}:fk", "fk", e, [f"{e}.{f.name}" for f in fks], rule,
                                  fks[0].line, short_hash(rule)))
        for f in ent.fields:
            if f.generated:
                out.append(Constraint(f"{e}.{f.name}:generated", "generated", e, [f"{e}.{f.name}"],
                                      "computed by the database; never written by the application",
                                      f.line, short_hash(f"generated {e}.{f.name}")))
        for f in ent.fields:
            for k, check in enumerate(f.checks):
                cid = f"{e}.{f.name}:check" + ("" if k == 0 else f"-{k + 1}")
                out.append(Constraint(cid, "check", e, [f"{e}.{f.name}"], check, f.line,
                                      short_hash(f"check {e}.{f.name} {check}")))
    used = {c.id for c in out}
    known = list(previous_rule_ids.values()) + list(rule_ids_by_hash.values())
    numbers = [int(m.group(1)) for v in known for m in [re.match(r"^C-(\d+)$", v)] if m]
    next_number = max(numbers, default=0) + 1
    exact = {}
    for k, row in enumerate(model.rules):
        rid = row.explicit_id or rule_ids_by_hash.get(row.hash) or previous_rule_ids.get(normalize(row.rule))
        if rid is not None and rid not in exact.values():
            exact[k] = rid
    similar = _similar_rule_ids([(k, r) for k, r in enumerate(model.rules) if k not in exact],
                                previous_rule_ids, set(exact.values()))
    for k, row in enumerate(model.rules):
        rid = exact.get(k) or similar.get(k)
        if rid is None or rid in used:
            while f"C-{next_number:02d}" in used:
                next_number += 1
            rid = f"C-{next_number:02d}"
            next_number += 1
        used.add(rid)
        refs = resolve_refs(row.rule, model.entities)
        entity = refs[0].split(".")[0] if refs and refs[0] != "*" else None
        out.append(Constraint(rid, "rule", entity, refs, row.rule, row.line, row.hash))
    return out


# ----------------------------------------------------------- constraints.md

CONSTRAINTS_TABLE_HEADER = "| ID | Entity.field(s) | rule |\n|---|---|---|"
MANUAL_HEADING = "## Manual"


def _cell(text: str) -> str:
    return re.sub(r"\s+", " ", text).replace("|", "\\|").strip()


def render_constraints_md(constraints: list, design_rel: str, manual_block: str | None) -> str:
    rows = [f"| {_cell(c.id)} | {_cell(', '.join(c.refs))} | {_cell(c.rule)} |" for c in constraints]
    manual = manual_block if manual_block is not None else (
        f"{MANUAL_HEADING}\n\nConstraints stated only in prose, added by the skill: "
        "`CM-nn | Entity.field(s) | rule (design line N)`.\n\n" + CONSTRAINTS_TABLE_HEADER + "\n")
    return (
        "# Constraints\n\n"
        f"One line per constraint, from `{design_rel}`. Extracted rows are rebuilt by "
        "extract_model.py; the Manual section is never touched by scripts.\n\n"
        "## Extracted\n\n" + CONSTRAINTS_TABLE_HEADER + "\n" + "\n".join(rows) + "\n\n" + manual.rstrip("\n") + "\n")


def parse_constraints_md(text: str) -> list:
    """Rows as dicts: id, refs (list), rule, section ('extracted' | 'manual')."""
    rows, section = [], "extracted"
    for line in text.split("\n"):
        if line.startswith("## "):
            section = "manual" if line.strip().lower() == MANUAL_HEADING.lower() else "extracted"
            continue
        if not line.strip().startswith("|"):
            continue
        cells = split_row(line)
        if len(cells) < 3 or cells[0] in ("ID", "") or SEP_CELL_RE.match(cells[0].replace(" ", "")):
            continue
        refs = [r.strip() for r in cells[1].split(",") if r.strip()]
        rows.append({"id": cells[0].strip("` "), "refs": refs, "rule": cells[2], "section": section})
    return rows


def manual_block_of(text: str):
    idx = text.find("\n" + MANUAL_HEADING)
    if idx < 0:
        return None
    return text[idx + 1:]


# -------------------------------------------------------------------- facade

@dataclass
class Analysis:
    lines: list
    sections: list
    tables: list
    model: Model
    constraints: list
    warnings: list


def analyze(text: str, previous_constraints_md: str | None = None, rule_ids_by_hash: dict | None = None) -> Analysis:
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]
    mask = code_mask(lines)
    warnings = []
    headings = parse_headings(lines, mask)
    sections = build_sections(lines, headings, warnings)
    tables = parse_tables(lines, mask, sections)
    model = parse_model(lines, mask, sections, tables)
    warnings.extend(model.warnings)
    previous = {}
    if previous_constraints_md:
        for row in parse_constraints_md(previous_constraints_md):
            if row["section"] == "extracted" and re.match(r"^C-\d+$", row["id"]):
                previous[normalize(row["rule"])] = row["id"]
    constraints = build_constraints(model, previous, rule_ids_by_hash)
    return Analysis(lines, sections, tables, model, constraints, warnings)


def design_index(analysis: Analysis) -> dict:
    """The design part of _meta/index.json."""
    sections = {s.anchor: {"title": s.title, "level": s.level, "start": s.start, "end": s.end,
                           "own_end": s.own_end, "hash": s.hash, "full_hash": s.full_hash,
                           **({"explicit": True} if s.explicit else {})}
                for s in analysis.sections}
    elements = {}
    for ent in analysis.model.entities.values():
        sec = next((s for s in analysis.sections if s.anchor == ent.anchor), None)
        elements[f"entity:{ent.name}"] = {"anchor": ent.anchor, "start": sec.start if sec else ent.line,
                                          "end": sec.end if sec else ent.line,
                                          "hash": sec.hash if sec else ""}
        for f in ent.fields:
            item = {"line": f.line, "hash": f.row_hash, "type": f.raw_type}
            if f.enum:
                item["enum"] = f.enum
            elements[f"field:{ent.name}.{f.name}"] = item
    for c in analysis.constraints:
        elements[f"constraint:{c.id}"] = {"line": c.line, "hash": c.hash}
    return {"sections": sections, "elements": elements, "aliases": {}}


def model_json(analysis: Analysis) -> dict:
    m = analysis.model
    entities = {}
    for ent in m.entities.values():
        entities[ent.name] = {
            "anchor": ent.anchor,
            "line": ent.line,
            "fields": [{k: v for k, v in {
                "name": f.name, "line": f.line, "type": f.raw_type, "base": f.base,
                "nullable": f.nullable, "pk": f.pk or None, "unique": f.unique or None,
                "fk": f.fk, "polymorphic": f.polymorphic or None, "enum": f.enum,
                "generated": f.generated or None, "default": f.default, "checks": f.checks or None,
            }.items() if v is not None} for f in ent.fields],
        }
    constraints = [{"id": c.id, "kind": c.kind, "entity": c.entity, "refs": c.refs, "rule": c.rule,
                    "line": c.line, "hash": c.hash} for c in analysis.constraints]
    return {"format": m.format, "nullability": m.nullability, "entities": entities,
            "constraints": constraints}
