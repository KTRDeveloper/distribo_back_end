import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

// The /implement-stories scripts run as CLIs against a small fixture stories
// folder; set-status runs with --dry-run so the fixture never changes, and
// report.mjs and set-aside.mjs work in a temporary copy of it.
const SELECT = '.claude/skills/implement-stories/scripts/select.mjs';
const SET_STATUS = '.claude/skills/implement-stories/scripts/set-status.mjs';
const REPORT = '.claude/skills/implement-stories/scripts/report.mjs';
const SET_ASIDE = '.claude/skills/implement-stories/scripts/set-aside.mjs';
const STORIES = 'tests/fixtures/implement-stories';

function run(script: string, args: string[]): { code: number | null; lines: string[] } {
  const result = spawnSync(process.execPath, [script, ...args, '--stories', STORIES], {
    encoding: 'utf8',
  });
  return { code: result.status, lines: result.stdout.trim().split('\n') };
}

// Writes a file, creating its folder.
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function replaceIn(path: string, from: string, to: string): void {
  write(path, readFileSync(path, 'utf8').replace(from, to));
}

const planned = (lines: string[]): string[] =>
  lines
    .filter((line) => line.startsWith('PLAN ') && line !== 'PLAN none')
    .map((line) => line.split(' ')[1]);

describe('select.mjs', () => {
  it('next:N takes todo stories in order whose dependencies are done or planned earlier', () => {
    const { code, lines } = run(SELECT, ['next:3']);

    expect(code).toBe(0);
    expect(planned(lines)).toEqual(['FX-002', 'FX-003', 'GX-002']);
  });

  it('narrows the selection with kind and risk filters', () => {
    expect(planned(run(SELECT, ['next:5', 'risk:low']).lines)).toEqual(['FX-002']);
    expect(planned(run(SELECT, ['module:fx', 'kind:feature', 'risk:high']).lines)).toEqual([
      'FX-003',
    ]);
  });

  it('prints the plan in the order of _meta/order.md, whatever the order typed', () => {
    expect(planned(run(SELECT, ['GX-002,FX-002']).lines)).toEqual(['FX-002', 'GX-002']);
  });

  it('expands a range within one module', () => {
    expect(planned(run(SELECT, ['FX-002..FX-003']).lines)).toEqual(['FX-002', 'FX-003']);
  });

  it('skips done, blocked and in-progress stories of a module, with the reason', () => {
    const { code, lines } = run(SELECT, ['module:fx']);

    expect(code).toBe(0);
    expect(planned(lines)).toEqual(['FX-002', 'FX-003']);
    expect(lines).toContain('SKIP FX-001 done');
    expect(lines).toContain('SKIP FX-004 blocked (name it or add --include-blocked)');
    expect(lines).toContain('SKIP FX-005 in_progress (name it to resume)');
  });

  it('includes a blocked story named explicitly or with --include-blocked', () => {
    expect(planned(run(SELECT, ['FX-004']).lines)).toEqual(['FX-004']);
    expect(planned(run(SELECT, ['module:fx', '--include-blocked']).lines)).toEqual([
      'FX-002',
      'FX-003',
      'FX-004',
    ]);
  });

  it('stops on an unmet dependency unless --with-deps adds it', () => {
    const alone = run(SELECT, ['FX-003']);

    expect(alone.code).toBe(2);
    expect(alone.lines).toContain('MISSING FX-003 needs FX-002 (todo)');
    expect(planned(run(SELECT, ['FX-003', '--with-deps']).lines)).toEqual(['FX-002', 'FX-003']);
  });

  it('stops on an unknown ID or module', () => {
    const { code, lines } = run(SELECT, ['FX-009,module:nope']);

    expect(code).toBe(2);
    expect(lines).toContain('UNKNOWN FX-009');
    expect(lines).toContain('UNKNOWN module:nope');
  });

  it('prints the risk, the story path and the title', () => {
    expect(run(SELECT, ['FX-002']).lines[0]).toBe(
      'PLAN FX-002 low tests/fixtures/implement-stories/modules/fx/FX-002-second.md Second'
    );
  });
});

