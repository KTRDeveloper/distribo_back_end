"""Shared helpers for the design-to-user-stories scripts.

Standard library plus PyYAML only. Every writer here is deterministic:
sorted JSON keys, stable ordering, LF line endings, no timestamps.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import unicodedata
from pathlib import Path

import yaml

SKILL_DIR = Path(__file__).resolve().parent.parent
ASSETS = SKILL_DIR / "assets"
REFERENCES = SKILL_DIR / "references"
ASVS_CSV = REFERENCES / "asvs-5.0.0.csv"
ASVS_VERSION = "5.0.0"

STORY_ID_RE = re.compile(r"^([A-Z][A-Z0-9]{1,5})-(\d{3})$")
STATUSES = ("todo", "in_progress", "blocked", "done", "obsolete")
KINDS = ("feature", "technical", "change", "migration", "removal", "test")
SIZES = ("XS", "S", "M")
RISKS = ("low", "medium", "high")
TEST_LEVELS = ("unit", "integration", "security")

# Budgets, calibrated on the target agent (see references/story-rules.md).
STORY_MAX_LINES = 120
STORY_MAX_TOKENS = 1500
MODULE_FILE_MAX_LINES = 150
MODULE_FILE_MAX_TOKENS = 2400
CONVENTIONS_MAX_LINES = 150
CONVENTIONS_MAX_TOKENS = 2400
README_MAX_LINES = 30
README_MAX_TOKENS = 500
MAX_ACCEPTANCE = 7
MAX_PRODUCTION_FILES = 5
MAX_READ_FIRST = 2
MAX_CONTEXT_LINES = 15
PATTERN_MAX_LINES = 150      # a pattern file is read whole by every story that cites it
PATTERN_MAX_MODIFIERS = 2    # beyond this many todo stories modifying it, a pattern keeps growing


class DtusError(Exception):
    """A user-facing error: printed as one line, exit code 1."""


# --------------------------------------------------------------------------- io

def read_text(path: Path) -> str:
    """Read a UTF-8 file strictly (a BOM is dropped). Raises DtusError."""
    try:
        data = Path(path).read_bytes()
    except OSError as exc:
        raise DtusError(f"cannot read {path}: {exc.strerror}") from None
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise DtusError(f"{path} is not valid UTF-8 (byte {exc.start})") from None
    return text.replace("\r\n", "\n").replace("\r", "\n")


def write_text(path: Path, text: str) -> str:
    """Write text with LF endings and one trailing newline.

    Returns 'created', 'updated' or 'unchanged'. Never rewrites identical bytes,
    so file modification times stay meaningful.
    """
    path = Path(path)
    if not text.endswith("\n"):
        text += "\n"
    data = text.encode("utf-8")
    if path.exists():
        if path.read_bytes() == data:
            return "unchanged"
        status = "updated"
    else:
        status = "created"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return status


def dump_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def load_json(path: Path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    try:
        return json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise DtusError(f"{path} is not valid JSON: {exc.msg} (line {exc.lineno})") from None


def load_yaml_documents(path: Path) -> list:
    try:
        return [d for d in yaml.safe_load_all(read_text(path)) if d is not None]
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        where = f" line {mark.line + 1}" if mark is not None else ""
        problem = getattr(exc, "problem", None) or str(exc).splitlines()[0]
        raise DtusError(f"{path}:{where} invalid YAML: {problem}") from None


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(Path(path).read_bytes())


# ---------------------------------------------------------------- normalizing

_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_BULLET_RE = re.compile(r"^\s*[-*+]\s+", re.M)
_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$", re.M)


def normalize(text: str) -> str:
    """Normalize Markdown so that formatting-only edits keep the same hash.

    Ignores whitespace and line wrapping, bold/italic stars, code backticks,
    bullet style, table alignment and HTML comments. Keeps words, case,
    punctuation and identifiers (underscores included).
    """
    t = unicodedata.normalize("NFC", text)
    t = _COMMENT_RE.sub(" ", t)
    t = _TABLE_SEP_RE.sub("", t)
    t = _BULLET_RE.sub("- ", t)
    t = t.replace("*", "").replace("`", "")
    t = re.sub(r"\s*\|\s*", " | ", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def short_hash(text: str) -> str:
    """16-hex hash of the normalized text."""
    return hashlib.sha256(normalize(text).encode("utf-8")).hexdigest()[:16]


def ascii_fold(text: str) -> str:
    t = unicodedata.normalize("NFKD", text)
    return "".join(c for c in t if not unicodedata.combining(c))


def slugify(text: str, max_len: int = 40) -> str:
    t = ascii_fold(text).lower()
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    if len(t) > max_len:
        cut = t[:max_len]
        t = cut.rsplit("-", 1)[0] if "-" in cut else cut
    return t


def estimate_tokens(text: str) -> int:
    return (len(text) + 3) // 4


# --------------------------------------------------------------- front matter

class FrontMatterError(DtusError):
    pass


def split_front_matter(text: str):
    """Return (front_matter_dict, body_text, body_first_line_number)."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        raise FrontMatterError("missing front matter (first line must be ---)")
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            raw = "\n".join(lines[1:i])
            try:
                data = yaml.safe_load(raw) or {}
            except yaml.YAMLError as exc:
                raise FrontMatterError(f"front matter is not valid YAML: {str(exc).splitlines()[0]}") from None
            if not isinstance(data, dict):
                raise FrontMatterError("front matter must be a mapping")
            return data, "\n".join(lines[i + 1:]), i + 2
    raise FrontMatterError("front matter is not closed by ---")


