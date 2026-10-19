import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { prisma } from '../../setup.js';
import { newId } from '../../../src/shared/ids.js';
import { newImageKey } from '../../../src/lib/image-keys.js';
import {
  getLogoKey,
  setLogoKey,
  runInTransaction,
} from '../../../src/modules/organization/organization.repository.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';

const OWNER_ID = '0199c038-0000-7000-8000-000000000001';
const createdIds: string[] = [];

async function organization(logoKey: string | null = null, deleted = false): Promise<string> {
  const org = await prisma.organization.create({
    data: {
      id: newId(),
      name: 'Logo fixture',
      logoKey,
      deletedAt: deleted ? new Date() : null,
    },
  });
  createdIds.push(org.id);
  return org.id;
}

async function storedKey(id: string): Promise<string | null> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id },
    select: { logoKey: true },
  });
  return org.logoKey;
}

/** Calls `setLogoKey` in its own transaction, as the images module does. */
function write(id: string, key: string | null): Promise<string | null> {
  return runInTransaction((tx) => setLogoKey(tx, id, key));
}

function errorCode(error: unknown): string | undefined {
  const e = error as {
    code?: string;
    meta?: { driverAdapterError?: { cause?: { originalCode?: string; code?: string } } };
  };
  const cause = e.meta?.driverAdapterError?.cause;
  return cause?.originalCode ?? cause?.code ?? e.code;
}

beforeEach(async () => {
  await prisma.person.upsert({
    where: { id: OWNER_ID },
    update: {},
    create: {
      id: OWNER_ID,
      fullName: 'Logo Owner',
      phoneNumber: '+237600038001',
      phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      passwordHash: 'test-password-hash',
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: createdIds } } });
});

describe('setLogoKey and getLogoKey', () => {
  it('sets, replaces and clears the key, returning the previous one (AC-1)', async () => {
    const id = await organization();
    const keyA = newImageKey('logos');
    const keyB = newImageKey('logos');

    expect(await write(id, keyA)).toBeNull();
    expect(await getLogoKey(id)).toBe(keyA);

    expect(await write(id, keyB)).toBe(keyA);
    expect(await getLogoKey(id)).toBe(keyB);

    expect(await write(id, null)).toBe(keyB);
    expect(await getLogoKey(id)).toBeNull();
    expect(await storedKey(id)).toBeNull();
  });

  it('fails with 404 NOT_FOUND for an unknown or deleted business (AC-2)', async () => {
    const deleted = await organization(null, true);

    for (const id of [newId(), deleted]) {
      await expect(write(id, newImageKey('logos'))).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
      expect(await getLogoKey(id)).toBeNull();
    }
    expect(await storedKey(deleted)).toBeNull();
  });

  it('does not return the key of a deleted business', async () => {
    const id = await organization(newImageKey('logos'), true);

    expect(await getLogoKey(id)).toBeNull();
  });

  it('refuses a key held by another business with 23505 (AC-3)', async () => {
    const keyA = newImageKey('logos');
    const keyY = newImageKey('logos');
    const x = await organization(keyA);
    const y = await organization(keyY);

    const error = await write(y, keyA).then(
      () => undefined,
      (e: unknown) => e
    );

    expect(error).toBeDefined();
    expect(errorCode(error)).toMatch(/23505|P2002/);
    expect(await storedKey(y)).toBe(keyY);
    expect(await storedKey(x)).toBe(keyA);
  });

  it('writes in the caller transaction, so a rollback restores the key (AC-4)', async () => {
    const keyA = newImageKey('logos');
    const id = await organization(keyA);
    const rollback = new Error('rollback');

    await expect(
      runInTransaction(async (tx) => {
        expect(await setLogoKey(tx, id, newImageKey('logos'))).toBe(keyA);
        throw rollback;
      })
    ).rejects.toBe(rollback);

    expect(await storedKey(id)).toBe(keyA);
  });

  it('serializes two replacements at once (AC-5)', async () => {
    const keyA = newImageKey('logos');
    const keyB = newImageKey('logos');
    const keyC = newImageKey('logos');
    const id = await organization(keyA);

    const returned = await Promise.all([write(id, keyB), write(id, keyC)]);

    expect(returned).toContain(keyA);
    const other = returned.find((value) => value !== keyA);
    expect([keyB, keyC]).toContain(other);
    expect(await storedKey(id)).toBe(other === keyB ? keyC : keyB);
  });
});

describe('security', () => {
  it('throws a RangeError for a crafted key and writes nothing (AB-1)', async () => {
    const keyA = newImageKey('logos');
    const id = await organization(keyA);
    const uuid = newImageKey('logos').slice('logos/'.length);
    const crafted = [
      newImageKey('avatars'),
      'logos/../x.webp',
      `logos/${uuid.toUpperCase().replace('.WEBP', '.webp')}`,
    ];

    for (const key of crafted) {
      await expect(write(id, key)).rejects.toBeInstanceOf(RangeError);
    }
    expect(await storedKey(id)).toBe(keyA);
  });

  it('rejects a logo_key in the creation body and creates nothing (AB-2)', async () => {
    const id = newId();

    const response = await createAuthenticatedRequest(app, OWNER_ID)
      .post('/api/v1/organizations')
      .send({ id, name: 'Sneaky', logo_key: newImageKey('logos') });

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.organization.count({ where: { id } })).toBe(0);
  });
});
