import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5434/test_db';

/**
 * Return a Prisma client connected through the owner account while executing
 * statements as the NOLOGIN application role.
 *
 * This helper is intentionally test-only. PostgreSQL's superuser owner can
 * SET ROLE to distribo_app without giving that role a password or LOGIN.
 */
export function getAppRolePrisma(): PrismaClient {
  if (process.env.NODE_ENV !== 'test' || process.env.DATABASE_URL !== TEST_DATABASE_URL) {
    throw new Error('Refusing to connect as the application role outside the test database');
  }

  const connectionString = `${TEST_DATABASE_URL}?options=${encodeURIComponent('-c role=distribo_app')}`;
  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({ adapter });
}
