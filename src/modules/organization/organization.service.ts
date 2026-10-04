import type { Actor } from '../../types/express.js';
import { httpError } from '../../lib/http-error.js';
import {
  findOrganization,
  insertOrganizationWithOwner,
  listActiveOrganizations,
} from './organization.repository.js';
import type {
  CreateOrganizationInput,
  MyOrganizationItem,
  OrganizationView,
} from './organization.schemas.js';

/**
 * Creates an organization owned by the caller.
 *
 * The owner is always the authenticated person, never a body field (ASVS v5.0.0-8.2.1).
 *
 * @param personId - Authenticated person who becomes the OWNER.
 * @param input - Validated body.
 * @returns The closed organization view with the caller's role.
 */
export async function createOrganization(
  personId: string,
  input: CreateOrganizationInput
): Promise<OrganizationView> {
  const org = await insertOrganizationWithOwner(personId, input);
  return {
    id: org.id,
    name: org.name,
    description: org.description,
    email: org.email,
    status: org.status,
    created_at: org.createdAt.toISOString(),
    role: 'OWNER',
  };
}

/**
 * Lists the caller's organizations (ACTIVE collaborations only), newest first.
 *
 * @param personId - Authenticated person; never a client-supplied id.
 * @param query - Validated page size and cursor.
 * @returns A page of closed items and the next cursor.
 */
export async function listMyOrganizations(
  personId: string,
  query: { limit: number; cursor?: string }
): Promise<{ items: MyOrganizationItem[]; next_cursor: string | null }> {
  const { rows, nextCursor } = await listActiveOrganizations(personId, query);
  return {
    items: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, role: r.role })),
    next_cursor: nextCursor,
  };
}

/**
 * Returns one organization's details with the actor's role.
 *
 * @param actor - Actor loaded from the path by `loadActor`.
 * @throws 404 `NOT_FOUND` if the organization vanished between the membership check and the read.
 */
export async function getOrganizationDetails(actor: Actor): Promise<OrganizationView> {
  const org = await findOrganization(actor.organizationId);
  if (!org) throw httpError(404, 'NOT_FOUND', 'Not found');
  return {
    id: org.id,
    name: org.name,
    description: org.description,
    email: org.email,
    status: org.status,
    created_at: org.createdAt.toISOString(),
    role: actor.role,
  };
}
