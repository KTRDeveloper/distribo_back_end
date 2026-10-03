#!/usr/bin/env node
// Resolves an /implement-stories selection into an ordered plan, so the
// orchestrator never loads STATUS.md, _meta/order.md or story files into its
// context. Reads only the front matter of the stories it needs.
//
// Usage: node select.mjs <selection...> [--with-deps] [--include-blocked] [--stories <folder>]
//   selection: ID | ID,ID | ID..ID (one module) | module:<name> | next:<N> | all
//   filters:   kind:<kind> | risk:<level> (narrow the selection)
// Output, one item per line, plan in the order of _meta/order.md:
//   PLAN <ID> <risk> <path> <title>   (or PLAN none)
//   SKIP <ID> <reason>
//   UNKNOWN <selector> | MISSING <ID> needs <dependency> (<status>)
// Exit codes: 0 plan ready; 1 usage error; 2 unknown selector or unmet dependency.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ID = /^[A-Z]+-\d+$/;

function usage(message) {
  process.stderr.write(
    `${message}\nusage: select.mjs <selection...> [--with-deps] [--include-blocked] [--stories <folder>]\n`
  );
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { selectors: [], filters: [], withDeps: false, includeBlocked: false, stories: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--with-deps') opts.withDeps = true;
    else if (arg === '--include-blocked') opts.includeBlocked = true;
    else if (arg === '--stories') opts.stories = argv[(i += 1)];
    else if (arg === '--keep-going' || arg === '--plan') continue; // orchestrator options
    else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
    else {
      for (const part of arg.split(',').map((s) => s.trim()).filter(Boolean)) {
        (/^(kind|risk):/.test(part) ? opts.filters : opts.selectors).push(part);
      }
    }
  }
  if (opts.stories === undefined) usage('--stories needs a folder');
  if (opts.selectors.length === 0) usage('no selection');
  return opts;
}

function storiesFolder(given) {
  if (given) return given;
  const found = ['docs/stories', 'stories'].find((dir) => existsSync(join(dir, 'STORY_MAP.md')));
  if (!found) usage('stories folder not found: pass --stories <folder>');
  return found;
}

const linesOf = (path) => readFileSync(path, 'utf8').split(/\r?\n/);
const cellsOf = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

// STATUS.md rows: `ID | status | reviewer | note` (outer pipes optional).
function readStatus(folder) {
  const status = new Map();
  for (const line of linesOf(join(folder, 'STATUS.md'))) {
    const cells = cellsOf(line);
    if (ID.test(cells[0]) && cells.length >= 2) status.set(cells[0], cells[1]);
  }
  return status;
}

// _meta/order.md items: `N. ID title (module)`.
function readOrder(folder) {
  const stories = [];
  for (const line of linesOf(join(folder, '_meta', 'order.md'))) {
    const match = /^\d+\.\s+([A-Z]+-\d+)\s+(.*)\s+\(([\w-]+)\)\s*$/.exec(line);
    if (match) {
      stories.push({ id: match[1], title: match[2].trim(), module: match[3], rank: stories.length });
    }
  }
  return stories;
}

function storyPath(folder, story) {
  const dir = join(folder, 'modules', story.module);
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((name) => name.startsWith(`${story.id}-`) && name.endsWith('.md'));
  return file ? join(dir, file) : null;
}

// Flat `key: value` and `key: [a, b]` lines between the first two `---`.
function frontMatter(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const block = /^---\n([\s\S]*?)\n---/.exec(text);
  const fields = {};
  for (const line of block ? block[1].split('\n') : []) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const value = kv[2].trim();
    fields[kv[1]] = value.startsWith('[')
      ? value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
      : value;
  }
  return fields;
}

const opts = parseArgs(process.argv.slice(2));
const folder = storiesFolder(opts.stories);
const status = readStatus(folder);
const order = readOrder(folder);
const byId = new Map(order.map((story) => [story.id, story]));
const stateOf = (id) => status.get(id) ?? 'unknown';
const problems = [];

function details(story) {
  if (!story.fields) {
    story.path = storyPath(folder, story);
    story.fields = story.path ? frontMatter(story.path) : {};
    if (!story.path) problems.push(`UNKNOWN ${story.id} (no story file)`);
  }
  return story;
}
const matchesFilters = (story) =>
  opts.filters.every((filter) => {
    const [key, value] = filter.split(':');
    return details(story).fields[key] === value;
  });
