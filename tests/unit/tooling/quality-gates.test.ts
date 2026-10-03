import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = process.cwd();
const allowedActions = new Set(['actions/checkout@v7', 'actions/setup-node@v7']);

describe('Quality Gates Tooling', () => {
  describe('baseline scripts (AC-1)', () => {
    it('npm run typecheck and npm run lint exit 0', () => {
      expect(() => {
        execSync('npm run typecheck', { cwd: rootDir, timeout: 300000, stdio: 'pipe' });
      }).not.toThrow();

      expect(() => {
        execSync('npm run lint', { cwd: rootDir, timeout: 300000, stdio: 'pipe' });
      }).not.toThrow();
    }, 300000);
  });

  describe('eval is rejected by security lint rules (AC-2)', () => {
    it('rejects unsafe-eval.ts with security/detect-eval-with-expression and allows safe.ts', () => {
      let unsafeFailed = false;
      let output = '';

      try {
        execSync('npx eslint --no-ignore tests/fixtures/lint/unsafe-eval.ts', {
          cwd: rootDir,
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 300000,
        });
      } catch (err: unknown) {
        unsafeFailed = true;
        const execErr = err as { stdout?: string; stderr?: string; status?: number };
        output = `${execErr.stdout || ''} ${execErr.stderr || ''}`;
        expect(execErr.status).toBe(1);
      }

      expect(unsafeFailed).toBe(true);
      expect(output).toContain('security/detect-eval-with-expression');

      expect(() => {
        execSync('npx eslint --no-ignore tests/fixtures/lint/safe.ts', {
          cwd: rootDir,
          stdio: 'pipe',
          timeout: 300000,
        });
      }).not.toThrow();
    }, 300000);
  });

  describe('pipeline gates (AC-3, AB-1)', () => {
    it('contains all required CI gates and images in ci.yml', () => {
      const ciPath = resolve(rootDir, '.github/workflows/ci.yml');
      expect(existsSync(ciPath)).toBe(true);

      const ciContent = readFileSync(ciPath, 'utf8');
      expect(ciContent).toContain('push');
      expect(ciContent).toContain('pull_request');
      expect(ciContent).toContain('postgres:16-alpine');
      expect(ciContent).toContain('npm ci');
      expect(ciContent).toContain('npm run typecheck');
      expect(ciContent).toContain('npm run lint');
      expect(ciContent).toContain('npm test');
      expect(ciContent).toContain('npm audit --audit-level=high');
      expect(ciContent).toContain('semgrep/semgrep:1.178.0');
      expect(ciContent).toContain('semgrep scan --config p/default --error --metrics=off');
      expect(ciContent).toContain('zricethezav/gitleaks:v8.30.1');
      expect(ciContent).toContain('gitleaks detect');
    });

    it('uses only the allowlisted GitHub actions at their required versions', () => {
      const ciContent = readFileSync(resolve(rootDir, '.github/workflows/ci.yml'), 'utf8');
      const actions = [...ciContent.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);

      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every((action) => allowedActions.has(action))).toBe(true);
      expect(actions).toContain('actions/checkout@v7');
      expect(actions).toContain('actions/setup-node@v7');
    });
  });

  describe('FND-011 configuration policy', () => {
    it('pins the Haiku alias exactly', () => {
      const settings = JSON.parse(
        readFileSync(resolve(rootDir, '.claude/settings.json'), 'utf8')
      ) as { env?: Record<string, string> };

      expect(settings.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('cx/gpt-5.6-sol-low');
    });
  });

  describe('conventions loaded (AC-4)', () => {
    it('contains the line @docs/stories/CONVENTIONS.md exactly once in CLAUDE.md', () => {
      const claudeMdPath = resolve(rootDir, 'CLAUDE.md');
      expect(existsSync(claudeMdPath)).toBe(true);

      const claudeMdContent = readFileSync(claudeMdPath, 'utf8');
      const matches = claudeMdContent.match(/@docs\/stories\/CONVENTIONS\.md/g);
      expect(matches).not.toBeNull();
      expect(matches?.length).toBe(1);
    });
  });
});
