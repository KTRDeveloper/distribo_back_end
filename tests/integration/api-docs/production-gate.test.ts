import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';

/**
 * FR-008: /docs must not be reachable in production.
 *
 * `config.docsEnabled` is fixed at module-load time from NODE_ENV, so this
 * spawns a fresh process per NODE_ENV rather than mutating process.env
 * in-place (which would also corrupt shared singletons like the
 * prom-client registry on a second import).
 *
 * This inspects the Express router stack directly instead of issuing a
 * real HTTP request: a pre-existing, unrelated pino-http/Node version
 * mismatch in this boilerplate's request-logger middleware throws on
 * response-finish whenever `autoLogging` is on (i.e. outside NODE_ENV=test)
 * — issuing a live request here would trip that bug and mask the very
 * check this test performs.
 */
const scriptPath = resolve(__dirname, '__docs-mount-check.mjs');

const checkScript = `
import { app } from '../../../src/app.ts';
const rootStack = app.router ? app.router.stack : app._router.stack;

// Routes now live two levels deep: app -> v1Router (mounted at /api/v1,
// always present) -> apiDocsRoutes (mounted at /docs inside it, only when
// config.docsEnabled). A prefix match against '/api/v1' would also match
// '/api/v1/docs' regardless of whether the docs sub-router is mounted, so
// this drills into the v1 router's own stack and checks for '/docs' there.
const v1Layer = rootStack.find(
  (layer) => layer.name === 'router' && layer.matchers?.some((m) => m('/api/v1/docs'))
);
const v1Stack = v1Layer?.handle?.stack ?? [];
const mounted = v1Stack.some((layer) => layer.name === 'router' && layer.matchers?.some((m) => m('/docs')));
console.log(JSON.stringify({ mounted }));
process.exit(0);
`;

function isDocsMounted(nodeEnv: string): boolean {
  const output = execFileSync('npx', ['tsx', scriptPath], {
    cwd: resolve(__dirname, '../../..'),
    env: { ...process.env, NODE_ENV: nodeEnv },
    encoding: 'utf-8',
    shell: true,
  });

  const lastLine = output.trim().split('\n').pop()!;
  return (JSON.parse(lastLine) as { mounted: boolean }).mounted;
}

describe('Production environment gate (FR-008)', () => {
  afterAll(() => {
    try {
      unlinkSync(scriptPath);
    } catch {
      // already removed
    }
  });

  it('does not mount /docs when NODE_ENV=production', () => {
    writeFileSync(scriptPath, checkScript, 'utf-8');

    expect(isDocsMounted('production')).toBe(false);
  });

  it('mounts /docs when NODE_ENV=development', () => {
    writeFileSync(scriptPath, checkScript, 'utf-8');

    expect(isDocsMounted('development')).toBe(true);
  });
});