def dump_front_matter(data: dict) -> str:
    """YAML front matter body: block mapping, flow-style lists, insertion order."""
    return yaml.safe_dump(data, sort_keys=False, default_flow_style=None,
                          allow_unicode=True, width=10000).rstrip("\n")


def yaml_inline(value) -> str:
    """One-line YAML for a scalar or a list (quoted only when YAML needs it)."""
    text = yaml.safe_dump(value, default_flow_style=True, allow_unicode=True, width=10000, sort_keys=False)
    lines = [l for l in text.strip().split("\n") if l.strip() != "..."]
    return " ".join(l.strip() for l in lines)


# ------------------------------------------------------------------ templates

_PLACEHOLDER_RE = re.compile(r"\{\{([a-z_][a-z0-9_]*)\}\}")


def load_template(name: str) -> str:
    return read_text(ASSETS / name)


def fill_template(template: str, values: dict, name: str = "template") -> str:
    """Replace {{key}} placeholders. Every placeholder must have a value and
    every value must be used, so a template and its renderer never drift."""
    used = set(_PLACEHOLDER_RE.findall(template))
    missing = sorted(used - set(values))
    extra = sorted(set(values) - used)
    if missing or extra:
        raise DtusError(f"{name}: missing values {missing}, unused values {extra}")
    out = _PLACEHOLDER_RE.sub(lambda m: str(values[m.group(1)]), template)
    out = "\n".join(line.rstrip() for line in out.split("\n"))
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip("\n") + "\n"


def template_front_matter_keys(template: str) -> list:
    lines = template.split("\n")
    keys = []
    if lines and lines[0].strip() == "---":
        for line in lines[1:]:
            if line.strip() == "---":
                break
            m = re.match(r"^([a-z_]+):", line)
            if m:
                keys.append(m.group(1))
    return keys


def template_sections(template: str) -> list:
    return [line[3:].strip() for line in template.split("\n") if line.startswith("## ")]


def skill_version() -> str:
    text = read_text(SKILL_DIR / "SKILL.md")
    fm, _, _ = split_front_matter(text)
    version = (fm.get("metadata") or {}).get("version")
    if not version:
        raise DtusError("SKILL.md has no metadata.version")
    return str(version)


# --------------------------------------------------------------------- status

STATUS_HEADER = "| ID | status | reviewer | note |"


def parse_status(text: str) -> dict:
    """Parse STATUS.md rows `ID | status | reviewer | note` (outer pipes optional)."""
    rows = {}
    for line in text.split("\n"):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) < 2 or not STORY_ID_RE.match(cells[0]):
            continue
        while len(cells) < 4:
            cells.append("")
        rows[cells[0]] = {"status": cells[1], "reviewer": cells[2], "note": " | ".join(cells[3:]).strip()}
    return rows


def status_row(story_id: str, status: str = "todo", reviewer: str = "", note: str = "") -> str:
    cells = [story_id, status, reviewer, note]
    return "|" + "|".join(f" {c} " if c else " " for c in cells) + "|"


# ------------------------------------------------------------------ git/paths

