#!/usr/bin/env node
// Files /implement-stories execution reports, one Markdown file per module in
// <stories>/execution-report/, so the orchestrator never loads those files into
// its context. A module file holds the orchestrator's run reports first, newest
// first, then one section per story in the order of _meta/order.md; filing a
// story again replaces its section.
//
// Usage:
//   node report.mjs story <ID> [--file <report.md>] [--tokens N] [--tool-uses N] [--duration-ms N] [--stories <folder>]
//   node report.mjs run <ID...> --selection "<arguments>" [--file <report.md>] [--stories <folder>]
// The report comes from --file, or else from stdin, and is kept verbatim but
// for the little verbatim() changes.
// story: the agent's report under the story's heading, with its status and
//   note from STATUS.md, its risk, the date and the usage.
// run: a run entry at the top of the file of each module where one of the IDs
//   ran (its status is no longer todo), or else of the first ID's module: the
//   selection, a table of that module's stories that ran (status, commit,
//   note), the others on a `Not run:` line, then the orchestrator's report.
// Output: WROTE <path> <ID or run>, one line per file written.
// Exit codes: 0 written; 1 usage error; 2 unknown ID or a report file it cannot
// parse (nothing is written then).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

const ID = /^[A-Z]+-\d+$/;
const RUNS = '<!-- runs: newest first -->';
const BEGIN = /^<!-- begin ([A-Z]+-\d+) -->$/;
const END = /^<!-- end ([A-Z]+-\d+) -->$/;
const MARKER = /^<!-- (?:begin|end|runs)\b/;
const USAGE =
  'usage: report.mjs story <ID> [--file <report>] [--tokens N] [--tool-uses N] [--duration-ms N] [--stories <folder>]\n' +
  '       report.mjs run <ID...> --selection "<arguments>" [--file <report>] [--stories <folder>]\n' +
  'The report comes from --file, or else from stdin.';

function usage(message) {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(1);
}

// Usage figures as given by the subagent result; thousands separators are dropped.
function count(option, value) {
  const digits = String(value ?? '').replace(/[,_\s]/g, '');
  if (!/^\d+$/.test(digits)) usage(`${option} needs a whole number`);
  return Number(digits);
}

function parseArgs(argv) {
  const opts = {
    words: [],
    stories: null,
    file: null,
    selection: null,
    tokens: null,
    toolUses: null,
    durationMs: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--stories') opts.stories = argv[(i += 1)];
    else if (arg === '--file') opts.file = argv[(i += 1)];
    else if (arg === '--selection') opts.selection = argv[(i += 1)];
    else if (arg === '--tokens') opts.tokens = count(arg, argv[(i += 1)]);
    else if (arg === '--tool-uses') opts.toolUses = count(arg, argv[(i += 1)]);
    else if (arg === '--duration-ms') opts.durationMs = count(arg, argv[(i += 1)]);
    else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
    else
      opts.words.push(
        ...arg
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      );
  }
  const [command, ...ids] = opts.words;
  if (opts.stories === undefined) usage('--stories needs a folder');
  if (opts.file === undefined) usage('--file needs a path');
  if (command !== 'story' && command !== 'run') usage('the first word must be story or run');
  if (ids.length === 0 || ids.some((id) => !ID.test(id))) usage('missing or malformed story ID');
  if (command === 'story' && ids.length !== 1) usage('story takes one ID');
  if (command === 'run' && !opts.selection) usage('run needs --selection "<arguments>"');
  return { ...opts, command, ids };
}

// The report text: the --file, or else stdin, which must then be piped.
function readReport(file) {
  if (file === null) {
    if (process.stdin.isTTY) usage('pass the report with --file <path> or on stdin');
    return readFileSync(0, 'utf8');
  }
  if (!existsSync(file)) usage(`report file not found: ${file}`);
  return readFileSync(file, 'utf8');
}

function storiesFolder(given) {
  if (given) return given;
  const found = ['docs/stories', 'stories'].find((dir) => existsSync(join(dir, 'STORY_MAP.md')));
  if (!found) usage('stories folder not found: pass --stories <folder>');
  return found;
}

const linesOf = (path) => readFileSync(path, 'utf8').split(/\r?\n/);
const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

// STATUS.md rows: `ID | status | reviewer | note` (outer pipes optional).
function readStatus(folder) {
  const rows = new Map();
  for (const line of linesOf(join(folder, 'STATUS.md'))) {
    const cells = cellsOf(line);
    if (ID.test(cells[0]) && cells.length >= 2) {
      rows.set(cells[0], { status: cells[1], note: cells[3] ?? '' });
    }
  }
  return rows;
}

