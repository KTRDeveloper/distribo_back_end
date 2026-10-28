#!/usr/bin/env python3
"""État incrémental de FRONTEND_CONTRACT.md (.contract-state.json). Stdlib uniquement.

  init   --out CONTRAT.md --inputs P… [--stories D…] [--ignore GLOB…] [--force]
  scan   [--state F|DIR] [--list a|b|c|d|x|all] [--limit N] [--max-delta N]
  diff   FICHIER [--state …] [--max N]
  commit [--state …] [--map FICHIER=3,4 …] [--touched 3,5 --log "changements ; ⛔ breaking"]

Couches : a specs/ADR · b schémas DB, migrations, DTO/modèles · c routes, auth, erreurs ·
d user stories · x autres (suivis, jamais lus d'office).
`scan` n'écrit que l'instantané en attente (.contract-cache/pending.json) ; `commit` l'enregistre
dans l'état (sha1, date, couche, sections) une fois le contrat mis à jour : une exécution
interrompue n'est jamais perdue. Les hashs font foi ; git (si présent) sert à lister les
fichiers (.gitignore respecté) et à produire des diffs depuis le dernier commit traité.
"""
import argparse
import datetime
import fnmatch
import hashlib
import json
import os
import re
import signal
import subprocess
import sys

sys.dont_write_bytecode = True  # pas de __pycache__ dans le dossier du skill installé
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spec_digest import digest_file, sniff_kind  # noqa: E402

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(SKILL_DIR, 'references', 'contract-template.md')
TEMPLATE_MARK = '<!-- TEMPLATE:START -->'
STATE_NAME = '.contract-state.json'
CACHE_NAME = '.contract-cache'
LAYERS = 'abcdx'

CODE_EXT = {'.ts', '.js', '.mjs', '.cjs', '.py', '.rb', '.go', '.java', '.kt', '.kts', '.scala',
            '.cs', '.php', '.rs', '.ex', '.exs', '.swift', '.dart'}
DOC_EXT = {'.md', '.markdown', '.mdx', '.txt', '.adoc', '.rst', '.feature'}
DATA_EXT = {'.yaml', '.yml', '.json', '.graphql', '.gql', '.graphqls', '.sdl', '.proto', '.sql',
            '.prisma', '.dbml', '.puml', '.plantuml', '.mmd'}
ALLOW_EXT = CODE_EXT | DOC_EXT | DATA_EXT
# Jamais parcourus (dépendances, builds, caches) ; dossiers cachés aussi.
PRUNE_DIRS = {'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'target', 'bin',
              'obj', 'coverage', '__pycache__', 'venv', 'site-packages', 'storybook-static'}
# Ignorés sauf fichier de spec nommé (openapi*, swagger*, asyncapi*, *.postman_collection.json).
SKIP_DIRS = {'test', 'tests', '__tests__', 'testing', 'e2e', 'cypress', 'playwright', 'fixtures',
             '__fixtures__', 'mocks', '__mocks__', 'stubs', 'seed', 'seeds', 'seeders', 'factories',
             'benchmark', 'benchmarks', 'example', 'examples', 'samples', 'scripts', 'tools', 'docker',
             'k8s', 'kubernetes', 'helm', 'charts', 'terraform', 'ansible', 'deploy', 'deployment',
             'deployments', 'ops', 'devops', 'ci', 'public', 'static', 'assets', 'locales', 'i18n',
             'translations', 'generated', '__generated__', 'logs', 'tmp', 'temp'}
SKIP_FILE_RE = re.compile(
    r'[.-](test|spec|e2e-spec|e2e|stories)\.[cm]?[jt]sx?$'
    r'|^test_[^/]*\.py$|_test\.(py|go|exs?)$|_spec\.rb$|(tests?|spec|it)\.(java|kt|cs|scala|php|swift)$'
    r'|^(package|composer|tsconfig[^/]*|jsconfig[^/]*|babel\.config|jest\.config[^/]*|nest-cli|lerna|nx'
    r'|turbo|renovate|vercel|netlify|angular|launchsettings)\.json$'
    r'|^package-lock\.json$|^pnpm-lock\.yaml$|(^|[.-])lock\.(json|ya?ml)$'
    r'|^docker-compose[^/]*\.ya?ml$|^(azure-pipelines|bitbucket-pipelines|cloudbuild|buildspec|skaffold'
    r'|appveyor|codecov|mkdocs|serverless|dependabot)\.ya?ml$'
    r'|\.min\.js$|\.d\.ts$|^(changelog|license|licence|code_of_conduct|contributing)\b')
