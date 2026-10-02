import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { logger } from './logger.js';

/**
 * Prisma client singleton
 * Ensures single database connection across application
 *
 * Prisma 7 requires an explicit driver adapter (no more implicit
 * datasource.url connection) — see prisma.config.ts for the CLI/migrate side.
 *
 * Log configuration (ASVS v5.0.0-16.2.5): Only error and warn levels are enabled.
 * Query logging is disabled to prevent personal data (phone numbers, emails, etc.)
 * from appearing in application logs. This ensures compliance with data protection
 * requirements and prevents information disclosure vulnerabilities.
 */
declare global {
  var prisma: PrismaClient | undefined;
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma =
  global.prisma ||
  new PrismaClient({
    adapter,
    log: [
      { level: 'error', emit: 'stdout' },
      { level: 'warn', emit: 'stdout' },
    ],
  });

// Prevent multiple instances in development
if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

/**
 * Connect to database
 * Tests connection and logs status
 */
export async function connectDb() {
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (error) {
    logger.error({ error }, 'Failed to connect to database');
    throw error;
  }
}

/**
 * Disconnect from database
 * Graceful shutdown
 */
export async function disconnectDb() {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  } catch (error) {
    logger.error({ error }, 'Failed to disconnect from database');
    throw error;
  }
}
