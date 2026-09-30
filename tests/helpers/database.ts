import { prisma } from '../setup';
import { hash } from 'bcrypt';
import { uniquePhone } from './phone';

/**
 * Seed database with a test account (creates a Person + Account together)
 */
export async function seedAccount(userData: {
  id?: string;
  email: string;
  password: string;
  name: string;
  phoneNumber?: string;
}) {
  const hashedPassword = await hash(userData.password, 10);

  const account = await prisma.account.create({
    data: {
      id: userData.id,
      passwordHash: hashedPassword,
      person: {
        create: {
          phoneNumber: userData.phoneNumber ?? uniquePhone(),
          fullName: userData.name,
          email: userData.email,
        },
      },
    },
    include: { person: true },
  });

  // Flattened convenience fields alongside the raw Account+Person shape,
  // matching what the auth API's response body exposes.
  return {
    ...account,
    email: account.person.email,
    name: account.person.fullName,
    phoneNumber: account.person.phoneNumber,
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
  parameters?: any;
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
 * Clear all accounts (and their linked people) from database
 */
export async function clearUsers() {
  await prisma.account.deleteMany();
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
  await prisma.taskResult.deleteMany();
  await prisma.task.deleteMany();
  await prisma.otpChallenge.deleteMany();
  await prisma.emailVerificationRequest.deleteMany();
  await prisma.account.deleteMany();
  await prisma.person.deleteMany();
}

/**
 * Get account by email (joined through Person) from database
 */
export async function getUserByEmail(email: string) {
  return prisma.account.findFirst({
    where: { person: { email } },
    include: { person: true },
  });
}

/**
 * Get account by ID from database
 */
export async function getUserById(id: string) {
  return prisma.account.findUnique({
    where: { id },
    include: { person: true },
  });
}

/**
 * Get account by phone number (joined through Person) from database
 */
export async function getUserByPhoneNumber(phoneNumber: string) {
  return prisma.account.findFirst({
    where: { person: { phoneNumber } },
    include: { person: true },
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
 * Get all tasks for an account
 */
export async function getTasksByUserId(accountId: string) {
  return prisma.task.findMany({
    where: { accountId },
  });
}

/**
 * Count total accounts in database
 */
export async function countUsers(): Promise<number> {
  return prisma.account.count();
}

/**
 * Count total tasks in database
 */
export async function countTasks(): Promise<number> {
  return prisma.task.count();
}
