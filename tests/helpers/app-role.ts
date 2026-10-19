import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { isWorkerDatabaseUrl } from '../test-db';

/**
 * Return a Prisma client connected through the owner account while executing
 * statements as the NOLOGIN application role.
 *
 * This helper is intentionally test-only. PostgreSQL's superuser owner can
 * SET ROLE to distribo_app without giving that role a password or LOGIN.
 * It connects to the current worker's test database (tests/test-db.ts).
 */
export function getAppRolePrisma(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !isWorkerDatabaseUrl(databaseUrl)) {
    throw new Error('Refusing to connect as the application role outside the test database');
  }

  const connectionString = `${databaseUrl}?options=${encodeURIComponent('-c role=distribo_app')}`;
  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({ adapter });
}
