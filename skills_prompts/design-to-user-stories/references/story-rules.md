# Story rules

Open when writing module YAML (INIT steps 7 and 8) and when fixing what validate.py reports.

Contents: 1 What a story is · 2 Splitting · 3 Writing · 4 Sections · 5 Tests · 6 Structure rules · 7 Lint · 8 YAML format

## 1. What a story is

One story = one self-contained change = one PR with its tests, never breaking the build (Google "small CLs"). INVEST: independent, negotiable, valuable, estimable, small, testable.

Budgets, calibrated on the target agent (Claude Sonnet 5.5, medium effort). render_stories.py refuses to write a story over budget; validate.py rechecks.

| item | budget | why |
|---|---|---|
| production code | about 100–200 lines, max 400 | past that, the agent loses track and starts skipping tests |
| production files (create + modify, tests and config excluded) | ≤ 5 | each extra file is another place to forget a check |
| acceptance criteria | ≤ 7 | more means two stories |
| story file | ≤ 120 lines, ~1,500 tokens | the agent reads it whole, every time |
| context | ≤ 15 lines, inlined fields and constraints included | only what this story touches |
| read_first | ≤ 2 files besides CONVENTIONS.md | every file read costs the agent's budget |
| each module file, CONVENTIONS.md | ≤ 150 lines | |
| README.md | ≤ 30 lines | |

size: XS under 50 lines of production code, S 50–200, M 200–400. Larger: split.

## 2. Splitting (SPIDR, without spikes)

Split an over-budget story along one axis, each slice still shipping working code with its tests:
- Paths: the happy path first; alternative and error paths as follow-ups.
- Interfaces: one endpoint, screen or consumer at a time.
- Data: a subset of fields or variants first.
- Rules: the core rule first; extra business rules as follow-ups.
Never write a spike (open-ended research): an unknown goes to OPEN_QUESTIONS.md, and the story lists it under Out of scope.

## 3. Writing

- Terse imperative bullets. Keep a line only if removing it would make the agent err.
- Be specific (file, function, command, status code, limit), never explanatory.
- Refer by ID: AC-n, AB-n, constraint IDs, ASVS IDs (`v5.0.0-x.y.z`), story and question IDs.
- Scenario Outline + Examples instead of near-duplicate scenarios; boundaries go in Examples.
- Shared content lives once, in CONVENTIONS.md or the module files; stories never restate it. validate.py rejects any 4-line block repeated across stories.
- Use GLOSSARY.md terms for concepts; keep identifiers verbatim from the design (entities, fields, enum values, constraint names). The renderer inlines fields and constraints from the design for you.
- Priority only when the design states one; order comes from depends_on.

## 4. Sections (YAML key → story section)

- `story`: "As a <role>, I want <action> so that <benefit>." The role is one of the project's `roles` (verbatim from the design). Technical work: "Technical story: <what> so that <why>."
- `context`: what exists, with the story that created it, and what this story adds. `fields` and `constraints` lines are appended by the renderer.
- `acceptance` (Gherkin): `Scenario: AC-1 <title>` or `Scenario Outline: AC-2 <title>` with Examples. Happy path, errors, boundaries. Steps name concrete values, endpoints and status codes.
- `abuse` (Gherkin, `AB-n`): for any protected resource or action, at least unauthorized horizontal access (another user's or tenant's object) and vertical access (a lower role); plus the MODULE.md threats this story exposes. Patterns: security.md §5. A story with no protected resource or action omits `abuse`.
- `implementation`: `read`, `create`, `modify` (project-root-relative paths), `pattern`, `signatures`, `types`, `errors` (`CODE status`), `dependencies` (allowlisted names only).
- `security`: story-specific rules only, each starting with its ASVS ID (`"v5.0.0-8.2.2: scope the query by owner_id"`). Every ID also appears in `asvs`.
- `tests`: one row per test, `name | unit, integration or security | covers | input → expected`; `command`: the exact command that runs only this story's tests.
- `out_of_scope`: neighbouring work, with the story or question ID that owns it.

## 5. Tests

