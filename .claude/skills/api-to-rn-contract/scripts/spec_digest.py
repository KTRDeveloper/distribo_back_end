#!/usr/bin/env python3
"""Digest compact d'une spec d'API : 1 fait par ligne, lisible par morceaux et comparable
ligne à ligne entre deux versions (delta sémantique).

Formats : OpenAPI 3.x, Swagger 2.0, AsyncAPI 2.x/3.x, collection Postman v2.x, GraphQL SDL.
Usage   : spec_digest.py FICHIER [--desc]
Filtres : | grep -E '^(META|SERVER|SEC)'   | grep '^EP'   | grep '^F Order\\.'   | grep -E '^(CH|OP|MSG)'
Lignes  : META SERVER SEC SEC* EP WH CH OP MSG S(schéma) F(champ) T(type GQL) E(enum) U(union) SC(scalar)
  EP MÉTHODE /chemin | op= | auth= | in=p:|q:|h:|c:nom[!]=type | body=Schéma(ct)[!] | ok=code:Schéma | rh=en-têtes | err=codes:Schéma
  F Schéma.champ type[!][?] [contraintes] [ro|wo|dep]      ! = requis   ? = nullable
YAML : PyYAML, sinon `yq` (mikefarah ou python-yq). Le reste : stdlib.
"""
import argparse
import json
import os
import re
import signal
import subprocess
import sys

METHODS = ('get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace')
CONSTRAINTS = (('minLength', 'minLen'), ('maxLength', 'maxLen'), ('minimum', 'min'),
               ('maximum', 'max'), ('exclusiveMinimum', 'xmin'), ('exclusiveMaximum', 'xmax'),
               ('multipleOf', 'step'), ('minItems', 'minItems'), ('maxItems', 'maxItems'),
               ('uniqueItems', 'unique'), ('pattern', 'pattern'), ('default', 'default'))
CT_SHORT = {'application/json': 'json', 'multipart/form-data': 'multipart',
            'application/x-www-form-urlencoded': 'form', 'application/octet-stream': 'binary',
            'application/problem+json': 'problem', 'text/plain': 'text'}
LOC = {'path': 'p', 'query': 'q', 'header': 'h', 'cookie': 'c'}
GRAPHQL_EXT = ('.graphql', '.gql', '.graphqls', '.sdl')
SNIFF = (('postman', re.compile(r'schema\.getpostman\.com|"_postman_id"')),
         ('openapi', re.compile(r'(?m)^["\']?openapi["\']?\s*:|"openapi"\s*:')),
         ('swagger', re.compile(r'(?m)^["\']?swagger["\']?\s*:|"swagger"\s*:')),
         ('asyncapi', re.compile(r'(?m)^["\']?asyncapi["\']?\s*:|"asyncapi"\s*:')))


def sniff_kind(path, head=None):
    """Type de spec d'après le nom et les 4 premiers Ko (sans parser) : openapi, swagger,
    asyncapi, postman, graphql ou None."""
    low = path.lower()
    if low.endswith(GRAPHQL_EXT):
        return 'graphql'
    if not low.endswith(('.yaml', '.yml', '.json')):
        return None
    if head is None:
        try:
            with open(path, 'rb') as f:
                head = f.read(4096)
        except OSError:
            return None
    text = head.decode('utf-8', 'replace') if isinstance(head, bytes) else head
    for kind, rx in SNIFF:
        if rx.search(text):
            return kind
    return None