def git_root(path: Path):
    path = Path(path)
    start = path if path.is_dir() else path.parent
    try:
        proc = subprocess.run(["git", "-C", str(start), "rev-parse", "--show-toplevel"],
                              capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    return Path(proc.stdout.strip()).resolve()


def project_root_for(design: Path) -> Path:
    """Git root containing the design file, else the design file's folder."""
    design = Path(design).resolve()
    return git_root(design) or design.parent


def git_commit_for(root: Path, relpath: str):
    """Last commit touching relpath if the file is tracked and unmodified, else None."""
    def run(*args):
        try:
            return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            return None
    tracked = run("ls-files", "--error-unmatch", "--", relpath)
    if tracked is None or tracked.returncode != 0:
        return None
    dirty = run("status", "--porcelain", "--", relpath)
    if dirty is None or dirty.returncode != 0 or dirty.stdout.strip():
        return None
    log = run("log", "-1", "--format=%H", "--", relpath)
    if log is None or log.returncode != 0 or not log.stdout.strip():
        return None
    return log.stdout.strip()


def rel_to(path: Path, root: Path) -> str:
    """Path relative to root, or the absolute path when it lies outside root."""
    try:
        rel = Path(os.path.relpath(Path(path).resolve(), Path(root).resolve())).as_posix()
    except ValueError:
        return Path(path).resolve().as_posix()
    return Path(path).resolve().as_posix() if rel == ".." or rel.startswith("../") else rel


def out_paths(out: Path):
    """(project_root, out_rel, design_rel) recorded by index_design.py in _meta/index.json."""
    out = Path(out).resolve()
    index = load_json(out / "_meta" / "index.json", default={}) or {}
    paths = index.get("paths") or {}
    out_rel = paths.get("out")
    if out_rel and not os.path.isabs(out_rel):
        root = out
        for _ in Path(out_rel).parts:
            root = root.parent
        return root, out_rel, paths.get("design")
    if out_rel:
        return Path(paths.get("root") or out.parent), out_rel, paths.get("design")
    root = git_root(out) or out.parent
    return root, rel_to(out, root), paths.get("design")


MANIFESTS = {
    "package.json", "pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "Pipfile",
    "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle",
    "composer.json", "Gemfile", "mix.exs", "pubspec.yaml", "deno.json", "deno.jsonc",
    "Package.swift", "CMakeLists.txt",
}
CODE_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".kts",
    ".scala", ".cs", ".fs", ".vb", ".rb", ".php", ".swift", ".m", ".mm", ".c", ".h", ".cc",
    ".cpp", ".hpp", ".ex", ".exs", ".erl", ".dart", ".lua", ".vue", ".svelte",
}
SKIP_DIRS = {"node_modules", "vendor", "dist", "build", "target", "out", "coverage",
             "__pycache__", "venv", "bower_components"}


def detect_existing_code(root: Path, ignore=(), limit: int = 5, max_depth: int = 6) -> list:
    """Code files or manifests under root, skipping hidden, vendored and build
    folders plus the paths in `ignore` (output folder, skill folder)."""
    root = Path(root).resolve()
    ignored = {Path(p).resolve() for p in ignore}
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        current = Path(dirpath)
        depth = len(current.relative_to(root).parts)
        keep = []
        for d in sorted(dirnames):
            full = (current / d).resolve()
            if d.startswith(".") or d in SKIP_DIRS or full in ignored or depth >= max_depth:
                continue
            keep.append(d)
        dirnames[:] = keep
        for f in sorted(filenames):
            full = (current / f).resolve()
            if full in ignored:
                continue
            if f in MANIFESTS or Path(f).suffix.lower() in CODE_EXTENSIONS:
                found.append(rel_to(full, root))
                if len(found) >= limit:
                    return found
    return found


# ----------------------------------------------------------- content scanners

