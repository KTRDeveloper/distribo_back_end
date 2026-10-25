import type { Prisma } from '@prisma/client';

/** A step run inside the caller's transaction when a business closes or reopens. */
export type HookFn = (
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date
) => Promise<void>;

/** What another module (billing) plugs into the close and reopen of a business (CM-10). */
export type LifecycleHook = { onClose?: HookFn; onReopen?: HookFn };

const hooks = new Set<LifecycleHook>();

/**
 * Registers a lifecycle hook, patterned on the sync registry.
 *
 * @returns A function that removes this hook.
 * @throws Error when the hook has neither `onClose` nor `onReopen`, so a wiring mistake stops
 * the app at startup instead of registering a hook that never runs.
 */
export function registerLifecycleHook(hook: LifecycleHook): () => void {
  if (!hook.onClose && !hook.onReopen) {
    throw new Error('A lifecycle hook needs an onClose or an onReopen function');
  }
  // A copy, so a later change to the caller's object cannot alter what runs.
  const stored: LifecycleHook = { onClose: hook.onClose, onReopen: hook.onReopen };
  hooks.add(stored);
  return () => {
    hooks.delete(stored);
  };
}

/**
 * Runs every `onClose` in registration order, in the caller's transaction. A hook that throws
 * aborts the close: the error goes up unchanged and the transaction rolls back (ASVS v5.0.0-2.3.3).
 * The organization id is the actor's, never one from the body (ASVS v5.0.0-8.2.1).
 */
export async function runCloseHooks(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date
): Promise<void> {
  for (const hook of [...hooks]) {
    if (hook.onClose) await hook.onClose(tx, organizationId, now);
  }
}

/** Runs every `onReopen` in registration order, in the caller's transaction; same rules as close. */
export async function runReopenHooks(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date
): Promise<void> {
  for (const hook of [...hooks]) {
    if (hook.onReopen) await hook.onReopen(tx, organizationId, now);
  }
}