- Every AC, every AB and every constraint in `constraints` is covered by at least one row (`covers`), and a row covers only IDs of the story, WSTG test IDs or CWE IDs.
- Constraints are enforced in the database and in the validation layer, by default. Test both, with valid, invalid and boundary values (ISTQB boundary-value analysis: the limit, just inside, just outside): one test through the API (validation), one inserting directly (the database rejects the row even when validation is bypassed).
- Security tests cite their WSTG test when one fits (security.md §5).
- Fake data only: no real names, phone numbers or e-mails.
- A change story amending a done story adds `tests_to_update`: `existing test | reason | new expectation` (sync.md §4).

## 6. Structure rules

- depends_on: only real prerequisites (a table, a contract, a pattern file). Upstream modules are rendered first.
- Pattern file: the closest existing file to imitate, or a file created by a dependency. FND-000's health endpoint and its test are the first patterns.
- read_first: typically the contracts.md the story consumes, and the pattern file. Agents read whole files, so never point to an #anchor.
- Every path is relative to the project root: `docs/stories/modules/auth/contracts.md`, `src/...`. validate.py checks that each file read, modified or used as pattern exists or is created by a dependency, and that no file is created by two stories.
- Third-party integrations go through a port (interface) and an adapter, with a fake adapter in tests. No story needs real credentials or sandbox access.
- A new interface ships with its first usage: no story creates code that nothing calls.
- The first story of a module usually creates its tables with every database constraint of its entities (kind: technical), unless it is small enough to ship with the first feature.
- kind: feature (user-visible behavior), technical (tables, tooling, shared code), test (characterization tests); change, migration and removal are for shipped code (sync.md §4, §5); change and removal name the story they amend in `amends`. A migration is risk: high.
- risk: see security.md §3.

## 7. Lint (validate.py rejects)

- packages outside the CONVENTIONS.md allowlist, in Dependencies or in an install command;
- instructions to disable checks, or to skip, weaken or delete tests (`.skip(`, `eslint-disable`, `@ts-ignore`, `--no-verify`, "skip the tests");
- secret-like strings;
- URLs not listed in CONVENTIONS.md;
- vague terms: "as appropriate", "etc.", "fast", "user-friendly", "handle properly", "if possible", "as needed", "and so on", "properly", "appropriately", "gracefully", "intuitive", "robust", "seamless", "reasonable";
- `Entity.field` references absent from the design;
- blocks of 4 identical lines repeated across stories (front matter and Gherkin steps excluded).

## 8. YAML format (input of render_stories.py)

Write one document per file in `$OUT/_meta/src/`. Block scalars (`|`) for multi-line text. Quote strings that contain `: ` or start with a special character.

### Project (`project.yaml`)

```yaml
kind: project
name: Mini catalog                  # product name from the design
design: docs/design.md              # relative to the project root
out: docs/stories
asvs_level: L2
roles: [visitor, seller, admin]     # the only roles allowed in "As a <role>", from the design
stack:                              # one line each, exact versions
  - Node.js 22 (LTS)
commands:                           # purpose: command (rendered as a table)
  install: npm ci
  test one file: npx vitest run <test-file>
  full suite: npm test
layout:                             # where code, tests, migrations go; naming
  - "`src/modules/<module>/`: `<name>.routes.ts`, `<name>.service.ts`, `<name>.schemas.ts`"
dependencies:                       # scope: {package: exact version}
  runtime: {express: 5.1.0}
  dev: {vitest: 4.0.9}
  ci: {actions/checkout: v7}
urls: [http://localhost:3000]       # the only URLs code and stories may reference
glossary:                           # term | design term(s) | meaning
  - "seller | `SELLER`, vendeur | account that manages its own products"
# optional, appended to the matching CONVENTIONS sections:
errors: []
logging: []
validation: []
secrets: []
migrations: []
baseline: ["v5.0.0-9.2.1: access tokens expire after 15 minutes, refresh tokens after 30 days"]
baseline_omit: []                   # queries, authorization, passwords, tokens, rate-limit, input-size, security-logging
rules: []                           # design-wide requirements (NFRs) every story obeys, e.g. pagination limits
agent: Claude Sonnet 5.5 (`claude-sonnet-5-5`, medium effort)   # optional; defaults.yaml otherwise
```

