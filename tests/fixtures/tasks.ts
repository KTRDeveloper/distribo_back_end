/**
 * Task Test Fixtures
 * Provides factory functions for creating test task data
 */

export interface TaskFixture {
  id?: string;
  title: string;
  description?: string;
  status?: 'pending' | 'in-progress' | 'completed';
  accountId: string;
}

/**
 * Create default test task data
 */
export function createTaskData(accountId: string, overrides?: Partial<TaskFixture>): TaskFixture {
  return {
    title: 'Test Task',
    description: 'This is a test task',
    status: 'pending',
    accountId,
    ...overrides,
  };
}

/**
 * Create multiple test tasks for a user
 */
export function createMultipleTasks(accountId: string, count: number): TaskFixture[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `Test Task ${i + 1}`,
    description: `Description for task ${i + 1}`,
    status: 'pending' as const,
    accountId,
  }));
}

/**
 * Create task with different statuses
 */
export function createTasksByStatus(accountId: string) {
  return {
    pending: createTaskData(accountId, { title: 'Pending Task', status: 'pending' }),
    inProgress: createTaskData(accountId, { title: 'In Progress Task', status: 'in-progress' }),
    completed: createTaskData(accountId, { title: 'Completed Task', status: 'completed' }),
  };
}

/**
 * Create task with missing required fields
 */
export function createTaskWithMissingFields(): Partial<TaskFixture> {
  return {
    // Missing title and accountId
    description: 'Task without required fields',
  };
}

/**
 * Create task with invalid data
 */
export function createTaskWithInvalidData(accountId: string): Partial<TaskFixture> {
  return {
    title: '', // Empty title
    accountId,
  };
}

/**
 * Create task for update testing
 */
export function createTaskUpdateData(): Partial<TaskFixture> {
  return {
    title: 'Updated Task Title',
    description: 'Updated description',
    status: 'in-progress',
  };
}

/**
 * Create task with long description
 */
export function createTaskWithLongDescription(accountId: string): TaskFixture {
  return {
    title: 'Task with Long Description',
    description: 'A'.repeat(1000), // Very long description
    status: 'pending',
    accountId,
  };
}

/**
 * Create task with minimal data
 */
export function createMinimalTask(accountId: string): Omit<TaskFixture, 'id' | 'description' | 'status'> {
  return {
    title: 'Minimal Task',
    accountId,
  };
}
