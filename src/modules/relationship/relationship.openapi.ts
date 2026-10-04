import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { uuidV7Schema } from '../../shared/ids.js';
import { addCustomerSchema, listCustomersQuerySchema } from './relationship.schemas.js';

const organizationParamsSchema = z.object({ organizationId: uuidV7Schema });

const publicPersonSchema = z.object({
  public_name: z.string().nullable(),
  phone_number: z.string().nullable(),
  registered: z.boolean(),
});

/** Supplier-side view: `customer_label` and `supplier_notes` in, `supplier_label` never (CM-19). */
const supplierRelationshipViewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['PENDING', 'ACTIVE', 'ENDED']),
  customer: z
    .union([
      z.object({ kind: z.literal('PERSON'), person: publicPersonSchema }),
      z.object({ kind: z.literal('ORGANIZATION'), name: z.string() }),
    ])
    .nullable(),
  customer_label: z.string().nullable(),
  supplier_notes: z.string().nullable(),
  delivery_address: z.string().nullable(),
  credit_limit: z.number().int().nullable(),
  credit_limit_set_by_id: z.string().uuid().nullable(),
  credit_limit_set_at: z.string().datetime().nullable(),
  balance: z.number().int(),
  ended_by_party: z.enum(['SUPPLIER', 'CUSTOMER']).nullable(),
  created_at: z.string().datetime(),
});

const errorContent = { 'application/json': { schema: errorResponseSchema } };

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/customers',
  tags: ['relationship'],
  summary: 'Add a customer by phone number (SELLER and above)',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParamsSchema,
    body: { content: { 'application/json': { schema: addCustomerSchema } } },
  },
  responses: {
    200: {
      description: 'A live relationship with this number already existed',
      content: { 'application/json': { schema: supplierRelationshipViewSchema } },
    },
    201: {
      description: 'The new relationship',
      content: { 'application/json': { schema: supplierRelationshipViewSchema } },
    },
    400: { description: 'Invalid body', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role cannot add customers', content: errorContent },
    404: { description: 'Not found or not a member', content: errorContent },
    409: {
      description: 'Organization not active or conflicting gesture id',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/customers',
  tags: ['relationship'],
  summary: 'List the customers and counters of the organization, newest first (SELLER and above)',
  security: [{ bearerAuth: [] }],
  request: { params: organizationParamsSchema, query: listCustomersQuerySchema },
  responses: {
    200: {
      description: 'A page of supplier-side relationship views',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(supplierRelationshipViewSchema),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: { description: 'Invalid query', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'A DRIVER cannot list customers', content: errorContent },
    404: { description: 'Not found or not a member', content: errorContent },
  },
});
