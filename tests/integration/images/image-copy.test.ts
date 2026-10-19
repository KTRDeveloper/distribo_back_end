import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { newImageKey } from '../../../src/lib/image-keys';
import { getImageProcessor, getImageStorage } from '../../../src/modules/images/image.ports';
import { copyImage } from '../../../src/modules/images/image-copy.service';
import { deleteImageFiles } from '../../../src/modules/images/image.service';

const storage = getImageStorage();

/** A readable fake photo (PNG header, 40x30 pixels) stored under a fresh products key. */
async function storeOriginal(): Promise<string> {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(header, 0);
  header.writeUInt32BE(40, 16);
  header.writeUInt32BE(30, 20);
  const bytes = await getImageProcessor().reencode(Buffer.concat([header, Buffer.from('pixels')]), {
    vary: false,
  });
  const key = newImageKey('products');
  await storage.put(key, bytes);
  return key;
}

const copy = (key: string) => prisma.$transaction((tx) => copyImage(tx, key));
const rows = () => prisma.imageCopy.findMany({ orderBy: { copiedAt: 'asc' } });

afterEach(async () => {
  for (const file of await storage.listFiles(null, 1000)) await storage.delete(file.key);
});

describe('copyImage', () => {
  it('first copy: new products key, different bytes, row (new, A, A)', async () => {
    const a = await storeOriginal();
    const created = await copy(a);

    expect(created).toMatch(/^products\/[0-9a-f-]{36}\.webp$/);
    expect(created).not.toBe(a);
    const original = await storage.get(a);
    const copied = await storage.get(created as string);
    expect(copied).not.toBeNull();
    expect(copied?.equals(original as Buffer)).toBe(false);
    expect(await rows()).toMatchObject([{ copyKey: created, sourceKey: a, rootKey: a }]);
  });

  it('copy of copy: row (C, B, A) and one query on root A returns B and C', async () => {
    const a = await storeOriginal();
    const b = (await copy(a)) as string;
    const c = (await copy(b)) as string;

    const c_row = await prisma.imageCopy.findUnique({ where: { copyKey: c } });
    expect(c_row).toMatchObject({ copyKey: c, sourceKey: b, rootKey: a });
    const family = await prisma.imageCopy.findMany({ where: { rootKey: a } });
    expect(family.map((r) => r.copyKey).sort()).toEqual([b, c].sort());
  });

  it('two copies of one photo: keys and stored files differ', async () => {
    const a = await storeOriginal();
    const first = (await copy(a)) as string;
    const second = (await copy(a)) as string;

    expect(first).not.toBe(second);
    const one = (await storage.get(first)) as Buffer;
    const two = (await storage.get(second)) as Buffer;
    expect(one.equals(two)).toBe(false);
  });

  it('nothing copied: gone file gives null, logos key throws a RangeError, registry unchanged', async () => {
    const gone = newImageKey('products');
    expect(await copy(gone)).toBeNull();

    const logo = newImageKey('logos');
    await storage.put(logo, Buffer.from('logo'));
    await expect(copy(logo)).rejects.toBeInstanceOf(RangeError);
    await expect(copy(newImageKey('avatars'))).rejects.toBeInstanceOf(RangeError);
    await expect(copy('products/../logos/x.webp')).rejects.toBeInstanceOf(RangeError);

    expect(await rows()).toHaveLength(0);
    expect((await storage.listFiles(null, 100)).map((f) => f.key)).toEqual([logo]);
  });

  it('shared file: two shops copy A, files differ and keys hold no id and no date', async () => {
    const a = await storeOriginal();
    const shopOne = (await copy(a)) as string;
    const shopTwo = (await copy(a)) as string;

    expect(
      ((await storage.get(shopOne)) as Buffer).equals((await storage.get(shopTwo)) as Buffer)
    ).toBe(false);
    for (const key of [shopOne, shopTwo]) {
      expect(key).not.toContain(a.slice('products/'.length, -'.webp'.length));
      expect(key).not.toMatch(/20\d{2}/);
      expect(key).toMatch(
        /^products\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/
      );
    }
  });

  it("source removed: deleting A's file leaves the copy's file and row", async () => {
    const a = await storeOriginal();
    const b = (await copy(a)) as string;

    await deleteImageFiles([a]);

    expect(await storage.get(a)).toBeNull();
    expect(await storage.get(b)).not.toBeNull();
    expect(await rows()).toHaveLength(1);
  });

  it('rolls back the registry row when the caller transaction fails (file stays for cleanup)', async () => {
    const a = await storeOriginal();
    let created: string | null = null;
    await expect(
      prisma.$transaction(async (tx) => {
        created = await copyImage(tx, a);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(await rows()).toHaveLength(0);
    expect(await storage.get(created as unknown as string)).not.toBeNull();
  });
});
