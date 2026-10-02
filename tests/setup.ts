// IMPORTANT: Set test DATABASE_URL before any imports
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5434/test_db';
process.env.LOG_LEVEL = 'fatal'; // Valid enum: trace, debug, info, warn, error, fatal (fatal is highest/quietest)
process.env.JWT_SECRET = 'test-secret-key-must-be-at-least-32-characters-long';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_KEY = 'TnLiHyYNuboynP/t2+mZAj3QLrIgX8zS12hGPqVELH0='; // base64 encoded 32-byte key for tests
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || 'http://localhost:3000';
process.env.TEXTBEE_API_KEY = process.env.TEXTBEE_API_KEY || 'test-textbee-api-key';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'smtp.test.local';
process.env.SMTP_PORT = process.env.SMTP_PORT || '587';
process.env.SMTP_USER = process.env.SMTP_USER || 'test-smtp-user';
process.env.SMTP_PASSWORD = process.env.SMTP_PASSWORD || 'test-smtp-password';
process.env.SMTP_FROM_ADDRESS = process.env.SMTP_FROM_ADDRESS || 'no-reply@test.local';
process.env.OTP_DELIVERY_QUEUE_NAME = process.env.OTP_DELIVERY_QUEUE_NAME || 'otp-delivery-test';
// The global express-rate-limit middleware shares one in-memory counter per
// IP across the entire test run (no reset between tests/files), unrelated
// to the Redis-backed, per-purpose OTP rate limits exercised deliberately
// elsewhere. Raise it well above what any single test file's supertest
// calls could reach, so it never interferes with functional assertions.
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '100000';

import { beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'child_process';

const TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5434/test_db';

// Mock Redis before any imports
vi.mock('ioredis', () => {
  class Redis {
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn().mockResolvedValue('OK');
    setex = vi.fn().mockResolvedValue('OK');
    del = vi.fn().mockResolvedValue(1);
    exists = vi.fn().mockResolvedValue(0);
    expire = vi.fn().mockResolvedValue(1);
    ttl = vi.fn().mockResolvedValue(-1);
    keys = vi.fn().mockResolvedValue([]);
    flushall = vi.fn().mockResolvedValue('OK');
    quit = vi.fn().mockResolvedValue('OK');
    disconnect = vi.fn();
    on = vi.fn();
    once = vi.fn();
    removeListener = vi.fn();
    sendCommand = vi.fn().mockResolvedValue('OK');
    defineCommand = vi.fn();
    call = vi.fn().mockResolvedValue('OK');
    multi = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue([[null, 'OK']]),
    });
    pipeline = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue([[null, 'OK']]),
    });

    constructor() {
      // No-op constructor
    }
  }

  // src/lib/redis.ts uses the named export; keep `default` for any other consumer.
  return { default: Redis, Redis };
});

// Mock rate-limit-redis
vi.mock('rate-limit-redis', () => {
  return {
    default: class MockRedisStore {
      increment = vi.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() });
      decrement = vi.fn().mockResolvedValue(undefined);
      resetKey = vi.fn().mockResolvedValue(undefined);
      constructor() {}
    },
  };
});

// Mock BullMQ
vi.mock('bullmq', () => {
  return {
    Queue: class MockQueue {
      name: string;
      constructor(name: string) {
        this.name = name;
      }
      add = vi.fn().mockResolvedValue({ id: 'mock-job-id' });
      on = vi.fn();
      close = vi.fn().mockResolvedValue(undefined);
    },
    Worker: class MockWorker {
      on = vi.fn();
      close = vi.fn().mockResolvedValue(undefined);
    },
  };
});

// Global test database
let prisma: PrismaClient;

// Global test setup
beforeAll(() => {
  // Initialize Prisma client (env vars already set above)
  // Prisma 7 requires an explicit driver adapter (no implicit datasource.url connection)
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  prisma = new PrismaClient({ adapter });

  // Apply any pending migrations to the test database. `migrate deploy` is
  // safe/idempotent (applies only pending migrations, never resets or force-
  // pushes schema state), unlike `db push --accept-data-loss` which Prisma's
  // own AI-agent safety gate refuses to run non-interactively without fresh
  // per-invocation consent. Now that this project has real migrations under
  // prisma/migrations/, `migrate deploy` is also the more correct choice.
  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'inherit',
    });
  } catch (error) {
    console.error('Failed to apply migrations:', error);
    throw error;
  }
});

async function clearDatabase() {
  if (process.env.NODE_ENV !== 'test' || process.env.DATABASE_URL !== TEST_DATABASE_URL) {
    throw new Error('Refusing to clear a non-test database');
  }

  await prisma.$executeRaw`
    DO $$
    DECLARE
      table_name text;
    BEGIN
      FOR table_name IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '_prisma_migrations'
      LOOP
        EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', table_name);
      END LOOP;
    END $$;
  `;
}

beforeEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  // Cleanup after all tests
  await prisma.$disconnect();
});

// Export for use in tests
export { prisma };
