import { defineConfig } from 'vitest/config';
import { TEST_WORKERS } from './tests/test-db';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Migrations run once per test run, not before every test file.
    globalSetup: ['./tests/global-setup.ts'],
    // Inside Claude Code (CLAUDECODE=1) print one dot per test plus the
    // failures, instead of one line per file, to keep agent context small.
    // CI and terminals keep the default reporter.
    reporters: process.env.CLAUDECODE ? ['dot'] : ['default'],
    // Test files run in parallel, and each worker owns a copy of the test
    // database (tests/test-db.ts): one file's cleanup can never wipe rows
    // another running file just created. TEST_WORKERS changes the count.
    maxWorkers: TEST_WORKERS,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types/',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 70,
        statements: 80,
      },
    },
    testTimeout: 10000,
  },
});