const depsOf = (story) => details(story).fields.depends_on ?? [];
const numberOf = (id) => Number(id.split('-')[1]);
const prefixOf = (id) => id.split('-')[0];

// 1. Expand the selectors; IDs and ranges count as named explicitly.
const chosen = new Set();
const named = new Set();
let next = 0;
for (const selector of opts.selectors) {
  if (selector === 'all') {
    order.filter((s) => stateOf(s.id) === 'todo').forEach((s) => chosen.add(s.id));
  } else if (selector.startsWith('module:')) {
    const inModule = order.filter((s) => s.module === selector.slice('module:'.length));
    if (inModule.length === 0) problems.push(`UNKNOWN ${selector}`);
    inModule.forEach((s) => chosen.add(s.id));
  } else if (selector.startsWith('next:')) {
    next = Number(selector.slice('next:'.length));
    if (!Number.isInteger(next) || next < 1) usage(`invalid ${selector}`);
  } else if (selector.includes('..')) {
    const [from, to] = selector.split('..');
    if (!byId.has(from) || !byId.has(to) || prefixOf(from) !== prefixOf(to)) {
      problems.push(`UNKNOWN ${selector}`);
    } else {
      order
        .filter(
          (s) =>
            prefixOf(s.id) === prefixOf(from) &&
            numberOf(s.id) >= numberOf(from) &&
            numberOf(s.id) <= numberOf(to)
        )
        .forEach((s) => {
          chosen.add(s.id);
          named.add(s.id);
        });
    }
  } else if (byId.has(selector)) {
    chosen.add(selector);
    named.add(selector);
  } else {
    problems.push(`UNKNOWN ${selector}`);
  }
}

// 2. Skip what must not run, with the reason.
function skipReason(id) {
  const state = stateOf(id);
  if (state === 'done' || state === 'obsolete') return state;
  if (state === 'blocked' && !named.has(id) && !opts.includeBlocked) {
    return 'blocked (name it or add --include-blocked)';
  }
  if (state === 'in_progress' && !named.has(id)) return 'in_progress (name it to resume)';
  if (state === 'unknown') return 'no line in STATUS.md';
  return null;
}
const plan = new Set();
const skipped = [];
for (const story of order) {
  if (!chosen.has(story.id)) continue;
  const reason = skipReason(story.id);
  if (reason) skipped.push(`SKIP ${story.id} ${reason}`);
  else if (matchesFilters(story)) plan.add(story.id);
}

// 3. next:N: the first N todo stories whose dependencies are done or planned earlier.
for (let added = 0, i = 0; added < next && i < order.length; i += 1) {
  const story = order[i];
  if (plan.has(story.id) || stateOf(story.id) !== 'todo' || !matchesFilters(story)) continue;
  if (depsOf(story).every((dep) => stateOf(dep) === 'done' || plan.has(dep))) {
    plan.add(story.id);
    added += 1;
  }
}

// 4. Every dependency must be done or planned; --with-deps adds todo ones.
const missing = [];
const queue = [...plan];
while (queue.length > 0) {
  const id = queue.shift();
  for (const dep of depsOf(byId.get(id))) {
    if (stateOf(dep) === 'done' || plan.has(dep)) continue;
    const addable =
      byId.has(dep) &&
      (stateOf(dep) === 'todo' || (stateOf(dep) === 'blocked' && opts.includeBlocked));
    if (opts.withDeps && addable) {
      plan.add(dep);
      queue.push(dep);
    } else {
      missing.push(`MISSING ${id} needs ${dep} (${stateOf(dep)})`);
    }
  }
}

// 5. Print the plan in the order of _meta/order.md.
const out = [];
for (const story of order) {
  if (!plan.has(story.id)) continue;
  const s = details(story);
  out.push(`PLAN ${s.id} ${s.fields.risk ?? '-'} ${s.path} ${s.title}`);
}
if (out.length === 0) out.push('PLAN none');
out.push(...skipped, ...problems, ...missing);
process.stdout.write(`${out.join('\n')}\n`);
process.exit(problems.length > 0 || missing.length > 0 ? 2 : 0);