_SECRET_PATTERNS = [
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("payment provider key", re.compile(r"\b[rsp]k_(?:live|test)_[0-9A-Za-z]{10,}")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}")),
    ("Slack token", re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")),
]
_ASSIGNMENT_RE = re.compile(
    r"(?i)(?:api[_ -]?key|secret|token|passw(?:or)?d|mot de passe|cl[eé](?: d'api| api)?|access[_ -]?key|client[_ -]?secret)"
    r"[A-Za-z_ -]{0,30}(?:\([^)]{0,40}\))?\s*[:=]\s*[`\"']?([A-Za-z0-9/+_\-.]{16,})")
_PLACEHOLDER_VALUE_RE = re.compile(r"(?i)(x{4,}|changeme|placeholder|example|your[-_]|<|\*{3,})")


def find_secrets(text: str) -> list:
    """(line_number, kind) for secret-like strings. Never returns the value."""
    hits = []
    for n, line in enumerate(text.split("\n"), 1):
        for kind, pattern in _SECRET_PATTERNS:
            if pattern.search(line):
                hits.append((n, kind))
                break
        else:
            m = _ASSIGNMENT_RE.search(line)
            if m:
                value = m.group(1)
                if (re.search(r"[A-Za-z]", value) and re.search(r"\d", value)
                        and not _PLACEHOLDER_VALUE_RE.search(value)):
                    hits.append((n, "credential-like value"))
    return hits


_AI_TERMS = (r"(?:\b(?:IA|AI|LLMs?|GPT)\b|(?i:chatgpt|claude|copilot|gemini|mod[eè]les? de langage|"
             r"language models?|assistants? (?:ia|ai)\b|(?:ai|ia|coding) agents?|agents? (?:ia|ai|de codage)\b))")
_AI_INSTRUCTION_PATTERNS = [
    re.compile(r"(?i)\bignore[rz]?\s+(?:all\s+|toutes\s+)?(?:the\s+|les\s+)?(?:previous|prior|above|pr[ée]c[ée]dentes?)\b"),
    re.compile(r"(?i)(?:system prompt|prompt syst[eè]me|you are now|tu es maintenant|vous [êe]tes maintenant)"),
    re.compile(r"(?i:note|notes|consigne|consignes|instruction|instructions|message)\s+(?i:pour|aux|à|a|to|for)\s+"
               r"(?i:l[ea]s?\s+|the\s+)?" + _AI_TERMS),
    re.compile(r"(?i:if you are|si tu es|si vous [êe]tes)\s+(?i:an?\s+|une?\s+)?" + _AI_TERMS),
]
_AI_TERM_RE = re.compile(_AI_TERMS)
_IMPERATIVE_RE = re.compile(
    r"(?i)\b(?:skip|ignore|disable|bypass|install|add|delete|remove|do not test|don't test|"
    r"ignorez|ignore[rz]?|d[ée]sactive[rz]?|installe[rz]?|ajoute[rz]?|supprime[rz]?|saute[rz]?|contourne[rz]?)\b")


def find_ai_instructions(text: str) -> list:
    """(line_number, excerpt) for text that addresses AI agents or tries to steer them."""
    hits = []
    for n, line in enumerate(text.split("\n"), 1):
        if any(p.search(line) for p in _AI_INSTRUCTION_PATTERNS) or (
                _AI_TERM_RE.search(line) and _IMPERATIVE_RE.search(line)):
            excerpt = re.sub(r"\s+", " ", line).strip()
            hits.append((n, excerpt[:120]))
    return hits


# ----------------------------------------------------------------------- sync

SYNC_FILE = "_meta/sync.json"
PENDING_HEADING = "## Pending changes"
PENDING_ITEM_RE = re.compile(r"^- \[([ xX])\] (P-[0-9a-f]{8}) · (.*)$")
MANUAL_BLOCK_RE = re.compile(r"<!-- manual -->.*?<!-- /manual -->", re.S)
FROZEN_STATUSES = ("in_progress", "blocked", "done")


def pending_section(story_map_text: str) -> str:
    """Body of the `## Pending changes` section of STORY_MAP.md ('' when absent)."""
    m = re.search(r"^" + re.escape(PENDING_HEADING) + r"\n(.*?)(?=^## |\Z)", story_map_text, re.M | re.S)
    return m.group(1).strip() if m else ""


def pending_items(story_map_text: str) -> list:
    """[(id, checked, rest_of_line)] for each journal item of Pending changes."""
    items = []
    for line in pending_section(story_map_text).split("\n"):
        m = PENDING_ITEM_RE.match(line.strip())
        if m:
            items.append((m.group(2), m.group(1).lower() == "x", m.group(3)))
    return items


def replace_pending(story_map_text: str, body: str) -> str:
    """STORY_MAP.md with the Pending changes section body replaced."""
    head, sep, _ = story_map_text.partition(PENDING_HEADING + "\n")
    if not sep:
        return story_map_text.rstrip("\n") + f"\n\n{PENDING_HEADING}\n{body.strip()}\n"
    return head + PENDING_HEADING + "\n" + body.strip() + "\n"


def manual_blocks(text: str) -> list:
    """Content between <!-- manual --> and <!-- /manual -->, markers included."""
    return MANUAL_BLOCK_RE.findall(text)
