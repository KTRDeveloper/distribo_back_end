#!/usr/bin/env node
// Records the tests that already fail before a run, so each story-implementer
// knows which failures are not its own and never re-runs the full suite or
// stashes its work to prove it. Runs the full suite once (or reads a saved
// Vitest output with --from) and writes one `FAIL <file> > <test>` line per
// failing test, sorted and without duplicates; an empty file means green.
//
// Usage: node baseline.mjs <out-file> [--from <vitest output file>]
// Output: BASELINE <n> failing <out-file>
// Exit codes: 0 written; 1 usage error, or an output without the Vitest
// summary (the suite crashed before running): nothing is written.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

function usage(message) {
  process.stderr.write(`${message}\nusage: baseline.mjs <out-file> [--from <vitest output file>]\n`);
  process.exit(1);
}

const args = [];
let from = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--from') from = argv[(i += 1)];
  else args.push(argv[i]);
}
if (args.length !== 1) usage('one output file is needed');
if (from === undefined) usage('--from needs a file');

let output;
if (from) {
  output = readFileSync(from, 'utf8');
} else {
  const result = spawnSync('npx', ['vitest', 'run', '--reporter=dot'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

// eslint-disable-next-line no-control-regex
const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
if (!/^\s*Tests\s+.*\(\d+\)\s*$/m.test(plain)) {
  process.stderr.write(`${plain.split('\n').slice(-20).join('\n')}\nno Vitest summary: nothing written\n`);
  process.exit(1);
}

const failing = [
  ...new Set(
    plain
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^FAIL\s+\S/.test(line))
      .map((line) => line.replace(/^FAIL\s+/, 'FAIL '))
  ),
].sort();
writeFileSync(args[0], failing.map((line) => `${line}\n`).join(''));
process.stdout.write(`BASELINE ${failing.length} failing ${args[0]}\n`);
