import { prisma } from '../../lib/db.js';
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
