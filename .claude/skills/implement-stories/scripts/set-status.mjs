#!/usr/bin/env node
// Sets one story's status and note in STATUS.md, so agents never load the
// whole file into their context. Only that story's row changes; the reviewer
// column is kept and the note replaces the previous one (empty when omitted).
//
// Usage: node set-status.mjs <ID> <status> [note] [--stories <folder>] [--dry-run]
//   status: todo | in_progress | blocked | done | obsolete
// Exit codes: 0 row updated (or shown with --dry-run); 1 usage error;
// 2 no row, or several rows, for that ID.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'obsolete'];

function usage(message) {
  process.stderr.write(
    `${message}\nusage: set-status.mjs <ID> <status> [note] [--stories <folder>] [--dry-run]\n`
  );
  process.exit(1);
}

const args = [];
let stories = null;
let dryRun = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--dry-run') dryRun = true;
  else if (argv[i] === '--stories') stories = argv[(i += 1)];
  else args.push(argv[i]);
}
const [id, status, ...noteParts] = args;
if (!id || !/^[A-Z]+-\d+$/.test(id)) usage('missing or malformed story ID');
if (!STATUSES.includes(status)) usage(`status must be one of: ${STATUSES.join(', ')}`);
if (stories === undefined) usage('--stories needs a folder');
// One line, and no pipe that would break the table.
const note = noteParts.join(' ').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

const folder =
  stories ?? ['docs/stories', 'stories'].find((dir) => existsSync(join(dir, 'STATUS.md')));
if (!folder) usage('stories folder not found: pass --stories <folder>');
const path = join(folder, 'STATUS.md');
const text = readFileSync(path, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const cell = (value) => (value ? ` ${value} ` : ' ');

let hits = 0;
let after = '';
const updated = text.split(/\r?\n/).map((line) => {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  if (cells[0] !== id) return line;
  hits += 1;
  after = `|${cell(id)}|${cell(status)}|${cell(cells[2] ?? '')}|${cell(note)}|`;
  return after;
});
if (hits !== 1) {
  process.stdout.write(`${hits === 0 ? 'UNKNOWN' : 'DUPLICATE'} ${id}: ${hits} lines in ${path}\n`);
  process.exit(2);
}
if (!dryRun) writeFileSync(path, updated.join(eol));
process.stdout.write(`${dryRun ? 'WOULD SET' : 'SET'} ${after}\n`);
