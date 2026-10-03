import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = process.cwd();

describe('No bcrypt', () => {
  it('package.json and sources do not mention bcrypt (AC-1)', () => {
    expect(readFileSync(resolve(rootDir, 'package.json'), 'utf8')).not.toMatch(/bcrypt/);
    const found = execSync(
      "grep -rIl bcrypt src tests scripts --exclude=no-bcrypt.test.ts || true",
      { cwd: rootDir, encoding: 'utf8' },
    );
    expect(found.trim()).toBe('');
  });

  it('typecheck exits 0 (AC-2)', () => {
    expect(() =>
      execSync('npm run typecheck', { cwd: rootDir, timeout: 300000, stdio: 'pipe' }),
    ).not.toThrow();
  }, 300000);
});
