/**
 * Unit tests for the fake photo processor and the fake storage (IMG-002, AC-5)
 */

import { describe, it, expect } from 'vitest';
import {
  FakeImageProcessor,
  FakeImageStorage,
  UnreadableImageError,
  getImageProcessor,
  getImageStorage,
} from '../../../src/modules/images/image.ports';

const MARKER = Buffer.from('GPS-LAT-4.05-LON-9.70-OWNER-JEAN');

function fakePng(width: number, height: number, extra: Buffer = MARKER): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, extra]);
}

describe('FakeImageProcessor', () => {
  const processor = new FakeImageProcessor();

  it('AC-5 inspects a PNG and re-encodes it to WebP bytes without the marker', async () => {
    const input = fakePng(40, 30);
    expect(await processor.inspect(input)).toEqual({ format: 'png', width: 40, height: 30 });

    const output = await processor.reencode(input, { vary: false });
    expect(output.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(output.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(output.includes(MARKER)).toBe(false);
    expect(output.includes(Buffer.from('JEAN'))).toBe(false);
    expect(await processor.inspect(output)).toEqual({ format: 'webp', width: 40, height: 30 });
  });

  it('detects jpeg and webp from the first bytes', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
    jpeg.writeUInt32BE(8, 16);
    jpeg.writeUInt32BE(6, 20);
    expect(await processor.inspect(jpeg)).toEqual({ format: 'jpeg', width: 8, height: 6 });

    const webp = await processor.reencode(fakePng(5, 4), { vary: false });
    expect((await processor.inspect(webp)).format).toBe('webp');
  });

  it('gives the same output for the same bytes, and a different one with vary', async () => {
    const input = fakePng(40, 30);
    const a = await processor.reencode(input, { vary: false });
    const b = await processor.reencode(input, { vary: false });
    const c = await processor.reencode(input, { vary: true });
    const d = await processor.reencode(input, { vary: true });
    expect(a.equals(b)).toBe(true);
    expect(c.equals(a)).toBe(false);
    expect(c.equals(d)).toBe(false);
    expect(c.length).toBe(a.length + 8);
  });

  it('gives different outputs for different bytes after offset 24', async () => {
    const a = await processor.reencode(fakePng(40, 30, Buffer.from('one')), { vary: false });
    const b = await processor.reencode(fakePng(40, 30, Buffer.from('two')), { vary: false });
    expect(a.equals(b)).toBe(false);
  });

  it('throws UnreadableImageError for unknown or too short bytes', async () => {
    await expect(
      processor.inspect(Buffer.from('not an image at all, but long enough'))
    ).rejects.toBeInstanceOf(UnreadableImageError);
    await expect(processor.inspect(Buffer.from([0x89, 0x50]))).rejects.toBeInstanceOf(
      UnreadableImageError
    );
    await expect(processor.reencode(Buffer.alloc(0), { vary: false })).rejects.toBeInstanceOf(
      UnreadableImageError
    );
  });
});

describe('FakeImageStorage', () => {
  it('puts, gets, deletes and lists in key order with the storage time', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const storage = new FakeImageStorage(() => now);
    await storage.put('products/b.webp', Buffer.from('b'));
    now = new Date('2026-01-02T00:00:00.000Z');
    await storage.put('products/a.webp', Buffer.from('a'));
    await storage.put('products/c.webp', Buffer.from('c'));

    expect((await storage.get('products/a.webp'))?.toString()).toBe('a');
    expect(await storage.get('products/zzz.webp')).toBeNull();

    const first = await storage.listFiles(null, 2);
    expect(first.map((f) => f.key)).toEqual(['products/a.webp', 'products/b.webp']);
    expect(first[1].storedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    const next = await storage.listFiles('products/b.webp', 10);
    expect(next.map((f) => f.key)).toEqual(['products/c.webp']);

    await storage.delete('products/a.webp');
    await storage.delete('products/a.webp');
    expect(await storage.get('products/a.webp')).toBeNull();
  });

  it('returns the one adapter set by IMAGE_DRIVER', () => {
    expect(getImageStorage()).toBe(getImageStorage());
    expect(getImageStorage()).toBeInstanceOf(FakeImageStorage);
    expect(getImageProcessor()).toBe(getImageProcessor());
    expect(getImageProcessor()).toBeInstanceOf(FakeImageProcessor);
  });
});
