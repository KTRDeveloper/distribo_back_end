import { readFile, readdir } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const FIRST = '0199c032-0000-7000-8000-000000000001';
const SECOND = '0199c032-0000-7000-8000-000000000002';
const THIRD = '0199c032-0000-7000-8000-000000000003';
const SUFFIX = 'decide before dropping: see OPEN_QUESTIONS';
const MIGRATIONS = new URL('../../../prisma/migrations/', import.meta.url);

type ScratchRow = { id: string; email: string | null; deletedAt?: Date };

/** Reads the migration itself so the guard tested is the one deployed. */
async function migrationStatements() {
  const directory = (await readdir(MIGRATIONS)).find((name) =>
    name.endsWith('_org_032_drop_organization_email')
  );
  if (!directory) throw new Error('ORG-032 migration is missing');
  const sql = await readFile(new URL(`${directory}/migration.sql`, MIGRATIONS), 'utf8');
  const preflight = sql.match(/^DO \$\$[\s\S]*?\$\$;/)?.[0];
  if (!preflight) throw new Error('ORG-032 must start with a preflight DO block');
  return { sql, preflight };
}

/** Runs the deployed guard against isolated rows; even a successful check rolls back its schema. */
async function runPreflight(rows: ScratchRow[]): Promise<void> {
  const { preflight } = await migrationStatements();
  const rollback = new Error('Roll back scratch schema');
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`CREATE SCHEMA org_032_preflight`;
      await tx.$executeRaw`SET LOCAL search_path = org_032_preflight, public`;
      await tx.$executeRaw`
        CREATE TABLE organizations (id uuid, email text, deleted_at timestamptz)
      `;
      if (rows.length > 0) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO organizations (id, email, deleted_at)
          VALUES ${Prisma.join(
            rows.map((row) => Prisma.sql`(${row.id}::uuid, ${row.email}, ${row.deletedAt ?? null})`)
          )}
        `);
      }
      // Trusted migration SQL, not request input; PostgreSQL must execute the actual DO block.
      await tx.$executeRawUnsafe(preflight);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

describe('ORG-032 organization email removal', () => {
  it('removes only email and preserves the other columns, including C-35 timestamps', async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'organizations'
    `;
    expect(columns.map((column) => column.column_name).sort()).toEqual(
      [
        'id',
        'name',
        'description',
        'status',
        'logo_key',
        'payment_code',
        'plan',
        'plan_ends_at',
        'grace_ends_at',
        'max_collaborators',
        'max_products',
        'created_at',
        'server_updated_at',
        'deleted_at',
      ].sort()
    );
  });

  it('stops on stored addresses and names the two organizations without leaking addresses', async () => {
    await expect(
      runPreflight([
        { id: FIRST, email: 'first@example.test' },
        { id: SECOND, email: 'second@example.test' },
        { id: THIRD, email: null },
      ])
    ).rejects.toThrow(`${FIRST},${SECOND}: ${SUFFIX}`);
    try {
      await runPreflight([{ id: FIRST, email: 'private@example.test' }]);
      expect.fail('The preflight must reject an unresolved address');
    } catch (error) {
      expect(String(error)).not.toContain('private@example.test');
    }
  });

  it('passes on a clean table', async () => {
    await expect(
      runPreflight([
        { id: FIRST, email: null },
        { id: SECOND, email: null },
      ])
    ).resolves.toBeUndefined();
  });

  it('fails closed on a non-null empty address rather than silently discarding it', async () => {
    await expect(runPreflight([{ id: FIRST, email: '' }])).rejects.toThrow(
      `${FIRST}: ${SUFFIX}`
    );
  });

  it('limits the diagnostic to 20 comma-separated ids even when more rows need a decision', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: `0199c032-0000-7000-8000-${String(index + 1).padStart(12, '0')}`,
      email: 'private@example.test',
    }));
    await expect(runPreflight(rows)).rejects.toThrow(
      `${rows
        .slice(0, 20)
        .map((row) => row.id)
        .join(',')}: ${SUFFIX}`
    );
    try {
      await runPreflight(rows);
      expect.fail('The preflight must reject unresolved addresses beyond the diagnostic limit');
    } catch (error) {
      expect(String(error)).not.toContain(rows[20].id);
      expect(String(error)).not.toContain('private@example.test');
    }
  });

  it('ignores deleted rows when checking live organizations', async () => {
    await expect(
      runPreflight([
        { id: FIRST, email: 'deleted@example.test', deletedAt: new Date('2026-01-01T00:00:00Z') },
        { id: SECOND, email: null },
      ])
    ).resolves.toBeUndefined();
  });

  it('puts the fail-closed preflight before the drop with no conversion or silent loss', async () => {
    const { sql, preflight } = await migrationStatements();
    expect(preflight).toMatch(/RAISE EXCEPTION/);
    expect(preflight).toContain(SUFFIX);
    expect(sql.slice(preflight.length).trim()).toBe('ALTER TABLE organizations DROP COLUMN email;');
  });

  it('still creates and reads the business through the API without the removed field', async () => {
    await prisma.person.create({
      data: {
        id: FIRST,
        fullName: 'Fixture Owner',
        phoneNumber: '+237600032001',
        phoneVerifiedAt: new Date(),
        registeredAt: new Date(),
        passwordHash: 'test-password-hash',
      },
    });
    const actor = createAuthenticatedRequest(app, FIRST);
    const created = await actor.post('/api/v1/organizations').send({
      id: SECOND,
      name: 'Fixture Business',
      description: 'Fixture description',
    });
    expect(created.status).toBe(201);
    expect(bodyOf<Record<string, unknown>>(created)).toMatchObject({
      id: SECOND,
      name: 'Fixture Business',
      description: 'Fixture description',
      status: 'ACTIVE',
    });
    expect(bodyOf<Record<string, unknown>>(created)).not.toHaveProperty('email');

    const read = await actor.get(`/api/v1/organizations/${SECOND}`);
    expect(read.status).toBe(200);
    const detail = bodyOf<Record<string, unknown>>(read);
    expect(detail).toMatchObject({
      id: SECOND,
      name: 'Fixture Business',
      description: 'Fixture description',
      status: 'ACTIVE',
      role: 'OWNER',
      plan: 'FREE',
      plan_ends_at: null,
      grace_ends_at: null,
      max_collaborators: 2,
      max_products: 30,
    });
    expect(detail.payment_code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
    expect(Object.keys(detail).sort()).toEqual(
      [
        'id',
        'name',
        'description',
        'status',
        'created_at',
        'role',
        'payment_code',
        'plan',
        'plan_ends_at',
        'grace_ends_at',
        'max_collaborators',
        'max_products',
      ].sort()
    );
  });
});