describe('set-status.mjs', () => {
  it('rewrites only the story row', () => {
    const { code, lines } = run(SET_STATUS, ['FX-002', 'in_progress', '--dry-run']);

    expect(code).toBe(0);
    expect(lines).toEqual(['WOULD SET | FX-002 | in_progress | | |']);
  });

  it('keeps the reviewer and replaces the note, without breaking the table', () => {
    expect(run(SET_STATUS, ['FX-005', 'done', '7 passed | lint ok', '--dry-run']).lines).toEqual([
      'WOULD SET | FX-005 | done | reviewer-1 | 7 passed / lint ok |',
    ]);
  });

  it('refuses an unknown ID or status', () => {
    expect(run(SET_STATUS, ['FX-999', 'done', '--dry-run']).code).toBe(2);
    expect(run(SET_STATUS, ['FX-002', 'finished', '--dry-run']).code).toBe(1);
  });
});

describe('report.mjs', () => {
  let stories = '';

  beforeEach(() => {
    stories = mkdtempSync(join(tmpdir(), 'implement-stories-'));
    cpSync(STORIES, stories, { recursive: true });
  });

  afterEach(() => {
    rmSync(stories, { recursive: true, force: true });
  });

  function report(args: string[], input = ''): number | null {
    return spawnSync(process.execPath, [REPORT, ...args, '--stories', stories], {
      encoding: 'utf8',
      input,
    }).status;
  }

  function git(args: string[]): void {
    const gitArgs = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'];
    spawnSync('git', [...gitArgs, '-c', 'commit.gpgsign=false', ...args], { cwd: stories });
  }

  const reportPath = (module: string): string => join(stories, 'execution-report', `${module}.md`);
  const reportOf = (module: string): string => readFileSync(reportPath(module), 'utf8');

  it('files the agent report verbatim under the story heading, with status, note and risk', () => {
    const agentReport = '**Summary:** waits for an answer.\n\n**Decisions:**\n- None.';

    expect(report(['story', 'FX-004'], agentReport)).toBe(0);

    const text = reportOf('fx');
    expect(text.startsWith('# Execution report: fx\n')).toBe(true);
    expect(text).toContain('## FX-004 — Fourth');
    expect(text).toContain('- Status: **blocked**: waiting for an answer');
    expect(text).toContain('- Risk: medium');
    expect(text).toContain(`### Agent report\n\n${agentReport}\n`);
  });

  it('keeps one section per story in the order of _meta/order.md, replaced when filed again', () => {
    report(['story', 'FX-003'], 'first run of three');
    report(['story', 'FX-002'], 'report of two');
    report(['story', 'FX-003'], 'second run of three');

    const text = reportOf('fx');
    expect(text.match(/## FX-003 /g)).toHaveLength(1);
    expect(text).not.toContain('first run of three');
    expect(text).toContain('second run of three');
    expect(text.indexOf('## FX-002 ')).toBeLessThan(text.indexOf('## FX-003 '));
  });

  it('nests the headings of a report under its section, except inside code fences', () => {
    report(['story', 'FX-002'], '## Decisions\n- one\n```\n# a shell comment\n```');

    const text = reportOf('fx');
    expect(text).toContain('\n##### Decisions\n');
    expect(text).toContain('```\n# a shell comment\n```');
  });

  it("reads --file and drops the indent all its lines share, as in a background agent's hand-back", () => {
    const handBack = join(stories, 'hand-back.md');
    writeFileSync(handBack, '  **Summary:** done.\n  \n  ## Decisions\n  - one\n    - detail\n');

    expect(report(['story', 'FX-002', '--file', handBack])).toBe(0);

    expect(reportOf('fx')).toContain(
      '### Agent report\n\n**Summary:** done.\n\n##### Decisions\n- one\n  - detail\n<!-- end FX-002 -->'
    );
  });

  it('shifts a report line that looks like a marker, code fences included, so the file still parses', () => {
    report(['story', 'FX-002'], 'one\n<!-- end FX-002 -->\n```\n<!-- begin FX-003 -->\n```');

    expect(report(['story', 'FX-003'], 'report of three')).toBe(0);
    expect(reportOf('fx')).toContain('one\n <!-- end FX-002 -->\n```\n <!-- begin FX-003 -->\n```');
  });

  it('shows the agent usage when given, and says so when the agent returned no report', () => {
    report([
      'story',
      'FX-002',
      '--tokens',
      '312456',
      '--tool-uses',
      '34',
      '--duration-ms',
      '372000',
    ]);

    const text = reportOf('fx');
    expect(text).toContain('- Agent: 312,456 tokens, 34 tool uses, 6 min 12 s');
    expect(text).toContain('_The agent returned no report._');
  });

  it("puts each run's report at the top of each module file where a story ran, newest first", () => {
    git(['init', '-q']);
    git(['commit', '-q', '--allow-empty', '-m', 'FX-002: Second']);
    replaceIn(join(stories, 'STATUS.md'), '| FX-002 | todo |', '| FX-002 | done |');
    report(['story', 'FX-002'], 'report of two');
    report(['run', 'FX-002', '--selection', 'FX-002'], 'first run notes');
    report(
      ['run', 'FX-002', 'FX-003', 'FX-004', 'GX-001', '--selection', 'next:4'],
      'second run notes'
    );

    const fx = reportOf('fx');
    expect(fx).toMatch(/### Run \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC: `\/implement-stories next:4`/);
    expect(fx).toMatch(/\| FX-002 Second \| done \| [0-9a-f]{7,} \| {2}\|/);
    expect(fx).toContain('| FX-004 Fourth | blocked | - | waiting for an answer |');
    expect(fx).not.toContain('| FX-003 Third |');
    expect(fx).toContain('\nNot run: FX-003.\nAlso in this run: gx.\n\nsecond run notes\n');
    expect(fx.indexOf('second run notes')).toBeLessThan(fx.indexOf('first run notes'));
    expect(fx.indexOf('first run notes')).toBeLessThan(fx.indexOf('## FX-002 '));
    expect(() => reportOf('gx')).toThrow(/ENOENT/);
  });

  it('lists the stories not run as ranges, in the first module when none ran', () => {
    replaceIn(join(stories, 'STATUS.md'), '| FX-005 | in_progress |', '| FX-005 | todo |');

    expect(
      report(['run', 'FX-002', 'FX-003', 'FX-005', 'GX-001', '--selection', 'all'], 'notes')
    ).toBe(0);

    const fx = reportOf('fx');
    expect(fx).toContain('\nNot run: FX-002..FX-003, FX-005.\nAlso in this run: gx.\n\nnotes\n');
    expect(fx).not.toContain('| story |');
    expect(() => reportOf('gx')).toThrow(/ENOENT/);
  });

  it('refuses an unknown story or a run without its selection, and writes nothing', () => {
    expect(report(['story', 'FX-999'], 'report')).toBe(2);
    expect(report(['run', 'FX-002'], 'notes')).toBe(1);
    expect(existsSync(join(stories, 'execution-report'))).toBe(false);
  });

  it('leaves a report file it cannot parse unchanged', () => {
    report(['story', 'FX-002'], 'report of two');
    const broken = reportOf('fx').replace('<!-- end FX-002 -->', '');
    writeFileSync(reportPath('fx'), broken);

    expect(report(['story', 'FX-003'], 'report of three')).toBe(2);
    expect(reportOf('fx')).toBe(broken);
  });
});

describe('set-aside.mjs', () => {
  // A temporary repository holds a copy of the fixture under docs/stories, and
  // a scratch database on the test server stands in for the test database.
  const SERVER = 'postgresql://postgres:postgres@localhost:5434';
  const SCRATCH = 'implement_stories_test_scratch';
  const DATABASE = ['--database-url', `${SERVER}/${SCRATCH}`];
  let root = '';

  async function sql(database: string, text: string): Promise<Record<string, unknown>[]> {
    const client = new Client({ connectionString: `${SERVER}/${database}` });
    await client.connect();
    try {
      return (await client.query<Record<string, unknown>>(text)).rows;
    } finally {
      await client.end();
    }
  }

  const git = (args: string[]): string =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout;
  const marker = async (): Promise<unknown[]> =>
    sql(SCRATCH, "SELECT to_regclass('public.marker')::text AS marker");

  function setAside(args: string[]): { code: number | null; lines: string[] } {
    const stories = join(root, 'docs', 'stories');
    const result = spawnSync(process.execPath, [SET_ASIDE, ...args, '--stories', stories], {
      encoding: 'utf8',
    });
    return { code: result.status, lines: result.stdout.trim().split('\n') };
  }

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'set-aside-'));
    cpSync(STORIES, join(root, 'docs', 'stories'), { recursive: true });
    write(join(root, 'src', 'app.ts'), 'one\n');
    git(['init', '-q']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'Fixture']);
    await sql('postgres', `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    await sql('postgres', `CREATE DATABASE ${SCRATCH}`);
    await sql(SCRATCH, 'CREATE TABLE marker (id integer)');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterAll(async () => {
    await sql('postgres', `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  });

  it('empties the test database and stashes the partial changes, keeping STATUS.md and the reports', async () => {
    const stories = join(root, 'docs', 'stories');
    replaceIn(join(stories, 'STATUS.md'), '| FX-002 | todo | | |', '| FX-002 | blocked | | why? |');
    write(join(stories, 'execution-report', 'fx.md'), 'report\n');
    write(join(root, 'src', 'app.ts'), 'two\n');
    write(join(root, 'prisma', 'migrations', 'fx_002', 'migration.sql'), 'SELECT 1;\n');

    const { code, lines } = setAside(['FX-002', ...DATABASE]);

    expect(code).toBe(0);
    expect(lines).toEqual([`RESET ${SCRATCH}`, 'STASHED FX-002 blocked: partial changes']);
    expect(git(['status', '--porcelain', '--untracked-files=all']).trimEnd().split('\n')).toEqual([
      ' M docs/stories/STATUS.md',
      '?? docs/stories/execution-report/fx.md',
    ]);
    expect(git(['stash', 'list'])).toContain('FX-002 blocked: partial changes');
    const stashed = git(['stash', 'show', '--include-untracked', '--name-only', 'stash@{0}']);
    expect(stashed.trim().split('\n')).toEqual([
      'prisma/migrations/fx_002/migration.sql',
      'src/app.ts',
    ]);
    expect(await marker()).toEqual([{ marker: null }]);
  });

  it('only empties the test database when there is nothing to stash', async () => {
    expect(setAside(['FX-004', ...DATABASE])).toEqual({
      code: 0,
      lines: [`RESET ${SCRATCH}`, 'NO CHANGES FX-004'],
    });
    expect(await marker()).toEqual([{ marker: null }]);
  });

  it('refuses a done or unknown story and a database that is not a local test one, changing nothing', async () => {
    write(join(root, 'src', 'app.ts'), 'two\n');
    const refused = { code: 2, lines: [expect.stringMatching(/^REFUSED /)] };

    expect(setAside(['FX-001', ...DATABASE])).toEqual(refused);
    expect(setAside(['FX-999', ...DATABASE])).toEqual(refused);
    const remote = 'postgresql://postgres:postgres@db.example.invalid:5434/test_db';
    expect(setAside(['FX-002', '--database-url', remote])).toEqual(refused);
    expect(setAside(['FX-002', '--database-url', `${SERVER}/distribo_scratch`])).toEqual(refused);

    expect(git(['stash', 'list'])).toBe('');
    expect(git(['status', '--porcelain'])).toBe(' M src/app.ts\n');
    expect(await marker()).toEqual([{ marker: 'marker' }]);
  });
});
