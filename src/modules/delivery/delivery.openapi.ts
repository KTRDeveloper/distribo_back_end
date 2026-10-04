import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { uuidV7Schema } from '../../shared/ids.js';
import { mineQuerySchema, toDeliverQuerySchema } from './delivery.schemas.js';

const errorContent = { 'application/json': { schema: errorResponseSchema } };

const toDeliverItemSchema = z.object({
  order_id: z.string().uuid(),
  delivery_address: z.string().nullable(),
  desired_delivery_date: z.string().nullable(),
  customer_note: z.string().nullable(),
  total_amount: z.number().int(),
  lines: z.array(
    z.object({
      label: z.string(),
      quantity: z.string(),
      unit_price_applied: z.number().int(),
      amount: z.number().int(),
    })
  ),
  customer: z.object({
    id: z.string().uuid(),
    customer_name: z.string().nullable(),
    available_credit: z.number().int().nullable(),
  }),
});

const myDeliveryItemSchema = toDeliverItemSchema.extend({
  delivery_id: z.string().uuid(),
  departed_at: z.string().datetime().nullable(),
  arrived_at: z.string().datetime().nullable(),
  failed_at: z.string().datetime().nullable(),
  failure_reason: z.string().nullable(),
});

const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.string().nullable() });

const commonErrors = {
  400: { description: 'Invalid query or cursor', content: errorContent },
  401: { description: 'Missing or invalid token', content: errorContent },
  404: { description: 'Not a member of the organization', content: errorContent },
};

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/deliveries/to-deliver',
  tags: ['delivery'],
  summary: 'A driver lists the CONFIRMED orders with an address to deliver (DLV-003)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema }),
    query: toDeliverQuerySchema,
  },
  responses: {
    200: {
      description: 'A page of orders, newest first; the customer shows the available credit only',
      content: { 'application/json': { schema: pageSchema(toDeliverItemSchema) } },
    },
    ...commonErrors,
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/deliveries/mine',
  tags: ['delivery'],
  summary: "A driver lists the caller's own deliveries, by status (DLV-003)",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema }),
    query: mineQuerySchema,
  },
  responses: {
    200: {
      description: "A page of the caller's deliveries with their order fields",
      content: { 'application/json': { schema: pageSchema(myDeliveryItemSchema) } },
    },
    ...commonErrors,
  },
});