### Module (`<module>.yaml`)

```yaml
kind: module
module: catalog                     # folder name, kebab-case
prefix: CAT                         # story ID prefix, 2-6 uppercase letters
title: Catalog
responsibility: Owns products and each seller's catalog.
entities: [Product]                 # owned entities, verbatim; [] for foundation
depends_on: [auth]                  # modules
asvs_level: L2
asvs_rationale: Catalogs are business data isolated per seller.
classification:                     # data | class | handling
  - "Product.price | confidential | returned to the owner and admins only"
threats:                            # ID | STRIDE | threat | mitigation | abuse cases
  - "T1 | E | Seller edits another seller's product | owner_id from the session in every query | CAT-003 AB-1"
constraints:                        # English rule for each C-/CM- constraint this module owns, when the design is not in English
  C-04: "`price` > 0"
contracts:
  provides:
    - name: ProductCatalog
      file: src/modules/catalog/product.service.ts
      story: CAT-002                # story that creates it
      items:
        - "getActiveProduct(id: string): Promise<ProductView> — NOT_FOUND unless ACTIVE"
      used_by: [orders]
  consumes:
    - "auth: requireAuth(roles) from docs/stories/modules/auth/contracts.md"
pointers: ["Decision: `docs/stories/decisions/ADR-001-module-decomposition.md`"]   # optional
model: |                            # only for entities the extractor could not read
  ...
stories: [...]                      # see below
```

### Story (an item of `stories`)

```yaml
- id: CAT-002
  title: Seller creates a product
  kind: feature                     # feature, technical, change, migration, removal, test
  size: S                           # XS, S, M
  risk: medium                      # low, medium, high
  priority: high                    # only when the design states one
  depends_on: [CAT-001, AUTH-005]
  read_first: [docs/stories/modules/auth/contracts.md, src/modules/auth/logout.routes.ts]
  design_refs: [catalogue/product]  # anchors from the index outline
  constraints: [Product:required, C-03, C-04]
  asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]
  fields: ["Product.{name,description,price}"]   # inlined from the design into Context
  story: As a seller, I want to add a product to my catalog so that buyers can see it.
  context: |
    - Exists: `Product` table (CAT-001); `requireAuth()` (AUTH-005).
    - Adds: `POST /api/v1/products`; the owner comes from the session.
  acceptance: |
    Scenario: AC-1 Seller creates a product
      Given a signed-in seller
      When they POST /api/v1/products with name "Rice 25 kg" and price 18000
      Then the response is 201 with status ACTIVE and owner_id = their account id
  abuse: |
    Scenario: AB-1 Owner chosen by the client (horizontal)
      When a seller posts owner_id of another seller
      Then the response is 422 and nothing is stored
  implementation:
    create: [src/modules/catalog/product.routes.ts, tests/catalog/product.create.test.ts]
    modify: [src/app.ts]
    pattern: src/modules/auth/logout.routes.ts
    signatures: ["createProduct(ownerId: string, input: CreateProductInput): Promise<ProductView>"]
    types: ["CreateProductInput = { name: string; description?: string; price: number }"]
    errors: ["VALIDATION_FAILED 422", "FORBIDDEN 403"]
    dependencies: [zod, express]
  security:
    - "v5.0.0-15.3.3: strict schema with name, description and price only."
  tests: |
    creates product | integration | AC-1, Product:required | valid body as seller → 201, owner_id = caller
    owner from session | security | AB-1, WSTG-ATHZ-04 | owner_id in body → 422
  command: npx vitest run tests/catalog/product.create.test.ts
  out_of_scope: ["Editing products (CAT-003)."]
```

Optional story keys: `rev` (default 1), `amends` and `tests_to_update` (change, migration and removal stories).

SYNC writes new stories for an existing module in a `kind: stories` document (`kind`, `module`, `stories`, optional `constraints` map): story files only, prefix from the index (sync.md §7).
