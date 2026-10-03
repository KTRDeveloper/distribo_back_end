import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let cache: Promise<Set<string>> | undefined;

function load(): Promise<Set<string>> {
  cache ??= readFile(
    fileURLToPath(new URL('../../data/common-passwords.txt', import.meta.url)),
    'utf8'
  ).then(
    (t) =>
      new Set(
        t
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
      )
  );
  return cache;
}

/** True when the lower-cased password is on the common-password list. */
export async function isBlockedPassword(plain: string): Promise<boolean> {
  return (await load()).has(plain.toLowerCase());
}
