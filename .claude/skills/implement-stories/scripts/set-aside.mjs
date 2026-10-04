#!/usr/bin/env node
// Sets aside a story that did not end done, so /implement-stories can go on
// with the next one. The test database is dropped and created again, empty,
// since it may hold the story's migrations (the next test run applies the
// migrations of the working tree); then the story's partial changes go to a
// git stash named after it. STATUS.md and the execution reports stay in the
// working tree, for the run to commit.
//
// Usage: node set-aside.mjs <ID> [--database-url <url>] [--stories <folder>]
//   --database-url: the test database, by default the one tests/setup.ts uses;
//   only a database on this machine whose name contains "test" is accepted.
// Output: RESET <database>, then STASHED <ID> <status>: partial changes, or
// NO CHANGES <ID> when the working tree holds nothing else to set aside.
// Exit codes: 0 set aside; 1 usage error; 2 refused (an unknown or done story,
// a database that is not a local test one: nothing is changed) or failed (a
// failed reset changes nothing; a failed stash leaves the database reset).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const ID = /^[A-Z]+-\d+$/;
const TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5434/test_db';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
// From the stories folder: the whole repository but STATUS.md and the reports.
const PATHSPECS = [':/', ':(exclude)STATUS.md', ':(exclude)execution-report'];

function usage(message) {
  process.stderr.write(
    `${message}\nusage: set-aside.mjs <ID> [--database-url <url>] [--stories <folder>]\n`
  );
  process.exit(1);
}

function stop(line) {
  process.stdout.write(`${line}\n`);
  process.exit(2);
}

const firstLine = (text) => String(text).trim().split('\n')[0];

const args = [];
let stories = null;
let databaseUrl = TEST_DATABASE_URL;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--stories') stories = argv[(i += 1)];
  else if (argv[i] === '--database-url') databaseUrl = argv[(i += 1)];
  else if (argv[i].startsWith('--')) usage(`unknown option ${argv[i]}`);
  else args.push(argv[i]);
}
if (args.length !== 1 || !ID.test(args[0])) usage('give one story ID');
if (stories === undefined) usage('--stories needs a folder');
if (databaseUrl === undefined) usage('--database-url needs a URL');
const [id] = args;

// The reset deletes every row, so only a local database named as a test one
// qualifies. Lines show its host and name, never the password.
function testDatabase(url) {
  let parsed;
  let name;
  try {
    parsed = new URL(url);
    name = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    stop('REFUSED database: not a URL');
  }
  const where = `database ${parsed.hostname}/${name}`;
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
    stop(`REFUSED ${where}: not PostgreSQL`);
  if (!LOCAL_HOSTS.includes(parsed.hostname)) stop(`REFUSED ${where}: not on this machine`);
  if (!/test/i.test(name)) stop(`REFUSED ${where}: its name does not contain "test"`);
  // The server's maintenance database, to drop and create the test one from.
  parsed.pathname = '/postgres';
  parsed.search = '';
  return { name, server: parsed.toString() };
}

// The story's status in STATUS.md rows `ID | status | reviewer | note`.
function statusOf(folder) {
  for (const line of readFileSync(join(folder, 'STATUS.md'), 'utf8').split(/\r?\n/)) {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    if (cells[0].trim() === id) return (cells[1] ?? '').trim();
  }
  return '';
}

const database = testDatabase(databaseUrl);
const folder =
  stories ?? ['docs/stories', 'stories'].find((dir) => existsSync(join(dir, 'STORY_MAP.md')));
if (!folder) usage('stories folder not found: pass --stories <folder>');
const status = statusOf(folder);
if (!status) stop(`REFUSED ${id}: no status in STATUS.md`);
if (status === 'done') stop(`REFUSED ${id}: done, nothing to set aside`);

const client = new pg.Client({ connectionString: database.server, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  const name = client.escapeIdentifier(database.name);
  await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${name}`);
} catch (error) {
  stop(`FAILED reset ${database.name}: ${firstLine(error.message)}`);
}
await client.end();
process.stdout.write(`RESET ${database.name}\n`);

const message = `${id} ${status}: partial changes`;
const git = (gitArgs) =>
  execFileSync('git', gitArgs, {
    cwd: folder,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
try {
  if (git(['status', '--porcelain', '--untracked-files=all', '--', ...PATHSPECS]).trim() === '') {
    process.stdout.write(`NO CHANGES ${id}\n`);
  } else {
    git(['stash', 'push', '--include-untracked', '--message', message, '--', ...PATHSPECS]);
    process.stdout.write(`STASHED ${message}\n`);
  }
} catch (error) {
  stop(`FAILED stash: ${firstLine(error.stderr || error.message)}`);
}
