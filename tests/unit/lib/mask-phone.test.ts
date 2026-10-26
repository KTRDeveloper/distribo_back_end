import { describe, expect, it } from 'vitest';
import { maskPhone } from '../../../src/lib/mask-phone.js';

describe('maskPhone', () => {
  it('shows only the first six digits in groups of three, one and two', () => {
    expect(maskPhone('+237677123456')).toBe('+237 6 77…');
  });
});