// _meta/order.md items: `N. ID title (module)`.
function readOrder(folder) {
  const stories = [];
  for (const line of linesOf(join(folder, '_meta', 'order.md'))) {
    const match = /^\d+\.\s+([A-Z]+-\d+)\s+(.*)\s+\(([\w-]+)\)\s*$/.exec(line);
    if (match) {
      stories.push({
        id: match[1],
        title: match[2].trim(),
        module: match[3],
        rank: stories.length,
      });
    }
  }
  return stories;
}

function storyPath(folder, story) {
  const dir = join(folder, 'modules', story.module);
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find(
    (name) => name.startsWith(`${story.id}-`) && name.endsWith('.md')
  );
  return file ? join(dir, file) : null;
}

// The `risk:` line between the first two `---`.
function riskOf(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const block = /^---\n([\s\S]*?)\n---/.exec(text);
  const line = /^risk:\s*(\S+)/m.exec(block ? block[1] : '');
  return line ? line[1] : '-';
}

// The short hash of the latest commit `<ID>: ...`, or `-`: a folder outside a
// git repository, or a repository without commits, has no commit to show.
function commitOf(folder, id) {
  try {
    const hash = execFileSync('git', ['log', '-1', '--format=%h', `--grep=^${id}: `], {
      cwd: folder,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return hash || '-';
  } catch {
    return '-';
  }
}

const now = () => `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const cell = (value) =>
  String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
const trimBlank = (lines) => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end);
};

function duration(ms) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

// Text written by an agent, kept verbatim except for three things: the indent
// all its lines share goes, since a background agent's hand-back arrives with
// every line indented; a line that looks like one of this file's markers gets
// a leading space, in code fences too, so a report can never break the file's
// layout; and its headings move three levels down (at most ######) so they
// nest under the section that holds them, code fences aside.
function verbatim(text) {
  const lines = trimBlank(text.replace(/\r\n/g, '\n').split('\n')).map((line) => line.trimEnd());
  const indent = lines.reduce(
    (min, line) => (line ? Math.min(min, line.search(/[^ ]/)) : min),
    Infinity
  );
  let fenced = false;
  return lines.map((whole) => {
    const line = whole.slice(indent);
    if (MARKER.test(line)) return ` ${line}`;
    const fence = /^ {0,3}(?:```|~~~)/.test(line);
    if (fence) fenced = !fenced;
    if (fenced || fence) return line;
    const heading = /^(#{1,6})(\s.*|)$/.exec(line);
    return heading ? `${'#'.repeat(Math.min(heading[1].length + 3, 6))}${heading[2]}` : line;
  });
}

// A module file: the head (title, introduction, run entries), then the story
// sections, each between its begin and end markers. Anything else means the
// file was changed by hand: stop rather than guess.
function parse(path, text) {
  const head = [];
  const sections = [];
  let current = null;
  const fail = (lineNumber, reason) => {
    process.stdout.write(`UNPARSABLE ${path}:${lineNumber} ${reason}\n`);
    process.exit(2);
  };
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .forEach((line, index) => {
      const begin = BEGIN.exec(line);
      const end = END.exec(line);
      if (current) {
        if (begin) fail(index + 1, `begin ${begin[1]} inside ${current.id}`);
        current.lines.push(line);
        if (end) {
          if (end[1] !== current.id) fail(index + 1, `end ${end[1]} closes ${current.id}`);
          sections.push(current);
          current = null;
        }
      } else if (begin) {
        if (sections.some((section) => section.id === begin[1]))
          fail(index + 1, `${begin[1]} twice`);
        current = { id: begin[1], lines: [line] };
      } else if (end) {
        fail(index + 1, `end ${end[1]} without its begin`);
      } else if (sections.length === 0) {
        head.push(line);
      } else if (line.trim() !== '') {
        fail(index + 1, 'text between two story sections');
      }
    });
  if (current) fail('end', `no end for ${current.id}`);
  if (!head.includes(RUNS)) fail(1, `no "${RUNS}" line`);
  return { head, sections };
}

function newFile(module) {
  return [
    `# Execution report: ${module}`,
    '',
    'Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.',
    '',
    '## Orchestrator runs',
    '',
    RUNS,
  ].join('\n');
}

function render({ head, sections }) {
  const body = sections.map((section) => section.lines.join('\n'));
  return `${[trimBlank(head).join('\n'), ...body].join('\n\n')}\n`;
}

function storySection(folder, file, story, statusRow, opts, text) {
  const path = storyPath(folder, story);
  const link = path ? relative(dirname(file), path).split(sep).join('/') : null;
  const note = statusRow?.note ? `: ${statusRow.note}` : '';
  const usageParts = [
    opts.tokens === null ? null : `${opts.tokens.toLocaleString('en-US')} tokens`,
    opts.toolUses === null ? null : `${opts.toolUses} tool uses`,
    opts.durationMs === null ? null : duration(opts.durationMs),
  ].filter(Boolean);
  const report = verbatim(text);
  return [
    `<!-- begin ${story.id} -->`,
    `## ${story.id} — ${story.title}`,
    '',
    `- Filed: ${now()}`,
    `- Status: **${statusRow?.status ?? 'unknown'}**${note}`,
    `- Risk: ${path ? riskOf(path) : '-'} · story: ${link ? `[${basename(path)}](${link})` : 'no story file'}`,
    ...(usageParts.length > 0 ? [`- Agent: ${usageParts.join(', ')}`] : []),
    '',
    '### Agent report',
    '',
    ...(report.length > 0 ? report : ['_The agent returned no report._']),
    `<!-- end ${story.id} -->`,
  ];
}