def load_structured(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        text = f.read()
    if text.lstrip()[:1] in ('{', '['):
        try:
            return json.loads(text)
        except ValueError:
            pass
    try:
        import yaml
    except ImportError:
        yaml = None
    if yaml is not None:
        return yaml.load(text, Loader=getattr(yaml, 'CSafeLoader', yaml.SafeLoader))
    for cmd in (['yq', '-o=json', '.', path], ['yq', '.', path]):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if r.returncode == 0 and r.stdout.strip():
            try:
                return json.loads(r.stdout)
            except ValueError:
                continue
    raise RuntimeError('YAML illisible : installer PyYAML (pip install pyyaml) ou yq')


def scal(v):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if v is None:
        return 'null'
    if isinstance(v, (dict, list)):
        s = json.dumps(v, separators=(',', ':'), ensure_ascii=False, default=str)
    else:
        s = str(v)
    return s if len(s) <= 60 else s[:57] + '...'


def short(text, n=90):
    s = ' '.join(str(text).split())
    return s if len(s) <= n else s[:n - 1] + '…'


def is_null(s):
    return isinstance(s, dict) and (s.get('type') == 'null' or s.get('enum') == [None])


def nullable(s):
    if not isinstance(s, dict):
        return False
    if s.get('nullable') is True or s.get('x-nullable') is True:
        return True
    t = s.get('type')
    if isinstance(t, list) and 'null' in t:
        return True
    if any(is_null(x) for k in ('oneOf', 'anyOf') for x in (s.get(k) or [])):
        return True
    return isinstance(s.get('enum'), list) and None in s['enum']


def cons_list(s):
    out = []
    if isinstance(s, dict):
        for key, name in CONSTRAINTS:
            v = s.get(key)
            if v is None or (v is False and key != 'default'):
                continue
            out.append(name if v is True and key != 'default' else f'{name}={scal(v)}')
    return out


def cons(s):
    c = cons_list(s)
    return ' ' + ' '.join(c) if c else ''


def flags(s):
    f = []
    if isinstance(s, dict):
        f += [n for k, n in (('readOnly', 'ro'), ('writeOnly', 'wo'), ('deprecated', 'dep')) if s.get(k)]
    return ' ' + ' '.join(f) if f else ''


def has_inline_props(s):
    return isinstance(s, dict) and '$ref' not in s and bool(
        s.get('properties') or any(isinstance(x, dict) and x.get('properties') for x in s.get('allOf') or []))


class Digest:
    def __init__(self, path, doc, desc=False):
        self.root = os.path.abspath(path)
        self.docs = {self.root: doc}
        self.desc = desc
        self.out = []
        self.inline = []  # (propriétaire, schéma, base) détaillés après les endpoints

    # -- résolution des $ref (locaux et fichiers relatifs) -------------------------------
    def doc(self, path):
        if path not in self.docs:
            try:
                self.docs[path] = load_structured(path)
            except Exception:  # fichier absent ou illisible : ref non résolue
                self.docs[path] = None
        return self.docs[path]

    @staticmethod
    def refname(ref):
        file, _, frag = str(ref).partition('#')
        if frag.strip('/'):
            return frag.rstrip('/').split('/')[-1].replace('~1', '/').replace('~0', '~')
        return os.path.splitext(os.path.basename(file))[0]

    def deref(self, node, base):
        depth = 0
        while isinstance(node, dict) and isinstance(node.get('$ref'), str) and depth < 25:
            depth += 1
            file, _, frag = node['$ref'].partition('#')
            if file:
                if '://' in file:
                    return node, base  # ref distante : non suivie
                base = os.path.normpath(os.path.join(os.path.dirname(base), file))
            target = self.doc(base)
            for part in (p for p in frag.split('/') if p):
                part = part.replace('~1', '/').replace('~0', '~')
                if isinstance(target, dict):
                    target = target.get(part)
                elif isinstance(target, list) and part.isdigit() and int(part) < len(target):
                    target = target[int(part)]
                else:
                    target = None
                if target is None:
                    return {}, base
            node = target
        return node, base

    # -- types ------------------------------------------------------------------------------
    def tname(self, s, base, depth=0):
        if not isinstance(s, dict) or depth > 6:
            return 'any'
        if '$ref' in s:
            ref = str(s['$ref'])
            if not ref.startswith('#') and '://' not in ref:
                self.inline.append((self.refname(ref), s, base))  # schéma d'un fichier externe : détaillé plus bas
            return self.refname(ref)
        for comb in ('oneOf', 'anyOf'):
            if isinstance(s.get(comb), list):
                alts = list(dict.fromkeys(self.tname(x, base, depth + 1) for x in s[comb] if not is_null(x)))
                if alts:
                    return alts[0] if len(alts) == 1 else f"{comb}({'|'.join(alts)})"
        if isinstance(s.get('allOf'), list):
            parts = [self.tname(x, base, depth + 1) for x in s['allOf']]
            named = [p for p in parts if p not in ('object', 'any')]
            if len(parts) == 1 and named:
                return named[0]
            return 'allOf(' + '&'.join(named or ['object']) + ')'
        t = s.get('type')
        if isinstance(t, list):
            t = [x for x in t if x != 'null']
            t = t[0] if len(t) == 1 else ('|'.join(map(str, t)) or None)
        if isinstance(s.get('enum'), list) and t != 'array':
            return 'enum(' + '|'.join(scal(v) for v in s['enum'] if v is not None) + ')'
        if 'const' in s:
            return f"const({scal(s['const'])})"
        if t == 'array' or 'items' in s:
            return self.tname(s.get('items') or {}, base, depth + 1) + '[]'
        if t == 'object' or 'properties' in s or 'additionalProperties' in s:
            ap = s.get('additionalProperties')
            if not s.get('properties') and isinstance(ap, dict):
                return f'map<{self.tname(ap, base, depth + 1)}>'
            return 'object'
        fmt = s.get('format')
        if not t:
            return str(fmt) if fmt else 'any'
        return f'{t}({fmt})' if fmt else str(t)

    def label(self, sch, base, owner):
        """Nom court d'un schéma de body/réponse ; un objet inline est détaillé plus bas."""
        if not isinstance(sch, dict) or not sch:
            return '-'
        if '$ref' in sch:
            return self.refname(sch['$ref'])
        if has_inline_props(sch):
            self.inline.append((owner, sch, base))
            return owner
        items = sch.get('items')
        if has_inline_props(items):
            self.inline.append((owner, items, base))
            return owner + '[]'
        return self.tname(sch, base)

    # -- schémas ----------------------------------------------------------------------------
    def props(self, s, base, depth=0):
        """Propriétés avec allOf aplati → ({nom: (schéma, base)}, requis)."""
        out, req = {}, set()
        s, base = self.deref(s, base)
        if not isinstance(s, dict) or depth > 8:
            return out, req
        for part in s.get('allOf') or []:
            p, r = self.props(part, base, depth + 1)
            out.update(p)
            req |= r
        for name, ps in (s.get('properties') or {}).items():
            out[name] = (ps, base)
        req |= {x for x in (s.get('required') or []) if isinstance(x, str)}
        return out, req

    def schema(self, owner, s, base, depth=0):
        s, base = self.deref(s, base)
        if not isinstance(s, dict):
            return
        fields, req = self.props(s, base)
        head = []
        refs = [self.refname(x['$ref']) for x in s.get('allOf') or [] if isinstance(x, dict) and '$ref' in x]
        if refs:
            head.append('allOf(' + '&'.join(refs) + ')')
        for comb in ('oneOf', 'anyOf'):
            if isinstance(s.get(comb), list) and not fields:
                head.append(self.tname({comb: s[comb]}, base))
        disc = s.get('discriminator')
        if isinstance(disc, dict) and disc.get('propertyName'):
            head.append('disc=' + str(disc['propertyName']))
        elif isinstance(disc, str):
            head.append('disc=' + disc)
        if not head:
            head.append('object' if fields else self.tname(s, base))
        line = f"S {owner} {' '.join(head)}"
        if not fields:
            line += cons(s) + ('?' if nullable(s) else '')
        line += flags(s)
        if self.desc and s.get('description'):
            line += f' "{short(s["description"])}"'
        self.out.append(line)
        for name, (ps, pbase) in fields.items():
            self.field(owner, name, ps, pbase, name in req, depth)

    def field(self, owner, name, ps, base, required, depth):
        mark = ('!' if required else '') + ('?' if nullable(ps) else '')
        line = f'F {owner}.{name} {self.tname(ps, base)}{mark}{cons(ps)}{flags(ps)}'
        if self.desc and isinstance(ps, dict) and ps.get('description'):
            line += f' "{short(ps["description"])}"'
        self.out.append(line)
        if depth >= 3 or not isinstance(ps, dict):
            return
        if has_inline_props(ps):
            self.schema(f'{owner}.{name}', ps, base, depth + 1)
        elif has_inline_props(ps.get('items')):
            self.schema(f'{owner}.{name}[]', ps['items'], base, depth + 1)

    # -- sécurité / serveurs ----------------------------------------------------------------
    @staticmethod
    def auth(reqs):
        if not isinstance(reqs, list):
            return None
        alts = []
        for req in reqs:
            if not req:
                alts.append('none')
            elif isinstance(req, dict):
                alts.append('+'.join(k + (f"[{','.join(map(str, v))}]" if v else '') for k, v in req.items()))
        return '|'.join(alts) or 'none'

    def security_schemes(self, schemes):
        for name, s in (schemes or {}).items():
            s, _ = self.deref(s, self.root)
            if not isinstance(s, dict):
                continue
            t = s.get('type')
            if t == 'http':
                d = f"http {s.get('scheme')}" + (f"({s['bearerFormat']})" if s.get('bearerFormat') else '')
            elif t in ('apiKey', 'httpApiKey'):
                d = f"apiKey {s.get('in')}:{s.get('name')}"
            elif t == 'oauth2':
                flows = s.get('flows') or ({s['flow']: s} if s.get('flow') else {})
                fl = []
                for fname, f in flows.items():
                    if not isinstance(f, dict):
                        continue
                    urls = [f'{k[:-3]}={f[k]}' for k in ('authorizationUrl', 'tokenUrl', 'refreshUrl') if f.get(k)]
                    scopes = f.get('scopes') or f.get('availableScopes') or {}
                    if scopes:
                        urls.append('scopes=' + ','.join(map(str, scopes)))
                    fl.append(f"{fname}({' '.join(urls)})")
                d = 'oauth2 ' + ' '.join(fl)
            elif t == 'openIdConnect':
                d = f"oidc {s.get('openIdConnectUrl')}"
            else:
                d = str(t)
            self.out.append(f'SEC {name} {d}')

    def servers(self, doc):
        for s in doc.get('servers') or []:
            if not isinstance(s, dict):
                continue
            var = s.get('variables') or {}
            vs = ' '.join(f"{k}={'|'.join(map(str, v.get('enum') or [v.get('default')]))}"
                          for k, v in var.items() if isinstance(v, dict))
            self.out.append(f"SERVER {s.get('url')}" + (f' | {vs}' if vs else '')
                            + (f" | {short(s['description'], 40)}" if s.get('description') else ''))
        if doc.get('host'):
            schemes = '|'.join(doc.get('schemes') or ['https'])
            self.out.append(f"SERVER {schemes}://{doc['host']}{doc.get('basePath', '')}")

    # -- OpenAPI / Swagger ------------------------------------------------------------------
    def params(self, plist, base):
        merged = {}
        for p in plist or []:
            p, pb = self.deref(p, base)
            if isinstance(p, dict) and 'name' in p:
                merged[(p.get('in'), p['name'])] = (p, pb)
        out, body, form = [], None, []
        for (loc, name), (p, pb) in merged.items():
            req = '!' if p.get('required') else ''
            if loc == 'body':
                body = (p.get('schema'), pb, p.get('required'))
                continue
            sch = p.get('schema') if isinstance(p.get('schema'), dict) else p
            if loc == 'formData':
                form.append(f'{name}{req}:{self.tname(sch, pb)}')
                continue
            c = cons_list(sch)
            out.append(f"{LOC.get(loc, loc)}:{name}{req}={self.tname(sch, pb)}" + (f"[{','.join(c)}]" if c else ''))
        return out, body, form

    def responses(self, op, base, opname):
        ok, err, errt, rh = [], [], set(), set()
        for code, resp in (op.get('responses') or {}).items():
            code = str(code)
            r, rb = self.deref(resp, base)
            if not isinstance(r, dict):
                continue
            labels = []
            content = r.get('content')
            if isinstance(content, dict):
                for ct, media in content.items():
                    lab = self.label((media or {}).get('schema'), rb, f'{opname}.{code}')
                    if lab != '-':
                        labels.append(lab + ('(problem)' if ct == 'application/problem+json' else ''))
            elif isinstance(r.get('schema'), dict):
                labels.append(self.label(r['schema'], rb, f'{opname}.{code}'))
            labels = list(dict.fromkeys(labels))
            heads = sorted(map(str, (r.get('headers') or {}).keys()))
            if code[:1] in '123':
                ok.append(code + (':' + ','.join(labels) if labels else ''))
                rh.update(heads)
            else:
                err.append(code + (f"[{','.join(heads)}]" if heads else ''))
                errt.update(labels)
        return ok, err, errt, rh

    def endpoint(self, m, path, op, common, base, glob, consumes):
        opname = op.get('operationId') or re.sub(r'[^A-Za-z0-9]+', '_', f'{m}_{path}').strip('_')
        auth = self.auth(op['security']) if 'security' in op else (glob or 'none')
        prm, body2, form = self.params(list(common) + list(op.get('parameters') or []), base)
        parts = [f'EP {m.upper()} {path}']
        if op.get('operationId'):
            parts.append(f"op={op['operationId']}")
        parts.append(f'auth={auth}')
        if prm:
            parts.append('in=' + ' '.join(prm))
        body = None
        rb, rbase = self.deref(op.get('requestBody'), base)
        if isinstance(rb, dict) and rb:
            bl = []
            for ct, media in (rb.get('content') or {}).items():
                lab = self.label((media or {}).get('schema'), rbase, opname + '.body')
                bl.append(f'{lab}({CT_SHORT.get(ct, ct)})')
            body = ','.join(dict.fromkeys(bl)) + ('!' if rb.get('required') else '')
        elif body2:
            body = self.label(body2[0], body2[1], opname + '.body') + '(json)' + ('!' if body2[2] else '')
        elif form:
            ct = 'multipart' if 'multipart/form-data' in (op.get('consumes') or consumes or []) else 'form'
            body = f"{ct}{{{','.join(form)}}}"
        if body:
            parts.append('body=' + body)
        ok, err, errt, rh = self.responses(op, base, opname)
        if ok:
            parts.append('ok=' + ','.join(ok))
        if rh:
            parts.append('rh=' + ','.join(sorted(rh)))
        if err:
            parts.append('err=' + ','.join(err) + (':' + '|'.join(sorted(errt)) if errt else ''))
        if op.get('deprecated'):
            parts.append('dep')
        if op.get('x-internal'):
            parts.append('internal')
        if op.get('tags'):
            parts.append('tags=' + ','.join(map(str, op['tags'])))
        if self.desc and (op.get('summary') or op.get('description')):
            parts.append('"' + short(op.get('summary') or op.get('description')) + '"')
        self.out.append(' | '.join(parts))

    def openapi(self, doc, kind):
        info = doc.get('info') or {}
        self.out.append(f"META {kind} {doc.get(kind)} | {info.get('title', '')} | v{info.get('version', '?')}")
        self.servers(doc)
        comps = doc.get('components') or {}
        self.security_schemes(comps.get('securitySchemes') or doc.get('securityDefinitions'))
        glob = self.auth(doc.get('security'))
        if glob:
            self.out.append(f'SEC* {glob}')
        for path, item in (doc.get('paths') or {}).items():
            item, ib = self.deref(item, self.root)
            if not isinstance(item, dict):
                continue
            for m in METHODS:
                if isinstance(item.get(m), dict):
                    self.endpoint(m, path, item[m], item.get('parameters') or [], ib, glob, doc.get('consumes'))
        for name, item in (doc.get('webhooks') or {}).items():
            item, ib = self.deref(item, self.root)
            for m in METHODS:
                op = item.get(m) if isinstance(item, dict) else None
                if isinstance(op, dict):
                    rb, rbase = self.deref(op.get('requestBody'), ib)
                    labs = [self.label((md or {}).get('schema'), rbase, f'{name}.body')
                            for md in ((rb or {}).get('content') or {}).values()]
                    self.out.append(f"WH {name} {m.upper()}" + (f" | body={','.join(labs)}" if labs else ''))
        for name, s in (comps.get('schemas') or doc.get('definitions') or {}).items():
            self.schema(name, s, self.root)
        self.flush_inline()

    def flush_inline(self):
        done = set()
        while self.inline:
            owner, s, base = self.inline.pop(0)
            if owner not in done:
                done.add(owner)
                self.schema(owner, s, base)

    # -- AsyncAPI ---------------------------------------------------------------------------
    def msg_names(self, m, base, owner):
        if not isinstance(m, dict):
            return []
        if '$ref' in m:
            return [self.refname(m['$ref'])]
        if isinstance(m.get('oneOf'), list):
            return [n for x in m['oneOf'] for n in self.msg_names(x, base, owner)]
        name = str(m.get('name') or m.get('messageId') or owner)
        self.message(name, m, base)
        return [name]

    def message(self, name, m, base):
        m, mb = self.deref(m, base)
        if not isinstance(m, dict):
            return
        payload = m.get('payload')
        lab = self.label(payload, mb, f'{name}.payload') if payload else '-'
        line = f'MSG {name} | payload={lab}'
        if self.desc and (m.get('summary') or m.get('description')):
            line += ' | "' + short(m.get('summary') or m.get('description')) + '"'
        self.out.append(line)

    def asyncapi(self, doc):
        info = doc.get('info') or {}
        ver = str(doc.get('asyncapi'))
        self.out.append(f"META asyncapi {ver} | {info.get('title', '')} | v{info.get('version', '?')}")
        for name, s in (doc.get('servers') or {}).items():
            s, _ = self.deref(s, self.root)
            if isinstance(s, dict):
                url = s.get('url') or f"{s.get('host', '')}{s.get('pathname', '')}"
                self.out.append(f"SERVER {url} | {s.get('protocol', '')} | {name}")
        comps = doc.get('components') or {}
        self.security_schemes(comps.get('securitySchemes'))
        if ver.startswith('2'):
            for ch, item in (doc.get('channels') or {}).items():
                item, ib = self.deref(item, self.root)
                for action in ('subscribe', 'publish'):
                    op = item.get(action) if isinstance(item, dict) else None
                    if isinstance(op, dict):
                        msgs = self.msg_names(op.get('message'), ib, f"{op.get('operationId') or ch}.msg")
                        self.out.append(f'CH {ch} | {action}' + (f" | op={op['operationId']}" if op.get('operationId') else '')
                                        + f" | msg={','.join(msgs) or '-'}")
        else:
            for cid, ch in (doc.get('channels') or {}).items():
                ch, cb = self.deref(ch, self.root)
                if not isinstance(ch, dict):
                    continue
                names = []
                for mk, mv in (ch.get('messages') or {}).items():
                    if isinstance(mv, dict) and '$ref' in mv:
                        names.append(self.refname(mv['$ref']))
                    else:
                        self.message(mk, mv, cb)
                        names.append(mk)
                self.out.append(f"CH {ch.get('address', cid)} | id={cid} | msg={','.join(names) or '-'}")
            for oid, op in (doc.get('operations') or {}).items():
                op, ob = self.deref(op, self.root)
                if not isinstance(op, dict):
                    continue
                chn, _ = self.deref(op.get('channel') or {}, ob)
                addr = (chn or {}).get('address') or self.refname((op.get('channel') or {}).get('$ref', '?'))
                msgs = [self.refname(x['$ref']) for x in op.get('messages') or [] if isinstance(x, dict) and '$ref' in x]
                self.out.append(f"OP {op.get('action')} {addr} | op={oid}" + (f" | msg={','.join(msgs)}" if msgs else ''))
        for name, m in (comps.get('messages') or {}).items():
            self.message(name, m, self.root)
        for name, s in (comps.get('schemas') or {}).items():
            self.schema(name, s, self.root)
        self.flush_inline()

    # -- Postman ----------------------------------------------------------------------------
    def postman(self, doc):
        info = doc.get('info') or {}
        self.out.append(f"META postman | {info.get('name', '')}")
        for v in doc.get('variable') or []:
            if isinstance(v, dict) and re.search(r'url|host|base', str(v.get('key', '')), re.I):
                self.out.append(f"SERVER {v.get('value', '')} | var={v.get('key')}")
        top = (doc.get('auth') or {}).get('type')
        if top:
            self.out.append(f'SEC* {top}')
        self.walk(doc.get('item') or [], [], top)

    def walk(self, items, folder, auth):
        for it in items:
            if not isinstance(it, dict):
                continue
            a = (it.get('auth') or {}).get('type') or auth
            if isinstance(it.get('item'), list):
                self.walk(it['item'], folder + [str(it.get('name', ''))], a)
                continue
            req = it.get('request')
            if isinstance(req, str):
                req = {'method': 'GET', 'url': req}
            if not isinstance(req, dict):
                continue
            a = (req.get('auth') or {}).get('type') or a
            url = req.get('url')
            raw = url.get('raw') if isinstance(url, dict) else url
            if isinstance(url, dict) and not raw:
                raw = '/' + '/'.join(map(str, url.get('path') or []))
            rest = re.sub(r'^(\{\{[^}]+\}\}|https?://[^/?#]+)', '', str(raw or ''))
            path, _, query = rest.partition('?')
            parts = [f"EP {str(req.get('method', 'GET')).upper()} {path or '/'}",
                     'name=' + '/'.join(folder + [str(it.get('name', ''))]), f"auth={a or 'none'}"]
            qk = [q.split('=')[0] for q in query.split('&') if q]
            if qk:
                parts.append('q=' + ','.join(qk))
            body = req.get('body') or {}
            mode = body.get('mode')
            if mode == 'raw' and body.get('raw'):
                keys = list(dict.fromkeys(re.findall(r'"([A-Za-z_][\w-]*)"\s*:', str(body['raw']))))
                parts.append('body=' + ('json{' + ','.join(keys) + '}' if keys else 'raw'))
            elif mode in ('formdata', 'urlencoded'):
                keys = [f"{x.get('key')}{':file' if x.get('type') == 'file' else ''}"
                        for x in body.get(mode) or [] if isinstance(x, dict)]
                parts.append(f"body={mode}{{{','.join(keys)}}}")
            elif mode:
                parts.append(f'body={mode}')
            self.out.append(' | '.join(parts))


def graphql_digest(text):
    t = re.sub(r'"""[\s\S]*?"""', ' ', text)
    t = re.sub(r'(?m)^\s*"(?:[^"\\\n]|\\.)*"\s*$', ' ', t)
    t = re.sub(r'#[^\n]*', ' ', t)
    t = re.sub(r'@deprecated\b(\s*\([^)]*\))?', ' @dep ', t)
    t = re.sub(r'@(?!dep\b)\w+(\s*\([^)]*\))?', ' ', t)
    out = []
    for m in re.finditer(r'\b(extend\s+)?(type|input|interface)\s+(\w+)([^{]*)\{([^}]*)\}', t):
        ext, kind, name, head, body = m.groups()
        impl = re.search(r'implements\s+&?\s*([\w\s&,]+)', head)
        out.append(f"T {'extend ' if ext else ''}{kind} {name}"
                   + (' implements ' + '&'.join(re.findall(r'\w+', impl.group(1))) if impl else ''))
        for f in re.finditer(r'(\w+)\s*(\([^)]*\))?\s*:\s*([\[\]\w!]+)(\s*=\s*(?:"[^"]*"|[^\s@)]+))?(\s*@dep)?', body):
            fname, args, ftype, default, dep = f.groups()
            if args:
                args = re.sub(r'\s+', ' ', args)
                args = re.sub(r'\s*:\s*', ':', re.sub(r'\(\s*|\s*\)', lambda x: x.group(0).strip(), args))
            dflt = ' default=' + default.split('=', 1)[1].strip() if default else ''
            out.append(f"F {name}.{fname}{args or ''} {ftype}{dflt}{' dep' if dep else ''}")
    for m in re.finditer(r'\benum\s+(\w+)[^{]*\{([^}]*)\}', t):
        vals = [v for v in re.findall(r'[A-Za-z_]\w*', m.group(2)) if v != 'dep']
        out.append(f"E {m.group(1)} {'|'.join(vals)}")
    for m in re.finditer(r'\bunion\s+(\w+)[^=]*=\s*\|?\s*(\w+(?:\s*\|\s*\w+)*)', t):
        out.append(f"U {m.group(1)} {'|'.join(re.findall(r'[A-Za-z_]\w*', m.group(2)))}")
    for m in re.finditer(r'\bscalar\s+(\w+)', t):
        out.append(f'SC {m.group(1)}')
    return list(dict.fromkeys(out))


def digest_file(path, desc=False):
    """Lignes du digest ; ValueError si le fichier n'est pas une spec reconnue."""
    if path.lower().endswith(GRAPHQL_EXT):
        with open(path, encoding='utf-8', errors='replace') as f:
            return graphql_digest(f.read())
    doc = load_structured(path)
    if not isinstance(doc, dict):
        raise ValueError('document non structuré')
    if isinstance(doc.get('info'), dict) and isinstance(doc.get('item'), list):
        kind = 'postman'
    else:
        kind = next((k for k in ('openapi', 'swagger', 'asyncapi') if k in doc), None)
    if not kind:
        raise ValueError('format de spec non reconnu')
    d = Digest(path, doc, desc)
    if kind == 'asyncapi':
        d.asyncapi(doc)
    elif kind == 'postman':
        d.postman(doc)
    else:
        d.openapi(doc, kind)
    return list(dict.fromkeys(d.out))


def main(argv=None):
    if hasattr(signal, 'SIGPIPE'):
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    ap = argparse.ArgumentParser(description='Digest compact d\'une spec d\'API (1 fait par ligne).')
    ap.add_argument('file')
    ap.add_argument('--desc', action='store_true', help='ajoute summaries/descriptions tronqués')
    a = ap.parse_args(argv)
    try:
        lines = digest_file(a.file, a.desc)
    except Exception as e:  # message court, pas de traceback dans le contexte
        print(f'ERREUR {a.file} : {e}', file=sys.stderr)
        return 2
    sys.stdout.write('\n'.join(lines) + ('\n' if lines else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
