import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/lib/db.js';

describe('Database Client', () => {
  it('should have a valid Prisma client instance', () => {
    expect(prisma).toBeDefined();
    expect(prisma.$connect).toBeDefined();
    expect(prisma.$disconnect).toBeDefined();
  });

  it('should have all expected models', () => {
    expect(prisma.account).toBeDefined();
    expect(prisma.person).toBeDefined();
    expect(prisma.task).toBeDefined();
    expect(prisma.taskResult).toBeDefined();
    expect(prisma.otpChallenge).toBeDefined();
    expect(prisma.emailVerificationRequest).toBeDefined();
  });
});
