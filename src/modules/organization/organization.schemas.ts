import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { NAME_MAX, TEXT_MAX } from '../../shared/limits.js';
import { paginationQuerySchema } from '../../shared/pagination.js';
import { phoneNumberSchema } from '../../shared/phone.js';

const EMAIL_MAX = 254;

/**
 * Strict body of the create gesture: exactly four writable fields (ASVS v5.0.0-15.3.3).
 * Status, role and owner are never accepted; the server sets them.
 */
export const createOrganizationSchema = z
  .object({
    id: uuidV7Schema,
    name: z.string().trim().min(1).max(NAME_MAX),
    description: z.string().max(TEXT_MAX).optional(),
    email: z.string().max(EMAIL_MAX).email().optional(),
  })
  .strict();

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Strict list query: only `limit` and `cursor`. */
export const listOrganizationsQuerySchema = paginationQuerySchema.strict();

/** Path parameter of the detail route. */
export const organizationIdParamsSchema = z.object({ organizationId: uuidV7Schema }).strict();

/** Closed response of the create gesture. */
export type OrganizationView = {
  id: string;
  name: string;
  description: string | null;
  email: string | null;
  status: string;
  created_at: string;
  role: string;
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

/** Closed response of the invite gesture. */
export type CollaborationView = {
  id: string;
  person: { public_name: string | null; phone_number: string | null; registered: boolean };
  role: string;
  status: 'INVITED' | 'ACTIVE';
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
 * Strict body of the public-contact gesture: `is_public_contact` is the only writable field
 * (ASVS v5.0.0-15.3.3). The target row is always the caller's own, so no id is accepted.
 */
export const setPublicContactSchema = z.object({ is_public_contact: z.boolean() }).strict();

/** Path parameter of the public-contact route. */
export const organizationScopeParamsSchema = z.object({ organizationId: uuidV7Schema }).strict();

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

/** Longest accepted plan name; mirrors the other short-name limits. */
export const PLAN_MAX = 100;

/**
 * Strict body of the start-subscription gesture: exactly three writable fields (ASVS
 * v5.0.0-15.3.3). Status, organization and `starts_at` are never accepted: the server sets them.
 * `ends_at` must be a future ISO 8601 instant.
 */
export const startSubscriptionSchema = z
  .object({
    id: uuidV7Schema,
    plan: z.string().trim().min(1).max(PLAN_MAX),
    ends_at: z
      .string()
      .datetime({ offset: true })
      .refine((value) => Date.parse(value) > Date.now()),
  })
  .strict();

export type StartSubscriptionInput = z.infer<typeof startSubscriptionSchema>;

/** Closed response of the subscription routes. */
export type SubscriptionView = {
  id: string;
  plan: string;
  status: 'ACTIVE';
  starts_at: string | null;
  ends_at: string | null;
};
