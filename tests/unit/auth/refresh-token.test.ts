import { describe, it, expect } from 'vitest';
import { generateRefreshToken, hashRefreshToken } from '../../../src/lib/refresh-token.js';

describe('Refresh token helper', () => {
  it('generates a high-entropy, URL-safe token', () => {
    const token = generateRefreshToken();

    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(30);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates distinct tokens on each call', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateRefreshToken()));
    expect(tokens.size).toBe(50);
  });

  it('hashes a token deterministically', () => {
    const token = generateRefreshToken();

    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('produces different hashes for different tokens', () => {
    const a = hashRefreshToken(generateRefreshToken());
    const b = hashRefreshToken(generateRefreshToken());

    expect(a).not.toBe(b);
  });

  it('does not reveal the plaintext token in its hash', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);

    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex digest
  });
});