SPEC_NAME_RE = re.compile(r'^(openapi|swagger|asyncapi)[^/]*\.(ya?ml|json)$'
                          r'|\.(openapi|swagger|asyncapi)\.(ya?ml|json)$|\.postman_collection\.json$')


def _w(alts):
    return re.compile(r'(?<![a-z0-9])(?:' + alts + r')(?![a-z])')


ADR_RX = _w(r'adrs?|decisions?|architecture-decisions?|adr-?\d+')
STORY_RX = _w(r'user-?stor(?:y|ies)|stor(?:y|ies)|backlog|epics?|requirements?|features?|us-?\d+|story-?\d+')
B_RX = _w(r'migrations?|migrate|alembic|flyway|liquibase|prisma|models?|entit(?:y|ies)|dtos?|schemas?'
          r'|serializers?|typeorm|sequelize|mongoose|db|database|http/requests|http/resources')
B_WEAK_RX = _w(r'domain|persistence|repositor(?:y|ies)|requests?|responses?|resources|types|interfaces')
AUTH_RX = _w(r'auth(?:entication|orization|enticate|orize|n|z)?|jwt|oauth2?|guards?|security|middlewares?'
             r'|strateg(?:y|ies)|permissions?|polic(?:y|ies)|sessions?|login|rbac|acl|passport')
ERR_RX = _w(r'errors?|exceptions?|filters?|advice|problems?')
ROUTE_RX = _w(r'routes?|routers?|routing|controllers?|handlers?|endpoints?|api|views?|resolvers?'
              r'|interceptors?|http|urls|rest|web')
SECTIONS = {'openapi': [1, 2, 3, 4, 5, 6, 9], 'swagger': [1, 2, 3, 4, 5, 6, 9], 'asyncapi': [8],
            'graphql': [3, 5], 'postman': [1, 5], 'proto': [3, 5], 'adr': [2, 4], 'model': [3, 4],
            'auth': [2, 5, 6], 'error': [6], 'route': [5, 6], 'story': [7, 10]}
DIGESTIBLE = {'openapi', 'swagger', 'asyncapi', 'postman', 'graphql'}


def die(msg, code=1):
    print(f'ERREUR {msg}', file=sys.stderr)
    sys.exit(code)


def posix(p):
    return p.replace(os.sep, '/')


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def run(cmd):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return p.stdout if p.returncode == 0 else None


