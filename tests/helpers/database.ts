import type { Prisma } from '@prisma/client';
import { newId } from '../../src/shared/ids';
import { prisma } from '../setup';
import { hash } from 'bcrypt';
import { uniquePhone } from './phone';

const TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5434/test_db';

/**
 * Seed database with a test Person (creates a registered Person with credentials)
 */
export async function seedAccount(userData: {
  id?: string;
  email: string;
  password: string;
  name: string;
  phoneNumber?: string;
}) {
  const hashedPassword = await hash(userData.password, 10);

  // FND-011 requires fixtures to exercise the same UUIDv7 identifier boundary as production.
  const person = await prisma.person.create({
    data: {
      id: userData.id ?? newId(),
      passwordHash: hashedPassword,
      fullName: userData.name,
      phoneNumber: userData.phoneNumber ?? uniquePhone(),
      email: userData.email,
      registeredAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  });

  // Flattened convenience fields matching what the auth API's response body exposes.
  return {
    ...person,
    id: person.id,
    email: person.email,
    name: person.fullName,
    phoneNumber: person.phoneNumber,
    password: hashedPassword,
  };
}

/** @deprecated use {@link seedAccount} */
export const seedUser = seedAccount;

/**
 * Seed database with test task
 */
export async function seedTask(taskData: {
  id?: string;
  type: string;
  accountId: string;
  parameters?: Prisma.InputJsonObject;
  status?: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
}) {
  const task = await prisma.task.create({
    data: {
      id: taskData.id,
      type: taskData.type,
      accountId: taskData.accountId,
      parameters: taskData.parameters || {},
      status: taskData.status || 'QUEUED',
    },
  });

  return task;
}

/**
 * Clear all persons from database
 */
export async function clearUsers() {
  await prisma.person.deleteMany();
}

/**
 * Clear all tasks from database
 */
export async function clearTasks() {
  await prisma.task.deleteMany();
}

/**
 * Clear all data from database
 */
export async function clearDatabase() {
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

/**
 * Get person by email from database
 */
export async function getUserByEmail(email: string) {
  return prisma.person.findFirst({
    where: { email },
  });
}

/**
 * Get person by ID from database
 */
export async function getUserById(id: string) {
  return prisma.person.findUnique({
    where: { id },
  });
}

/**
 * Get person by phone number from database
 */
export async function getUserByPhoneNumber(phoneNumber: string) {
  return prisma.person.findFirst({
    where: { phoneNumber },
  });
}

/**
 * Mark a person's email as verified directly (bypasses the verification flow).
 */
export async function markEmailVerified(personId: string) {
  return prisma.person.update({
    where: { id: personId },
    data: { emailVerifiedAt: new Date() },
  });
}

/**
 * Mark a person's phone number as verified directly (bypasses the
 * registration OTP flow) — useful for tests that only care about
 * login/password-reset behavior, not registration itself.
 */
export async function markPhoneVerified(personId: string) {
  return prisma.person.update({
    where: { id: personId },
    data: { phoneVerifiedAt: new Date() },
  });
}

/**
 * Get task by ID from database
 */
export async function getTaskById(id: string) {
  return prisma.task.findUnique({
    where: { id },
  });
}

/**
 * Get all tasks for a person
 */
export async function getTasksByUserId(personId: string) {
  return prisma.task.findMany({
    where: { accountId: personId },
  });
}

/**
 * Count total persons in database
 */
export async function countUsers(): Promise<number> {
  return prisma.person.count();
}

/**
 * Count total tasks in database
 */
export async function countTasks(): Promise<number> {
  return prisma.task.count();
}
