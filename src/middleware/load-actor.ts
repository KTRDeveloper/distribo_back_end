import type { Collaboration, Prisma } from '@prisma/client';
import type { RequestHandler } from 'express';
import { httpError } from '../lib/http-error.js';
import {
  findActiveCollaboration,
  findOrganizationStatus,
} from '../modules/organization/organization.repository.js';
import { ROLES } from '../shared/access/roles.js';
import { uuidV7Schema } from '../shared/ids.js';

/**
 * Loads `req.actor` from the caller's ACTIVE collaboration in `req.params.organizationId`.
 *
 * The person comes from the verified token and the organization from the path only; a body or
 * header value is never read (ASVS v5.0.0-8.2.2, CWE-639). Every non-member case (no
 * collaboration, INVITED, REVOKED, unknown id) answers the same 404, so an organization id is
 * never confirmed (ASVS v5.0.0-8.4.1). A malformed id answers 400: it can match no row.
 *
 * @throws 401 `UNAUTHORIZED` when no person is authenticated; 400 `VALIDATION_ERROR` for a
 * malformed id; 404 `NOT_FOUND` when not a member.
 */
export const loadActor: RequestHandler = (req, _res, next) => {
  const personId = req.user?.id;
  if (!personId) {
    next(httpError(401, 'UNAUTHORIZED', 'Authentication required'));
    return;
  }

  const organizationId: unknown = req.params.organizationId;
  const parsed = uuidV7Schema.safeParse(organizationId);
  if (!parsed.success) {
    next(httpError(400, 'VALIDATION_ERROR', 'Invalid request'));
    return;
  }

  getActiveCollaboration(personId, parsed.data)
    .then((collaboration) => {
      const role = ROLES.find((candidate) => candidate === collaboration?.role);
      if (!collaboration || !role) {
        throw httpError(404, 'NOT_FOUND', 'Not found');
      }
      req.actor = { personId, organizationId: collaboration.organizationId, role };
      next();
    })
    .catch(next);
};

/**
 * Returns the person's ACTIVE, non-deleted collaboration in the organization, or null.
 *
 * @param personId - Authenticated person.
 * @param organizationId - Organization from the path.
 */
export function getActiveCollaboration(
  personId: string,
  organizationId: string
): Promise<Collaboration | null> {
  return findActiveCollaboration(personId, organizationId);
}

/**
 * Fails closed unless the organization is ACTIVE.
 *
 * @param organizationId - Organization to check.
 * @param tx - Optional transaction so the check shares the caller's snapshot.
 * @throws 409 `ORGANIZATION_NOT_ACTIVE` when SUSPENDED or CLOSED; 404 `NOT_FOUND` when absent.
 */
export async function assertOrganizationActive(
  organizationId: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const status = await findOrganizationStatus(organizationId, tx);
  if (status === null) {
    throw httpError(404, 'NOT_FOUND', 'Not found');
  }
  if (status !== 'ACTIVE') {
    throw httpError(409, 'ORGANIZATION_NOT_ACTIVE', 'Organization is not active');
  }
}
