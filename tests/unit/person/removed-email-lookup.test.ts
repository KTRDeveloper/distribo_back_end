import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const NAME = 'findByVerifiedEmail';
const SRC = join(__dirname, '../../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('verified-email lookup removed (AUTH-035)', () => {
  it('AC-1: the person repository has no findByVerifiedEmail export', async () => {
    const repository = await import('../../../src/modules/person/person.repository.js');
    expect(Object.keys(repository)).not.toContain(NAME);
  });

  it('AC-2: no file under src/ mentions the name', () => {
    const mentions = sourceFiles(SRC).filter((file) => readFileSync(file, 'utf8').includes(NAME));
    expect(mentions).toEqual([]);
  });
});
