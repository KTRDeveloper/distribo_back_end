import { httpError } from '../../lib/http-error.js';
import { findViewerData } from './sync.repository.js';
import type { Viewer } from './sync.types.js';

/**
 * Builds the viewer of a sync exchange from the database, never from the request
 * (ASVS v5.0.0-8.2.2, v5.0.0-8.3.1): ACTIVE memberships only, the person's current scope version.
 *
 * @param personId - From the authenticated session.
 * @param deviceId - From the authenticated session.
 * @throws HttpError 404 `NOT_FOUND` when the person does not exist (fail closed).
 */
export async function buildViewer(personId: string, deviceId: string): Promise<Viewer> {
  const data = await findViewerData(personId);
  if (!data) {
    throw httpError(404, 'NOT_FOUND', 'Not found');
  }
  return {
    personId,
    deviceId,
    memberships: data.memberships.map((m) => ({
      organizationId: m.organizationId,
      role: m.role,
      status: 'ACTIVE' as const,
    })),
    scopeVersion: data.scopeVersion,
    isOnline: false,
  };
}