def sha1_file(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def write_atomic(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
    os.replace(tmp, path)


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_state(path, st):
    """JSON lisible et diff-friendly : 1 ligne par fichier suivi."""
    rows = [f'  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}' for k, v in st.items() if k != 'files']
    files = st.get('files') or {}
    frows = [f'    {json.dumps(k, ensure_ascii=False)}: {json.dumps(files[k], ensure_ascii=False, sort_keys=True)}'
             for k in sorted(files)]
    rows.append('  "files": {' + ('\n' + ',\n'.join(frows) + '\n  }' if frows else '}'))
    write_atomic(path, '{\n' + ',\n'.join(rows) + '\n}\n')


class Ctx:
    def __init__(self, state_path):
        self.state_path = os.path.abspath(state_path)
        self.dir = os.path.dirname(self.state_path)
        self.cache = os.path.join(self.dir, CACHE_NAME)
        self.pending = os.path.join(self.cache, 'pending.json')

    def key(self, path):
        """Clé stable d'un fichier : chemin relatif au dossier de l'état."""
        try:
            return posix(os.path.relpath(os.path.abspath(path), self.dir))
        except ValueError:  # autre lecteur (Windows)
            return posix(os.path.abspath(path))

    def abs(self, key):
        return os.path.normpath(os.path.join(self.dir, key))

    def show(self, key):
        """Chemin affiché : relatif au dossier courant (réutilisable tel quel par diff/--map)."""
        try:
            return posix(os.path.relpath(self.abs(key)))
        except ValueError:
            return posix(self.abs(key))

    def digest_path(self, key, suffix='.txt'):
        return os.path.join(self.cache, 'digest', hashlib.sha1(key.encode()).hexdigest()[:16] + suffix)


def find_state(arg):
    if arg:
        p = os.path.abspath(arg)
        if os.path.isdir(p):
            p = os.path.join(p, STATE_NAME)
        if not os.path.isfile(p):
            die(f'état introuvable : {arg} (lancer init)')
        return p
    d = os.getcwd()
    while True:
        p = os.path.join(d, STATE_NAME)
        if os.path.isfile(p):
            return p
        parent = os.path.dirname(d)
        if parent == d:
            die('état introuvable (.contract-state.json) : passer --state DOSSIER ou lancer init')
        d = parent


def open_state(arg):
    ctx = Ctx(find_state(arg))
    return ctx, load_json(ctx.state_path)


# -- inventaire -----------------------------------------------------------------------------
def git_toplevel(path):
    d = path if os.path.isdir(path) else os.path.dirname(path)
    out = run(['git', '-C', d, 'rev-parse', '--show-toplevel'])
    return os.path.normpath(out.strip()) if out and out.strip() else None


def list_files(root):
    if os.path.isfile(root):
        return [root]
    out = run(['git', '-C', root, 'ls-files', '-z', '-co', '--exclude-standard', '--', '.'])
    if out:
        return [p for p in (os.path.join(root, x) for x in out.split('\0') if x) if os.path.isfile(p)]
    files = []
    for d, dirs, names in os.walk(root):
        dirs[:] = [x for x in dirs if not (x.startswith('.') or x.lower() in PRUNE_DIRS)]
        files.extend(os.path.join(d, n) for n in names)
    return files


def keep(dir_parts, name, ext, ignore, paths):
    """paths = chemins comparés aux globs --ignore (relatif à l'entrée, clé d'état, nom)."""
    if ext not in ALLOW_EXT or name.startswith('.') or SKIP_FILE_RE.search(name):
        return False
    if any(p.startswith('.') or p in PRUNE_DIRS for p in dir_parts):
        return False
    if any(p in SKIP_DIRS for p in dir_parts) and not SPEC_NAME_RE.search(name):
        return False
    return not any(fnmatch.fnmatch(p, g) for g in ignore for p in paths)


def norm_path(rel):
    """'/chemin' en minuscules, CamelCase découpé (OrderDto → order-dto, JWTStrategy → jwt-strategy)."""
    return '/' + '/'.join(re.sub(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', '-', s).lower()
                          for s in rel.split('/'))


def classify(npath, root_name, ext, kind, forced):
    """→ (couche, type). Le nom de la racine d'entrée ne compte que pour les documents
    (ex. entrée « user-stories/ ») : un dépôt nommé « x-api » ne doit pas tout classer en c."""
    if kind:
        return 'a', kind
    if ext in ('.graphql', '.gql', '.graphqls', '.sdl'):
        return 'a', 'graphql'
    if ext == '.proto':
        return 'a', 'proto'
    if ext in DOC_EXT:
        full = norm_path(root_name) + npath
        if ADR_RX.search(full):
            return 'a', 'adr'
        if forced == 'd' or ext == '.feature' or STORY_RX.search(full):
            return 'd', 'story'
        return 'x', ''
    if ext in ('.sql', '.prisma', '.dbml', '.puml', '.plantuml', '.mmd') or B_RX.search(npath):
        return 'b', 'model'
    if ext in ('.yaml', '.yml', '.json'):
        return 'x', ''
    for rx, kind_c in ((AUTH_RX, 'auth'), (ERR_RX, 'error'), (ROUTE_RX, 'route')):
        if rx.search(npath):
            return 'c', kind_c
    if B_WEAK_RX.search(npath):
        return 'b', 'model'
    return 'x', ''


def under(key, prefixes):
    return any(key == p or key.startswith(p.rstrip('/') + '/') for p in prefixes)


def snapshot(ctx, st):
    prev = st.get('files') or {}
    excluded = {ctx.key(ctx.state_path), st.get('output') or ''}
    snap, heads, missing = {}, {}, []
    # Les entrées « stories » passent en dernier : leur classement (d) l'emporte.
    for inp in sorted(st.get('inputs') or [], key=lambda i: i.get('layer') == 'd'):
        root = ctx.abs(inp['path'])
        if not os.path.exists(root):
            missing.append(inp['path'])
            continue
        top = git_toplevel(root)
        if top:
            h = run(['git', '-C', top, 'rev-parse', 'HEAD'])
            heads[ctx.key(top)] = h.strip() if h else None
        base = root if os.path.isdir(root) else os.path.dirname(root)
        root_name = os.path.basename(os.path.abspath(base))
        for f in list_files(root):
            rel = posix(os.path.relpath(f, base))
            parts = rel.split('/')
            name = parts[-1].lower()
            ext = os.path.splitext(name)[1]
            key = ctx.key(f)
            if key in excluded or under(key, [CACHE_NAME]):
                continue
            if not keep([p.lower() for p in parts[:-1]], name, ext, st.get('ignore') or [], (rel, key, parts[-1])):
                continue
            try:
                stt = os.stat(f)
                old = prev.get(key) or {}
                same = old.get('size') == stt.st_size and old.get('mtime') == stt.st_mtime_ns
                sha = old['sha1'] if same and old.get('sha1') else sha1_file(f)
            except OSError:
                continue
            kind0 = sniff_kind(f) if ext in ('.yaml', '.yml', '.json') else None
            layer, kind = classify(norm_path(rel), root_name, ext, kind0, inp.get('layer'))
            # Sections validées par commit conservées tant que le classement ne change pas.
            sections = old['sections'] if old.get('layer') == layer and 'sections' in old else SECTIONS.get(kind, [])
            snap[key] = {'sha1': sha, 'size': stt.st_size, 'mtime': stt.st_mtime_ns, 'layer': layer,
                         'kind': kind, 'sections': sections}
    return snap, heads, missing


def digest_lines(path):
    with open(path, encoding='utf-8') as f:
        return f.read().splitlines()


def spec_deltas(ctx, snap):
    """Delta sémantique de chaque spec racine vs le dernier digest validé (refs externes incluses)."""
    res = []
    for key in sorted(snap):
        if snap[key]['kind'] not in DIGESTIBLE:
            continue
        try:
            lines = digest_file(ctx.abs(key))
        except Exception as e:
            res.append((key, 'err', str(e)[:160], None))
            continue
        write_atomic(ctx.digest_path(key, '.new'), '\n'.join(lines) + '\n')
        old_p = ctx.digest_path(key)
        if not os.path.exists(old_p):
            res.append((key, 'new', lines, None))
            continue
        old = digest_lines(old_p)
        oset, nset = set(old), set(lines)
        minus = [x for x in old if x not in nset]
        plus = [x for x in lines if x not in oset]
        if plus or minus:
            res.append((key, 'delta', plus, minus))
    return res


def secs(e):
    return '§' + ','.join(map(str, e.get('sections') or [])) if e.get('sections') else '§-'


# -- commandes ------------------------------------------------------------------------------
def cmd_init(a):
    out = os.path.abspath(a.out)
    sp = os.path.join(os.path.dirname(out), STATE_NAME)
    ctx = Ctx(sp)
    exists = os.path.exists(sp)
    if exists and not a.force:
        die(f'état déjà présent : {posix(os.path.relpath(sp))} (scan ; init --force pour changer les entrées)')
    inputs = []
    for p, layer in [(p, None) for p in a.inputs or []] + [(p, 'd') for p in a.stories or []]:
        if not os.path.exists(p):
            die(f'entrée introuvable : {p}')
        inputs.append({'path': ctx.key(p), 'layer': layer})
    if not inputs:
        die('au moins une entrée : --inputs et/ou --stories')
    st = load_json(sp) if exists else {'schema': 1}
    st.update({'output': ctx.key(out), 'inputs': inputs,
               'ignore': a.ignore if a.ignore is not None else st.get('ignore', [])})
    for k, v in (('git', {}), ('updated', None), ('files', {})):
        st.setdefault(k, v)
    save_state(sp, st)
    os.makedirs(os.path.join(ctx.cache, 'digest'), exist_ok=True)
    write_atomic(os.path.join(ctx.cache, '.gitignore'), 'pending.json\n*.new\n*.tmp\n')
    created = False
    if not os.path.exists(out):
        with open(TEMPLATE, encoding='utf-8') as f:
            tpl = f.read()
        i = tpl.find(TEMPLATE_MARK)
        if i < 0:
            die(f'marqueur {TEMPLATE_MARK} absent de {TEMPLATE}')
        skeleton = tpl[i + len(TEMPLATE_MARK):].lstrip('\n')
        write_atomic(out, skeleton if skeleton.endswith('\n') else skeleton + '\n')
        created = True
    print(f"OK init · état {posix(os.path.relpath(sp))} · contrat {posix(os.path.relpath(out))} "
          f"({'squelette créé' if created else 'existant conservé'}) · entrées : "
          + ', '.join(i['path'] + (' (stories)' if i['layer'] == 'd' else '') for i in inputs))


def cmd_scan(a):
    ctx, st = open_state(a.state)
    prev = st.get('files') or {}
    snap, heads, missing = snapshot(ctx, st)
    deleted = sorted(k for k in prev if k not in snap and not under(k, missing))
    added = sorted(k for k in snap if k not in prev)
    modified = sorted(k for k in snap if k in prev and snap[k]['sha1'] != prev[k]['sha1'])
    for m in missing:
        print(f'WARN entrée introuvable : {m} (ses fichiers restent suivis)')
    if a.list:
        rows = [k for k in sorted(snap) if a.list == 'all' or snap[k]['layer'] == a.list]
        print(f'LIST {a.list} : {len(rows)} fichier(s)')
        for k in rows:
            mark = '+' if k in added else '~' if k in modified else ' '
            e = snap[k]
            print(f"{mark} {e['layer']} {e['kind'] or '-'} {ctx.show(k)} {secs(e)}")
        return

    git_old = st.get('git') or {}
    gits = ' '.join(f"{os.path.basename(ctx.abs(r)) or r}@{(git_old.get(r) or '-')[:7]}→{(h or '-')[:7]}"
                    for r, h in heads.items())
    first = not prev
    changed = added or modified or deleted
    deltas = spec_deltas(ctx, snap) if changed else []
    impact = [k for k in added + modified if snap[k]['layer'] != 'x'] + [k for k in deleted if prev[k].get('layer') != 'x']
    status = ('first-run' if first else 'unchanged' if not changed
              else 'changed' if impact or any(d[1] == 'delta' for d in deltas) else 'no-impact')
    print(f"STATE {posix(os.path.relpath(ctx.state_path))} · dernier passage {st.get('updated') or 'jamais'}"
          + (f' · git {gits}' if gits else ''))
    if status == 'unchanged':
        if os.path.exists(ctx.pending):  # instantané périmé d'un passage interrompu
            os.remove(ctx.pending)
        print('STATUS unchanged → répondre « Contrat à jour. »')
        return
    write_atomic(ctx.pending, json.dumps({'created': now_iso(), 'files': snap, 'heads': heads,
                                          'deleted': deleted, 'missing': missing}, ensure_ascii=False))
    nx = sum(1 for k in added + modified if snap[k]['layer'] == 'x') + sum(1 for k in deleted if prev[k].get('layer') == 'x')
    print(f'STATUS {status} · +{len(added)} ~{len(modified)} -{len(deleted)} (dont x : {nx})')

    if first:
        by = {layer: [k for k in sorted(snap) if snap[k]['layer'] == layer] for layer in LAYERS}
        print('COUCHES ' + ' '.join(f'{layer}:{len(by[layer])}' for layer in LAYERS))
        for layer in 'abcd':
            for k in by[layer][:a.limit]:
                e = snap[k]
                print(f"+ {layer} {e['kind']} {ctx.show(k)} {secs(e)}")
            if len(by[layer]) > a.limit:
                print(f'  … +{len(by[layer]) - a.limit} en couche {layer} → scan --list {layer}')
        tops = {}
        for k in by['x']:
            rel = ctx.show(k).split('/')
            top = '/'.join(rel[:-1][:3]) or '.'
            tops[top] = tops.get(top, 0) + 1
        if tops:
            print('x (non lus) : ' + ', '.join(f'{t} ({n})' for t, n in sorted(tops.items(), key=lambda x: -x[1])[:8]))
    else:
        rows = [('+', k, snap[k]) for k in added] + [('~', k, snap[k]) for k in modified] + [('-', k, prev[k]) for k in deleted]
        rows.sort(key=lambda r: (LAYERS.index(r[2].get('layer', 'x')), r[1]))
        xs = [f'{m}{ctx.show(k)}' for m, k, e in rows if e.get('layer') == 'x']
        for m, k, e in [r for r in rows if r[2].get('layer') != 'x'][:60]:
            print(f"{m} {e.get('layer')} {e.get('kind') or '-'} {ctx.show(k)} {secs(e)}")
        if len(impact) > 60:
            print(f'  … +{len(impact) - 60} → scan --list all')
        if xs:
            print(f'x (non lus) : ' + ', '.join(xs[:8]) + (f' … +{len(xs) - 8}' if len(xs) > 8 else ''))

    budget = a.max_delta
    for key, kind, plus, minus in deltas:
        if kind == 'err':
            print(f'SPEC-ERR {ctx.show(key)} : {plus}')
        elif kind == 'new' and not first and key not in added and key not in modified:
            print(f'SPEC {ctx.show(key)} : base de digest absente, recréée (fichier inchangé, rien à faire)')
        elif kind == 'new':
            counts = {}
            for line in plus:
                t = line.split(' ', 1)[0]
                counts[t] = counts.get(t, 0) + 1
            first_grep = {'asyncapi': '^(META|SERVER|SEC|CH|OP|MSG)', 'graphql': '^(T|E|U|SC) '}.get(
                snap[key]['kind'], '^(META|SERVER|SEC|EP)')
            print(f"SPEC {ctx.show(key)} : 1er passage, {len(plus)} lignes ("
                  + ' '.join(f'{t}:{n}' for t, n in counts.items())
                  + f") → spec_digest.py {ctx.show(key)} | grep -E '{first_grep}'")
        else:
            print(f'SPEC {ctx.show(key)} : +{len(plus)} -{len(minus)}')
            lines = [f'  - {x}' for x in minus] + [f'  + {x}' for x in plus]
            shown = lines if budget <= 0 else lines[:budget]
            print('\n'.join(shown))
            if len(shown) < len(lines):
                print(f'  … +{len(lines) - len(shown)} lignes → diff_sources.py diff {ctx.show(key)}')
            if a.max_delta > 0:
                budget = max(budget - len(shown), 1)
    print('NEXT ' + ('commit (sans --log) puis « Contrat à jour. »' if status == 'no-impact'
                     else 'extraction ciblée (a→d) des seuls fichiers listés, édition des § concernés, '
                          'puis commit --touched <§> --log "<changements>"'))


def cmd_diff(a):
    ctx, st = open_state(a.state)
    path = os.path.abspath(a.file)
    key = ctx.key(path)
    entry = (st.get('files') or {}).get(key) or {}
    kind = sniff_kind(path) if os.path.isfile(path) else entry.get('kind')

    def emit(lines, head):
        print(head)
        shown = lines if a.max <= 0 else lines[:a.max]
        if shown:
            print('\n'.join(shown))
        if len(shown) < len(lines):
            print(f'… +{len(lines) - len(shown)} lignes (--max 0 pour tout)')

    if kind in DIGESTIBLE and os.path.isfile(path) and os.path.exists(ctx.digest_path(key)):
        try:
            new = digest_file(path)
        except Exception as e:
            die(f'digest impossible : {e}')
        old = digest_lines(ctx.digest_path(key))
        oset, nset = set(old), set(new)
        lines = [f'- {x}' for x in old if x not in nset] + [f'+ {x}' for x in new if x not in oset]
        emit(lines, f'DIGEST-DELTA {ctx.show(key)}' if lines else 'DIGEST identique : changement non sémantique')
        return
    top = git_toplevel(path if os.path.exists(path) else os.path.dirname(path))
    commit = (st.get('git') or {}).get(ctx.key(top)) if top else None
    if top and commit:
        rel = posix(os.path.relpath(path, top))
        if not os.path.exists(path):
            print(f'SUPPRIMÉ depuis {commit[:7]} → retirer ce qu\'il alimentait ({secs(entry)})')
            return
        if run(['git', '-C', top, 'cat-file', '-e', f'{commit}:{rel}']) is None:
            with open(path, 'rb') as f:
                n = sum(1 for _ in f)
            print(f'NOUVEAU depuis {commit[:7]} ({n} lignes) → lecture ciblée (references/extraction.md)')
            return
        out = run(['git', '-C', top, 'diff', '--no-color', '--no-ext-diff', '-U2', commit, '--', rel]) or ''
        lines = [x for x in out.splitlines() if not x.startswith(('diff --git', 'index ', '--- ', '+++ '))]
        emit(lines, f'GIT-DIFF {commit[:7]}..copie de travail {ctx.show(key)}' if lines
             else f'AUCUN diff git depuis {commit[:7]} → lecture ciblée')
        return
    print('PAS DE BASE (hors git ou jamais validé) → lecture ciblée : grep/sed (references/extraction.md)')


def append_row(path, cells):
    """Ajoute une ligne au tableau final du contrat (changelog §12, dernière section)."""
    if not os.path.exists(path):
        print(f'WARN contrat introuvable, changelog non écrit : {posix(os.path.relpath(path))}')
        return
    with open(path, 'rb') as f:
        f.seek(0, os.SEEK_END)
        last = b''
        if f.tell():
            f.seek(-1, os.SEEK_END)
            last = f.read(1)
    row = '| ' + ' | '.join(c.replace('|', '/') for c in cells) + ' |\n'
    with open(path, 'a', encoding='utf-8') as f:
        f.write(('' if last in (b'', b'\n') else '\n') + row)


def cmd_commit(a):
    ctx, st = open_state(a.state)
    maps = {}
    for m in a.map or []:
        f, _, nums = m.rpartition('=')
        try:
            vals = sorted({int(x) for x in re.split(r'[,;\s§]+', nums) if x})
        except ValueError:
            vals = None
        if not f or not vals or any(v < 1 or v > 12 for v in vals):
            die(f'--map invalide : {m} (attendu FICHIER=3,4 ; sections 1–12)')
        maps[ctx.key(f)] = vals
    if a.touched is not None:
        try:
            a.touched = sorted({int(x) for x in re.split(r'[,;\s§]+', a.touched) if x})
        except ValueError:
            a.touched = None
        if not a.touched or any(v < 1 or v > 12 for v in a.touched):
            die('--touched invalide (attendu ex. 3,5 ; sections 1–12)')
    if not os.path.exists(ctx.pending):
        print('Rien à valider (aucun scan en attente).')
        return
    pend = load_json(ctx.pending)
    prev = st.get('files') or {}
    today = datetime.date.today().isoformat()
    files = {}
    for k, e in pend['files'].items():
        old = prev.get(k) or {}
        e = dict(e, date=old['date'] if old.get('sha1') == e['sha1'] and old.get('date') else today)
        if k in maps:
            e['sections'] = maps.pop(k)
        files[k] = e
    deleted = set(pend.get('deleted') or [])
    for k, v in prev.items():  # fichiers d'entrées momentanément introuvables : conservés
        if k not in files and k not in deleted:
            files[k] = v
    for k in maps:
        print(f'WARN --map ignoré (fichier non suivi) : {ctx.show(k)}')
    for k in files:
        new_p = ctx.digest_path(k, '.new')
        if os.path.exists(new_p):
            os.replace(new_p, ctx.digest_path(k))
    for k in deleted:
        for suffix in ('.txt', '.new'):
            if os.path.exists(ctx.digest_path(k, suffix)):
                os.remove(ctx.digest_path(k, suffix))
    na = sum(1 for k in files if k not in prev)
    nm = sum(1 for k in files if k in prev and prev[k].get('sha1') != files[k]['sha1'])
    if a.log:
        changed = [k for k in files if prev.get(k, {}).get('sha1') != files[k]['sha1'] and files[k]['layer'] != 'x']
        changed += [k for k in deleted if prev.get(k, {}).get('layer') != 'x']
        names = [os.path.basename(k) for k in sorted(changed)]
        src = ', '.join(names[:3]) + (f' +{len(names) - 3}' if len(names) > 3 else '')
        heads = ' '.join(f"{os.path.basename(ctx.abs(r))}@{h[:7]}" for r, h in (pend.get('heads') or {}).items() if h)
        cells = [today, '§' + ',§'.join(map(str, a.touched)) if a.touched else '—',
                 ' '.join(a.log.split()), ' · '.join(x for x in (src, heads) if x) or '—']
        append_row(ctx.abs(st.get('output') or 'FRONTEND_CONTRACT.md'), cells)
    st['files'] = files
    st['git'] = dict(st.get('git') or {}, **{r: h for r, h in (pend.get('heads') or {}).items() if h})
    st['updated'] = now_iso()
    save_state(ctx.state_path, st)
    os.remove(ctx.pending)
    print(f'OK commit · {len(files)} fichiers suivis (+{na} ~{nm} -{len(deleted)}) · {posix(os.path.relpath(ctx.state_path))}')


def main(argv=None):
    if hasattr(signal, 'SIGPIPE'):
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    ap = argparse.ArgumentParser(description='État incrémental de FRONTEND_CONTRACT.md')
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('init', help='crée l\'état, le cache et le squelette du contrat')
    p.add_argument('--out', required=True, help='chemin du FRONTEND_CONTRACT.md (l\'état est créé à côté)')
    p.add_argument('--inputs', nargs='*', default=[], help='repo(s), dossier(s) ou fichier(s) de conception')
    p.add_argument('--stories', nargs='*', default=[], help='dossier(s) de user stories (couche d)')
    p.add_argument('--ignore', nargs='*', default=None,
                   help='globs exclus, comparés au chemin relatif à l\'entrée et au nom (ex. \'src/legacy/*\' \'*.sql\')')
    p.add_argument('--force', action='store_true', help='redéfinit les entrées d\'un état existant')
    p = sub.add_parser('scan', help='compare les sources à l\'état et liste les changements')
    p.add_argument('--state')
    p.add_argument('--list', choices=list(LAYERS) + ['all'], help='liste les fichiers d\'une couche (lecture seule)')
    p.add_argument('--limit', type=int, default=25, help='fichiers listés par couche au 1er passage')
    p.add_argument('--max-delta', type=int, default=120, help='lignes de delta de spec affichées (0 = tout)')
    p = sub.add_parser('diff', help='changement d\'un fichier depuis le dernier passage validé')
    p.add_argument('file')
    p.add_argument('--state')
    p.add_argument('--max', type=int, default=150, help='lignes affichées (0 = tout)')
    p = sub.add_parser('commit', help='enregistre le dernier scan dans l\'état (+ ligne de changelog)')
    p.add_argument('--state')
    p.add_argument('--map', nargs='*', help='FICHIER=3,4 : sections alimentées (remplace la proposition du scan)')
    p.add_argument('--log', help='changements de ce passage → 1 ligne ajoutée au changelog (§12) du contrat')
    p.add_argument('--touched', help='sections modifiées pour la ligne de changelog, ex. 3,5')
    a = ap.parse_args(argv)
    {'init': cmd_init, 'scan': cmd_scan, 'diff': cmd_diff, 'commit': cmd_commit}[a.cmd](a)


if __name__ == '__main__':
    main()
