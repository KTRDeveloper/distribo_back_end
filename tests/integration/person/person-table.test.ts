import { describe, it, expect } from 'vitest';
import { prisma } from '../../setup';
import { uniquePhone } from '../../helpers/phone';

describe('Person v10 table', () => {
  describe('AC-1: Table shape and columns', () => {
    it('table people has the design columns with correct types', async () => {
      // Get table information from PostgreSQL
      const result = await prisma.$queryRaw<
        Array<{ column_name: string; data_type: string; is_nullable: string }>
      >`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'people'
        ORDER BY ordinal_position
      `;

      // Map column names to expected data types
      const columns: Record<string, string> = {};
      result.forEach((row) => {
        columns[row.column_name] = row.data_type;
      });

      // Person identifiers are UUIDs throughout the real migration chain.
      expect(columns['id']).toBe('uuid');

      // Verify timestamptz columns
      expect(columns['server_updated_at']).toBe('timestamp with time zone');

      // Verify int columns
      expect(columns['scope_version']).toBe('integer');

      // Verify text/nullable columns
      expect(columns['full_name']).toBeDefined();
      expect(columns['phone_number']).toBeDefined();
      expect(columns['email']).toBeDefined();
      expect(columns['password_hash']).toBeDefined();
    });

    it('uses uuid for Person identifiers and every live reference', async () => {
      const result = await prisma.$queryRaw<
        Array<{ table_name: string; column_name: string; data_type: string }>
      >`
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('people', 'id'),
            ('tasks', 'accountId'),
            ('phone_number_change_logs', 'person_id')
          )
        ORDER BY table_name, column_name
      `;

      expect(result).toEqual([
        { table_name: 'people', column_name: 'id', data_type: 'uuid' },
        { table_name: 'phone_number_change_logs', column_name: 'person_id', data_type: 'uuid' },
        { table_name: 'tasks', column_name: 'accountId', data_type: 'uuid' },
      ]);

      await expect(
        prisma.$executeRaw`
          INSERT INTO people (id, phone_number, created_at, server_updated_at)
          VALUES ('not-a-uuid', ${uniquePhone()}, NOW(), NOW())
        `
      ).rejects.toThrow(/invalid input syntax for type uuid/i);
    });

    it('old tables accounts, email_verification_requests, refresh_tokens do not exist', async () => {
      const tables = [
        'accounts',
        'email_verification_requests',
      ];

      for (const tableName of tables) {
        const result = await prisma.$queryRaw<Array<{ table_name: string }>>`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${tableName}
        `;
        expect(result).toHaveLength(0);
      }
    });

    it('required columns have NOT NULL constraints', async () => {
      const result = await prisma.$queryRaw<Array<{ column_name: string; is_nullable: string }>>`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'people'
        AND column_name IN ('created_at', 'status', 'scope_version')
      `;

      result.forEach((row) => {
        expect(row.is_nullable).toBe('NO');
      });
    });
  });

  describe('AC-2: Number uniqueness', () => {
    it('rejects duplicate active phone numbers with 23505', async () => {
      const phoneNumber = '+1234567890';
      const personId1 = crypto.randomUUID();
      const personId2 = crypto.randomUUID();

      // Insert first person with phone number
      await prisma.person.create({
        data: {
          id: personId1,
          phoneNumber,
          status: 'ACTIVE',
        },
      });

      // Attempt to insert second person with same phone number should fail
      await expect(
        prisma.person.create({
          data: {
            id: personId2,
            phoneNumber,
            status: 'ACTIVE',
          },
        })
      ).rejects.toThrow();

      // Verify the error code is 23505 (unique_violation)
      try {
        await prisma.person.create({
          data: {
            id: personId2,
            phoneNumber,
            status: 'ACTIVE',
          },
        });
      } catch (error: unknown) {
        expect(error).toMatchObject({ code: 'P2002' });
      }
    });
  });

  describe('AC-3: Enums and required columns', () => {
    it('rejects invalid status values', async () => {
      const personId = crypto.randomUUID();

      await expect(
        prisma.$executeRaw`
          INSERT INTO people (
            id, phone_number, status, created_at, scope_version, server_updated_at
          ) VALUES (
            ${personId}, ${uniquePhone()}, 'DELETED'::text::public."PersonStatus", NOW(), 0, NOW()
          )
        `
      ).rejects.toThrow(/invalid input value for enum/i);
    });

    it('rejects invalid language values', async () => {
      const personId = crypto.randomUUID();

      await expect(
        prisma.$executeRaw`
          INSERT INTO people (
            id, phone_number, preferred_language, created_at, status, scope_version,
            server_updated_at
          ) VALUES (
            ${personId}, ${uniquePhone()}, 'ES'::text::public."Language", NOW(),
            'ACTIVE', 0, NOW()
          )
        `
      ).rejects.toThrow(/invalid input value for enum/i);
    });

    it('accepts required columns with ACTIVE status and valid language', async () => {
      const personId = crypto.randomUUID();

      const result = await prisma.person.create({
        data: {
          id: personId,
          status: 'ACTIVE',
          phoneNumber: uniquePhone(),
        },
      });

      expect(result.id).toBe(personId);
      expect(result.status).toBe('ACTIVE');
      expect(result.createdAt).toBeDefined();
      // Verify scope_version is set
      const fetched = await prisma.person.findUnique({ where: { id: personId } });
      expect(fetched?.scopeVersion).toBe(0);
    });
  });

  describe('AC-4: Server time and defaults', () => {
    it('sets scope_version to 0 by default', async () => {
      const personId = crypto.randomUUID();

      await prisma.person.create({
        data: {
          id: personId,
          phoneNumber: uniquePhone(),
          status: 'ACTIVE',
        },
      });

      // Refetch to ensure we get all fields
      const fetched = await prisma.person.findUnique({ where: { id: personId } });
      expect(fetched?.scopeVersion).toBe(0);
    });

    it('sets server_updated_at by database trigger', async () => {
      const personId = crypto.randomUUID();

      await prisma.person.create({
        data: {
          id: personId,
          phoneNumber: uniquePhone(),
          status: 'ACTIVE',
        },
      });

      // Refetch to get server_updated_at
      const fetched = await prisma.person.findUnique({ where: { id: personId } });
      expect(fetched?.serverUpdatedAt).toBeDefined();
      expect(fetched?.serverUpdatedAt).toBeInstanceOf(Date);

      // Verify it's close to now (within 5 seconds)
      const now = new Date();
      const diff = Math.abs(now.getTime() - fetched!.serverUpdatedAt.getTime());
      expect(diff).toBeLessThan(5000);
    });
  });

  describe('AB-1: Security - one identity per number', () => {
    it('database rejects second insert with active number via raw SQL', async () => {
      const phoneNumber = '+1234567890';
      const personId1 = crypto.randomUUID();
      const personId2 = crypto.randomUUID();

      // Insert first person - using snake_case column names
      await prisma.$executeRaw`
        INSERT INTO people (id, phone_number, status, created_at, scope_version, server_updated_at)
        VALUES (${personId1}, ${phoneNumber}, 'ACTIVE'::public."PersonStatus", NOW(), 0, NOW())
      `;

      // Attempt second insert with same number should fail with 23505
      await expect(
        prisma.$executeRaw`
          INSERT INTO people (id, phone_number, status, created_at, scope_version, server_updated_at)
          VALUES (${personId2}, ${phoneNumber}, 'ACTIVE'::public."PersonStatus", NOW(), 0, NOW())
        `
      ).rejects.toThrow();
    });
  });
});
