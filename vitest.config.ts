import { defineConfig } from 'vitest/config';

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
    // Integration test files share one physical Postgres database and each
    // file's beforeEach truncates shared tables — running files in parallel
    // lets one file's cleanup wipe rows another concurrently-running file
    // just created (observed as spurious FK violations / "not found" errors
    // when the full suite ran in parallel). Force sequential file execution.
    fileParallelism: false,
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
