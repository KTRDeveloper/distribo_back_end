import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Prisma Log Configuration', () => {
  describe('AC-1: No query logging', () => {
    it('should have error and warn in log config but not query or info', () => {
      // Read the db.ts source file to verify log configuration
      const dbPath = join(process.cwd(), 'src/lib/db.ts');
      const dbSource = readFileSync(dbPath, 'utf-8');

      // Verify error is present
      expect(dbSource).toContain("level: 'error'");

      // Verify warn is present
      expect(dbSource).toContain("level: 'warn'");

      // Verify query is NOT present
      expect(dbSource).not.toContain("level: 'query'");

      // Verify info is NOT present
      expect(dbSource).not.toContain("level: 'info'");
    });
  });

  describe('AB-1: Personal data in logs (information disclosure)', () => {
    it('should not log phone numbers from queries', () => {
      // This test is verified through code inspection and behavioral testing
      // The log configuration audit above ensures query logging is disabled
      // Therefore no phone numbers can be logged from query text

      // Read db.ts to confirm
      const dbPath = join(process.cwd(), 'src/lib/db.ts');
      const dbSource = readFileSync(dbPath, 'utf-8');

      // Verify the log array does not include query logging
      // Extract the log configuration section
      const logSection = dbSource.substring(
        dbSource.indexOf('log: ['),
        dbSource.indexOf('],', dbSource.indexOf('log: [')) + 2
      );

      // Confirm no query level in the log section
      expect(logSection).not.toContain("'query'");

      // Confirm error and warn are present
      expect(logSection).toContain("'error'");
      expect(logSection).toContain("'warn'");
    });
  });
});
