import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { uuidV7Schema } from '../../shared/ids.js';
import {
  acceptInvitationSchema,
  addCounterSchema,
  addCustomerSchema,
  creditLimitChangesQuerySchema,
  customerParamsSchema,
  editCustomerSchema,
  editSupplierSchema,
  endReopenSchema,
  inviteSupplierSchema,
  invitationParamsSchema,
  listCustomersQuerySchema,
  listInvitationsQuerySchema,
  listSuppliersQuerySchema,
  setCreditLimitSchema,
} from './relationship.schemas.js';

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

/** Customer-side view: `supplier_label` in, `customer_label` and `supplier_notes` never (CM-19). */
const customerRelationshipViewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['PENDING', 'ACTIVE', 'ENDED']),
  supplier: z
    .union([
      z.object({ kind: z.literal('PERSON'), person: publicPersonSchema }),
      z.object({
        kind: z.literal('ORGANIZATION'),
        name: z.string(),
        description: z.string().nullable(),
      }),
    ])
    .nullable(),
  supplier_label: z.string().nullable(),
  delivery_address: z.string().nullable(),
  credit_limit: z.number().int().nullable(),
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

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/customers/{relationshipId}',
  tags: ['relationship'],
  summary: 'Open one customer of the organization, supplier view (SELLER and above)',
  security: [{ bearerAuth: [] }],
  request: { params: organizationParamsSchema.merge(customerParamsSchema) },
  responses: {
    200: {
      description: 'The supplier-side relationship view',
      content: { 'application/json': { schema: supplierRelationshipViewSchema } },
    },
    400: { description: 'Malformed relationship id', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'A DRIVER cannot open customers', content: errorContent },
    404: {
      description: 'Not found, deleted, of another business, or not a member',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/organizations/{organizationId}/customers/{relationshipId}',
  tags: ['relationship'],
  summary: 'Edit the label, address and notes of a customer (SELLER and above)',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParamsSchema.merge(customerParamsSchema),
    body: { content: { 'application/json': { schema: editCustomerSchema } } },
  },
  responses: {
    200: {
      description: 'The updated supplier-side relationship view',
      content: { 'application/json': { schema: supplierRelationshipViewSchema } },
    },
    400: { description: 'Invalid body or relationship id', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role cannot update a field sent', content: errorContent },
    404: {
      description: 'Not found, deleted, of another business, or not a member',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/counters',
  tags: ['relationship'],
  summary: 'Add a named counter to the organization (MANAGER and above)',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParamsSchema,
    body: { content: { 'application/json': { schema: addCounterSchema } } },
  },
  responses: {
    201: {
      description: 'The new counter: no customer, credit limit 0',
      content: { 'application/json': { schema: supplierRelationshipViewSchema } },
    },
    400: { description: 'Invalid body', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role cannot add counters', content: errorContent },
    404: { description: 'Not found or not a member', content: errorContent },
    409: {
      description: 'COUNTER_LABEL_TAKEN, organization not active or conflicting gesture id',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/api/v1/organizations/{organizationId}/customers/{relationshipId}/credit-limit',
  tags: ['relationship'],
  summary: 'Set the credit limit of a customer (OWNER, or MANAGER online)',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParamsSchema.merge(customerParamsSchema),
    body: { content: { 'application/json': { schema: setCreditLimitSchema } } },
  },
  responses: {
    200: {
      description: 'The updated supplier-side relationship view',
      content: { 'application/json': { schema: supplierRelationshipViewSchema } },
    },
    400: { description: 'Invalid body or relationship id', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: {
      description: "FORBIDDEN for the role, or OWN_RECORD on the caller's own customer record",
      content: errorContent,
    },
    404: {
      description: 'Not found, deleted, of another business, or not a member',
      content: errorContent,
    },
    409: {
      description: 'COUNTER_NO_CREDIT, RELATIONSHIP_NOT_ACTIVE or conflicting gesture id',
      content: errorContent,
    },
  },
});

const creditLimitChangeViewSchema = z.object({
  previous_limit: z.number().int().nullable(),
  new_limit: z.number().int().nullable(),
  set_by_id: z.string().uuid(),
  set_at: z.string().datetime(),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/customers/{relationshipId}/credit-limit-changes',
  tags: ['relationship'],
  summary: 'Read the credit limit history of a customer, newest first (OWNER and MANAGER)',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParamsSchema.merge(customerParamsSchema),
    query: creditLimitChangesQuerySchema,
  },
  responses: {
    200: {
      description: 'A page of journal entries; an empty limit means no ceiling',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(creditLimitChangeViewSchema),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: { description: 'Invalid query or relationship id', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'A SELLER or DRIVER cannot read the history', content: errorContent },
    404: {
      description: 'Not found, deleted, of another business, or not a member',
      content: errorContent,
    },
  },
});

for (const [action, summary, conflicts] of [
  [
    'end',
    'End a relationship as supplier (MANAGER and above, online)',
    'COUNTER_CANNOT_END, RELATIONSHIP_NOT_ACTIVE or conflicting gesture id',
  ],
  [
    'reopen',
    'Reopen a relationship the supplier ended (MANAGER and above, online)',
    'ENDED_BY_OTHER_PARTY, RELATIONSHIP_NOT_ENDED or conflicting gesture id',
  ],
] as const) {
  openApiRegistry.registerPath({
    method: 'post',
    path: `/api/v1/organizations/{organizationId}/customers/{relationshipId}/${action}`,
    tags: ['relationship'],
    summary,
    security: [{ bearerAuth: [] }],
    request: {
      params: organizationParamsSchema.merge(customerParamsSchema),
      body: { content: { 'application/json': { schema: endReopenSchema } } },
    },
    responses: {
      200: {
        description: 'The updated supplier-side relationship view',
        content: { 'application/json': { schema: supplierRelationshipViewSchema } },
      },
      400: { description: 'Invalid body or relationship id', content: errorContent },
      401: { description: 'Missing or invalid token', content: errorContent },
      403: { description: 'A SELLER or DRIVER cannot do this', content: errorContent },
      404: {
        description: 'Not found, deleted, of another business, or not a member',
        content: errorContent,
      },
      409: { description: conflicts, content: errorContent },
    },
  });
}

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/suppliers',
  tags: ['relationship'],
  summary: 'List my suppliers as a customer, newest first (any signed-in person)',
  security: [{ bearerAuth: [] }],
  request: { query: listSuppliersQuerySchema },
  responses: {
    200: {
      description: 'A page of customer-side relationship views',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(customerRelationshipViewSchema),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: { description: 'Invalid query', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/suppliers/{relationshipId}',
  tags: ['relationship'],
  summary: 'Name a supplier: write my supplier_label (customer only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: customerParamsSchema,
    body: { content: { 'application/json': { schema: editSupplierSchema } } },
  },
  responses: {
    200: {
      description: 'The updated customer-side relationship view',
      content: { 'application/json': { schema: customerRelationshipViewSchema } },
    },
    400: { description: 'Invalid body or relationship id', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    404: {
      description: 'Not found, deleted, or a relationship of another person',
      content: errorContent,
    },
  },
});

for (const [action, summary, conflicts] of [
  [
    'end',
    'Leave a supplier as customer (ACTIVE becomes ENDED by the customer)',
    'RELATIONSHIP_NOT_ACTIVE or conflicting gesture id',
  ],
  [
    'reopen',
    'Come back to a supplier the customer left',
    'ENDED_BY_OTHER_PARTY, RELATIONSHIP_NOT_ENDED or conflicting gesture id',
  ],
] as const) {
  openApiRegistry.registerPath({
    method: 'post',
    path: `/api/v1/suppliers/{relationshipId}/${action}`,
    tags: ['relationship'],
    summary,
    security: [{ bearerAuth: [] }],
    request: {
      params: customerParamsSchema,
      body: { content: { 'application/json': { schema: endReopenSchema } } },
    },
    responses: {
      200: {
        description: 'The updated customer-side relationship view',
        content: { 'application/json': { schema: customerRelationshipViewSchema } },
      },
      400: { description: 'Invalid body or relationship id', content: errorContent },
      401: { description: 'Missing or invalid token', content: errorContent },
      404: {
        description: 'Not found, deleted, or a relationship of another person',
        content: errorContent,
      },
      409: { description: conflicts, content: errorContent },
    },
  });
}

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/suppliers',
  tags: ['relationship'],
  summary: 'List the suppliers of the organization, newest first (MANAGER and above)',
  security: [{ bearerAuth: [] }],
  request: { params: organizationParamsSchema, query: listSuppliersQuerySchema },
  responses: {
    200: {
      description: 'A page of customer-side relationship views',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(customerRelationshipViewSchema),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: { description: 'Invalid query', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role is below MANAGER', content: errorContent },
    404: { description: 'Not found or not a member', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/organizations/{organizationId}/suppliers/{relationshipId}',
  tags: ['relationship'],
  summary: 'Name a supplier of the organization: write supplier_label (MANAGER and above)',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParamsSchema.merge(customerParamsSchema),
    body: { content: { 'application/json': { schema: editSupplierSchema } } },
  },
  responses: {
    200: {
      description: 'The updated customer-side relationship view',
      content: { 'application/json': { schema: customerRelationshipViewSchema } },
    },
    400: { description: 'Invalid body or relationship id', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role is below MANAGER', content: errorContent },
    404: {
      description: 'Not found, deleted, of another business, or not a member',
      content: errorContent,
    },
  },
});

for (const [action, summary, conflicts] of [
  [
    'end',
    'Leave a supplier for the organization (ACTIVE becomes ENDED by the customer; MANAGER and above)',
    'RELATIONSHIP_NOT_ACTIVE or conflicting gesture id',
  ],
  [
    'reopen',
    'Come back to a supplier the organization left (MANAGER and above)',
    'ENDED_BY_OTHER_PARTY, RELATIONSHIP_NOT_ENDED or conflicting gesture id',
  ],
] as const) {
  openApiRegistry.registerPath({
    method: 'post',
    path: `/api/v1/organizations/{organizationId}/suppliers/{relationshipId}/${action}`,
    tags: ['relationship'],
    summary,
    security: [{ bearerAuth: [] }],
    request: {
      params: organizationParamsSchema.merge(customerParamsSchema),
      body: { content: { 'application/json': { schema: endReopenSchema } } },
    },
    responses: {
      200: {
        description: 'The updated customer-side relationship view',
        content: { 'application/json': { schema: customerRelationshipViewSchema } },
      },
      400: { description: 'Invalid body or relationship id', content: errorContent },
      401: { description: 'Missing or invalid token', content: errorContent },
      403: { description: 'The role cannot end or reopen', content: errorContent },
      404: {
        description: 'Not found, of another business, or not a member',
        content: errorContent,
      },
      409: { description: conflicts, content: errorContent },
    },
  });
}

for (const [path, params, summary, forbidden] of [
  [
    '/api/v1/suppliers/invitations',
    undefined,
    'Invite a supplier by phone number as a customer person (PENDING, credit limit 0)',
    undefined,
  ],
  [
    '/api/v1/organizations/{organizationId}/suppliers/invitations',
    organizationParamsSchema,
    'Invite a supplier by phone number for the organization (MANAGER and above)',
    'The role is below MANAGER',
  ],
] as const) {
  openApiRegistry.registerPath({
    method: 'post',
    path,
    tags: ['relationship'],
    summary,
    security: [{ bearerAuth: [] }],
    request: {
      ...(params ? { params } : {}),
      body: { content: { 'application/json': { schema: inviteSupplierSchema } } },
    },
    responses: {
      201: {
        description: 'The PENDING customer-side relationship view',
        content: { 'application/json': { schema: customerRelationshipViewSchema } },
      },
      400: { description: 'Invalid body, landline or empty label', content: errorContent },
      401: { description: 'Missing or invalid token', content: errorContent },
      ...(forbidden ? { 403: { description: forbidden, content: errorContent } } : {}),
      ...(params ? { 404: { description: 'Not a member', content: errorContent } } : {}),
      409: {
        description: 'NUMBER_IS_ORGANIZATION, RELATIONSHIP_EXISTS or conflicting gesture id',
        content: errorContent,
      },
      429: { description: 'RATE_LIMITED: 60 lookups per hour reached', content: errorContent },
    },
  });
}

const supplierInvitationViewSchema = z.object({
  id: z.string().uuid(),
  supplier_label: z.string().nullable(),
  customer: z
    .union([
      z.object({ kind: z.literal('PERSON'), person: publicPersonSchema }),
      z.object({ kind: z.literal('ORGANIZATION'), name: z.string() }),
    ])
    .nullable(),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/supplier-invitations',
  tags: ['relationship'],
  summary: 'List the PENDING invitations addressed to the caller as supplier',
  security: [{ bearerAuth: [] }],
  request: { query: listInvitationsQuerySchema },
  responses: {
    200: {
      description: 'A page of invitations and the next cursor, or null on the last page',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(supplierInvitationViewSchema),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: { description: 'Invalid query or cursor', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/supplier-invitations/{invitationId}/accept',
  tags: ['relationship'],
  summary: 'Accept an invitation for an organization the caller manages (MANAGER and above)',
  security: [{ bearerAuth: [] }],
  request: {
    params: invitationParamsSchema,
    body: { content: { 'application/json': { schema: acceptInvitationSchema } } },
  },
  responses: {
    200: {
      description:
        'The relationship is ACTIVE for the organization, or merged: true when the organization already had a live relationship with that customer',
      content: {
        'application/json': {
          schema: z.object({
            merged: z.boolean(),
            relationship: supplierRelationshipViewSchema.optional(),
          }),
        },
      },
    },
    400: { description: 'Invalid body or invitation id', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The caller only sells for the organization', content: errorContent },
    404: {
      description: 'Invitation addressed to someone else, or organization the caller is not in',
      content: errorContent,
    },
    409: {
      description: 'ORGANIZATION_NOT_ACTIVE or conflicting gesture id',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/supplier-invitations/{invitationId}/decline',
  tags: ['relationship'],
  summary: 'Decline an invitation: it is deleted and the customer is notified',
  security: [{ bearerAuth: [] }],
  request: {
    params: invitationParamsSchema,
    body: { content: { 'application/json': { schema: endReopenSchema } } },
  },
  responses: {
    200: {
      description: 'The invitation is deleted',
      content: { 'application/json': { schema: z.object({ declined: z.literal(true) }) } },
    },
    400: { description: 'Invalid body or invitation id', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    404: { description: 'Invitation addressed to someone else or absent', content: errorContent },
    409: { description: 'Conflicting gesture id', content: errorContent },
  },
});
