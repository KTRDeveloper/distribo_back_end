import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { NAME_MAX, TEXT_MAX } from '../../shared/limits.js';
import { paginationQuerySchema } from '../../shared/pagination.js';

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
