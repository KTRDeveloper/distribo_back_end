import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { NAME_MAX, TEXT_MAX } from '../../shared/limits.js';
import { paginationQuerySchema } from '../../shared/pagination.js';
import { phoneNumberSchema } from '../../shared/phone.js';

/**
 * Strict body of the create gesture: exactly three writable fields (ASVS v5.0.0-15.3.3).
 * Status, role and owner are never accepted; the server sets them.
 */
export const createOrganizationSchema = z
  .object({
    id: uuidV7Schema,
    name: z.string().trim().min(1).max(NAME_MAX),
    description: z.string().max(TEXT_MAX).optional(),
  })
  .strict();

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Strict list query: only `limit` and `cursor`. */
export const listOrganizationsQuerySchema = paginationQuerySchema.strict();

/** Path parameter of the detail route. */
export const organizationIdParamsSchema = z.object({ organizationId: uuidV7Schema }).strict();

/**
 * Closed response of the create gesture and of the detail read. The plan fields are in this
 * view only, which only the team of the business can read (C-41; ASVS v5.0.0-15.3.1).
 */
export type OrganizationView = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  role: string;
  payment_code: string;
  plan: 'FREE' | 'ESSENTIAL' | 'PRO' | 'ENTERPRISE';
  plan_ends_at: string | null;
  grace_ends_at: string | null;
  max_collaborators: number | null;
  max_products: number | null;
};

/** One item of the list of my organizations. */
export type MyOrganizationItem = {
  id: string;
  name: string;
  status: string;
  role: string;
};

/**
 * Strict body of the invite gesture: exactly three writable fields (ASVS v5.0.0-15.3.3).
 * The role can never be OWNER, and status, organization and person are never accepted: the
 * server sets them (CWE-915). The number is normalized to E.164 and landlines are refused.
 */
export const inviteCollaboratorSchema = z
  .object({
    id: uuidV7Schema,
    phone_number: phoneNumberSchema,
    role: z.enum(['MANAGER', 'SELLER', 'DRIVER']),
  })
  .strict();

export type InviteInput = z.infer<typeof inviteCollaboratorSchema>;

/** Closed response of the invite and role-change gestures. */
export type CollaborationView = {
  id: string;
  person: {
    public_name: string | null;
    phone_number: string | null;
    registered: boolean;
    avatar_url: string | null;
  };
  role: string;
  status: 'INVITED' | 'ACTIVE' | 'PAUSED';
  invited_at: string;
};

/**
 * Strict body of the change-role gesture: `role` is the only writable field (ASVS v5.0.0-8.2.3,
 * v5.0.0-15.3.3). OWNER is not accepted: ownership moves only through a transfer (CM-09).
 */
export const changeRoleSchema = z
  .object({ role: z.enum(['MANAGER', 'SELLER', 'DRIVER']) })
  .strict();

export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

/** Path parameters of the change-role route. */
export const collaboratorParamsSchema = z
  .object({ organizationId: uuidV7Schema, collaborationId: uuidV7Schema })
  .strict();

/** Strict query of the invitation list: only the INVITED status, `limit` and `cursor`. */
export const listInvitationsQuerySchema = paginationQuerySchema
  .extend({ status: z.literal('INVITED') })
  .strict();

/** Path parameter of the accept and decline routes. */
export const collaborationIdParamsSchema = z.object({ id: uuidV7Schema }).strict();

/** One pending invitation of the caller, explicit fields only (ASVS v5.0.0-15.3.1). */
export type InvitationItem = {
  id: string;
  organization_id: string;
  organization_name: string;
  role: string;
  invited_at: string;
};

/**
 * Strict body of the transfer-ownership gesture: the gesture id and the target collaboration are
 * the only writable fields (ASVS v5.0.0-15.3.3). The caller's own row is never named by the
 * client: the server reads it from the loaded actor.
 */
export const transferOwnershipSchema = z
  .object({ id: uuidV7Schema, collaboration_id: uuidV7Schema })
  .strict();

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;

/** Closed response of the transfer-ownership gesture. */
export type TransferOwnershipView = { new_owner_collaboration_id: string };

/**
 * Strict body of the close-organization gesture: the gesture id is the only field (ASVS
 * v5.0.0-15.3.3). The organization comes from the path and the loaded actor.
 */
export const closeOrganizationSchema = z.object({ id: uuidV7Schema }).strict();

export type CloseOrganizationInput = z.infer<typeof closeOrganizationSchema>;

/** Closed response of the close-organization gesture. */
export type CloseOrganizationView = { status: 'CLOSED' };

/** Strict query of the public-number lookup: one phone number, normalized to E.164. */
export const lookupOrganizationsQuerySchema = z.object({ phone: phoneNumberSchema }).strict();

/** One business found by a public number: three fields, no collaborator data (ASVS v5.0.0-15.3.1). */
export type OrganizationLookupItem = { id: string; name: string; description: string | null };

/** Strict query of the team list: only `limit` and `cursor`. */
export const listCollaboratorsQuerySchema = paginationQuerySchema.strict();

/**
 * One row of the team list. `amount_held` exists only for the OWNER caller and for the caller's
 * own row (ASVS v5.0.0-8.2.3); it is absent, not null, for everyone else.
 */
export type CollaboratorItem = {
  id: string;
  person: {
    public_name: string | null;
    phone_number: string | null;
    registered: boolean;
    avatar_url: string | null;
  };
  role: string;
  status: 'INVITED' | 'ACTIVE' | 'PAUSED' | 'REVOKED';
  invited_at: string;
  accepted_at: string | null;
  amount_held?: number;
};
