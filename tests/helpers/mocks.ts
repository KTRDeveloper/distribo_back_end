import { vi } from 'vitest';

/**
 * Mock Redis Client
 * Provides in-memory Redis implementation for testing
 */
export function createMockRedis() {
  const store = new Map<string, string>();

  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) || null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    setex: vi.fn((key: string, _seconds: number, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: vi.fn((key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
    exists: vi.fn((key: string) => Promise.resolve(store.has(key) ? 1 : 0)),
    expire: vi.fn(() => Promise.resolve(1)),
    ttl: vi.fn(() => Promise.resolve(-1)),
    keys: vi.fn((pattern: string) => {
      if (pattern === '*') {
        return Promise.resolve(Array.from(store.keys()));
      }
      return Promise.resolve([]);
    }),
    flushall: vi.fn(() => {
      store.clear();
      return Promise.resolve('OK');
    }),
    quit: vi.fn(() => Promise.resolve('OK')),
    disconnect: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };
}

interface MockJob {
  id: string;
  name: string;
  data: unknown;
  opts: unknown;
  timestamp: number;
  attemptsMade: number;
  processedOn: number | null;
  finishedOn: number | null;
  failedReason: string | null;
}

/**
 * Mock BullMQ Queue
 * Provides in-memory queue implementation for testing
 */
export function createMockQueue(name = 'test-queue') {
  const jobs = new Map<string, MockJob>();
  let jobIdCounter = 0;

  return {
    name,
    add: vi.fn((jobName: string, data: unknown, opts?: unknown) => {
      const jobId = `job-${++jobIdCounter}`;
      const job = {
        id: jobId,
        name: jobName,
        data,
        opts,
        timestamp: Date.now(),
        attemptsMade: 0,
        processedOn: null,
        finishedOn: null,
        failedReason: null,
      };
      jobs.set(jobId, job);
      return Promise.resolve(job);
    }),
    getJob: vi.fn((jobId: string) => Promise.resolve(jobs.get(jobId) || null)),
    getJobs: vi.fn(() => Promise.resolve(Array.from(jobs.values()))),
    remove: vi.fn((jobId: string) => {
      jobs.delete(jobId);
      return Promise.resolve();
    }),
    clean: vi.fn(() => {
      jobs.clear();
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    isPaused: vi.fn(() => Promise.resolve(false)),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };
}

/**
 * Mock BullMQ Worker
 * Provides mock worker for testing job processing
 */
export function createMockWorker(queueName: string, processor: unknown) {
  return {
    queueName,
    processor,
    run: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };
}

/**
 * Mock Pino Logger
 * Provides silent logger for testing (no console output)
 */
export function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  };
}

/**
 * Reset all mocks
 * Call this in beforeEach to ensure clean state
 */
export function resetAllMocks() {
  vi.clearAllMocks();
}
