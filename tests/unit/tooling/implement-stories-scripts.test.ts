import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

// The /implement-stories scripts run as CLIs against a small fixture stories
// folder; set-status runs with --dry-run so the fixture never changes.
const SELECT = '.claude/skills/implement-stories/scripts/select.mjs';
const SET_STATUS = '.claude/skills/implement-stories/scripts/set-status.mjs';
const STORIES = 'tests/fixtures/implement-stories';

function run(script: string, args: string[]): { code: number | null; lines: string[] } {
  const result = spawnSync(process.execPath, [script, ...args, '--stories', STORIES], {
    encoding: 'utf8',
  });
  return { code: result.status, lines: result.stdout.trim().split('\n') };
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
