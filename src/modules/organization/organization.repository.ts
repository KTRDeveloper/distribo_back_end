import type { Collaboration, Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
import { newId } from '../../shared/ids.js';
import { bumpScopeVersion } from '../person/person.repository.js';
import type { CreateOrganizationInput } from './organization.schemas.js';

export type CreatedOrganization = {
  id: string;
  name: string;
  description: string | null;
  email: string | null;
  status: string;
  createdAt: Date;
};

/**
 * Inserts an organization, its ACTIVE OWNER collaboration and the owner's scope bump in one
 * transaction (C-05: exactly one active owner at commit; CM-03; ASVS v5.0.0-2.3.3).
 *
 * @param personId - Owner, taken from the token.
 * @param input - Validated body.
 * @returns The stored organization fields.
 */
export async function insertOrganizationWithOwner(
  personId: string,
  input: CreateOrganizationInput
): Promise<CreatedOrganization> {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        id: input.id,
        name: input.name,
        description: input.description ?? null,
        email: input.email ?? null,
      },
      select: {
        id: true,
        name: true,
        description: true,
        email: true,
        status: true,
        createdAt: true,
      },
    });

    await tx.collaboration.create({
      data: {
        id: newId(),
        personId,
        organizationId: org.id,
        role: 'OWNER',
        status: 'ACTIVE',
        isPublicContact: true,
        acceptedAt: new Date(),
      },
    });

    await bumpScopeVersion(personId, tx);
    return org;
  });
}

export type MyOrganizationRow = {
  id: string;
  name: string;
  status: string;
  role: string;
  createdAt: Date;
};

/**
 * Finds the person's ACTIVE, non-deleted collaboration in a non-deleted organization.
 *
 * @param personId - Person from the token.
 * @param organizationId - Organization id from the path.
 * @returns The collaboration or null.
 */
export function findActiveCollaboration(
  personId: string,
  organizationId: string
): Promise<Collaboration | null> {
  return prisma.collaboration.findFirst({
    where: {
      personId,
      organizationId,
      status: 'ACTIVE',
      deletedAt: null,
      organization: { deletedAt: null },
    },
  });
}

/**
 * Reads the status of a non-deleted organization.
 *
 * @param organizationId - Organization to read.
 * @param tx - Optional transaction client.
 * @returns The status, or null when the organization does not exist.
 */
export async function findOrganizationStatus(
  organizationId: string,
  tx?: Prisma.TransactionClient
): Promise<string | null> {
  const org = await (tx ?? prisma).organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { status: true },
  });
  return org?.status ?? null;
}

/**
 * Lists the organizations where the person has an ACTIVE collaboration, newest first
 * (created_at descending then id), keyset-paged.
 *
 * @param personId - Person from the token.
 * @param query - Page size and optional opaque cursor.
 * @returns Rows (at most limit) and the cursor of the next page, or null.
 */
export async function listActiveOrganizations(
  personId: string,
  query: { limit: number; cursor?: string }
): Promise<{ rows: MyOrganizationRow[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const found = await prisma.collaboration.findMany({
    where: {
      personId,
      status: 'ACTIVE',
      deletedAt: null,
      organization: {
        deletedAt: null,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
    },
    select: {
      role: true,
      organization: { select: { id: true, name: true, status: true, createdAt: true } },
    },
    orderBy: [{ organization: { createdAt: 'desc' } }, { organizationId: 'asc' }],
    take: query.limit + 1,
  });
  const page = found.slice(0, query.limit).map((c) => ({
    id: c.organization.id,
    name: c.organization.name,
    status: c.organization.status,
    role: c.role,
    createdAt: c.organization.createdAt,
  }));
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

/**
 * Reads the stored fields of one non-deleted organization.
 *
 * @param organizationId - Organization id taken from the loaded actor.
 */
export function findOrganization(organizationId: string): Promise<CreatedOrganization | null> {
  return prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      description: true,
      email: true,
      status: true,
      createdAt: true,
    },
  });
}