// A story of the plan ran in the run when its status is no longer todo.
const ranIn = (status, story) => status.get(story.id)?.status !== 'todo';

// IDs in plan order, each run of consecutive numbers of one prefix shown as
// `FIRST..LAST`: `FX-002..FX-004, GX-001`.
function ranges(ids) {
  const groups = [];
  for (const id of ids) {
    const [prefix, digits] = id.split('-');
    const last = groups.at(-1);
    if (last && last.prefix === prefix && last.number + 1 === Number(digits)) {
      last.to = id;
      last.number += 1;
    } else {
      groups.push({ prefix, number: Number(digits), from: id, to: id });
    }
  }
  return groups.map((group) =>
    group.from === group.to ? group.from : `${group.from}..${group.to}`
  );
}

function runEntry(folder, stories, others, status, opts, text) {
  const report = verbatim(text);
  const ran = stories.filter((story) => ranIn(status, story));
  const notRun = stories.filter((story) => !ranIn(status, story)).map((story) => story.id);
  const lines = [
    ...(notRun.length > 0 ? [`Not run: ${ranges(notRun).join(', ')}.`] : []),
    ...(others.length > 0 ? [`Also in this run: ${others.join(', ')}.`] : []),
  ];
  return [
    `### Run ${now()}: \`/implement-stories ${opts.selection}\``,
    '',
    ...(ran.length > 0
      ? [
          '| story | status | commit | note |',
          '|---|---|---|---|',
          ...ran.map((story) => {
            const row = status.get(story.id);
            return `| ${cell(`${story.id} ${story.title}`)} | ${cell(row?.status ?? 'unknown')} | ${commitOf(folder, story.id)} | ${cell(row?.note)} |`;
          }),
          '',
        ]
      : []),
    ...(lines.length > 0 ? [...lines, ''] : []),
    ...(report.length > 0 ? report : ['_The orchestrator gave no report._']),
  ];
}

const opts = parseArgs(process.argv.slice(2));
const text = readReport(opts.file);
const folder = storiesFolder(opts.stories);
const order = readOrder(folder);
const byId = new Map(order.map((story) => [story.id, story]));
const unknown = opts.ids.filter((id) => !byId.has(id));
if (unknown.length > 0) {
  process.stdout.write(`${unknown.map((id) => `UNKNOWN ${id}`).join('\n')}\n`);
  process.exit(2);
}
const status = readStatus(folder);
const stories = opts.ids.map((id) => byId.get(id));
const modules = [...new Set(stories.map((story) => story.module))];
const reports = join(folder, 'execution-report');
// A run is filed only where one of its stories ran, so the files of modules it
// never reached stay as they were; if none ran, in the first story's module.
const ranModules = modules.filter((module) =>
  stories.some((story) => story.module === module && ranIn(status, story))
);
const targets =
  opts.command === 'story' || ranModules.length === 0 ? modules.slice(0, 1) : ranModules;

// Parse every file first, so a file that cannot be parsed stops the whole
// command before anything is written.
const files = targets.map((module) => {
  const path = join(reports, `${module}.md`);
  return {
    module,
    path,
    ...parse(path, existsSync(path) ? readFileSync(path, 'utf8') : newFile(module)),
  };
});

for (const file of files) {
  if (opts.command === 'story') {
    const [story] = stories;
    const section = {
      id: story.id,
      lines: storySection(folder, file.path, story, status.get(story.id), opts, text),
    };
    const rank = (id) => byId.get(id)?.rank ?? Number.MAX_SAFE_INTEGER;
    file.sections = [...file.sections.filter((s) => s.id !== story.id), section].sort(
      (a, b) => rank(a.id) - rank(b.id)
    );
  } else {
    const own = stories.filter((story) => story.module === file.module);
    const others = modules.filter((module) => module !== file.module);
    const at = file.head.indexOf(RUNS);
    const older = trimBlank(file.head.slice(at + 1));
    const entry = runEntry(folder, own, others, status, opts, text);
    file.head = [
      ...file.head.slice(0, at + 1),
      '',
      ...entry,
      ...(older.length > 0 ? ['', ...older] : []),
    ];
  }
  mkdirSync(reports, { recursive: true });
  writeFileSync(file.path, render(file));
  process.stdout.write(`WROTE ${file.path} ${opts.command === 'story' ? opts.ids[0] : 'run'}\n`);
}
