import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/lib/db.js';

describe('Database Client', () => {
  it('should have a valid Prisma client instance', () => {
    expect(prisma).toBeDefined();
    expect(prisma).toHaveProperty('$connect');
    expect(prisma).toHaveProperty('$disconnect');
  });

  it('should have all models in the current schema', () => {
    expect(prisma.person).toBeDefined();
    expect(prisma.task).toBeDefined();
    expect(prisma.taskResult).toBeDefined();
    expect(prisma.systemConfig).toBeDefined();
    expect(prisma.configHistory).toBeDefined();
  });
});
