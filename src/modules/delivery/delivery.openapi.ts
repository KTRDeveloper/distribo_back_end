import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { uuidV7Schema } from '../../shared/ids.js';
import {
  assignDeliverySchema,
  deliverSchema,
  failDeliverySchema,
  departSchema,
  mineQuerySchema,
  toDeliverQuerySchema,
} from './delivery.schemas.js';

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

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/orders/{orderId}/assign',
  tags: ['delivery'],
  summary: 'A manager assigns a CONFIRMED order to a driver (DLV-004)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema, orderId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: assignDeliverySchema } } },
  },
  responses: {
    201: {
      description: 'The delivery, assigned or reassigned before departure',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string().uuid(),
            order_id: z.string().uuid(),
            assigned_to_id: z.string().uuid(),
            departed_at: z.string().datetime().nullable(),
          }),
        },
      },
    },
    400: {
      description: 'VALIDATION_ERROR (body, or the order has no delivery address)',
      content: errorContent,
    },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role may not assign deliveries', content: errorContent },
    404: {
      description: 'Not a member, order outside the business, or driver not an ACTIVE collaborator',
      content: errorContent,
    },
    409: {
      description:
        'DELIVERY_IN_PROGRESS (already departed), INVALID_TRANSITION (not CONFIRMED) or conflicting gesture id',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/orders/{orderId}/depart',
  tags: ['delivery'],
  summary: 'A driver departs with a CONFIRMED order (DLV-005)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema, orderId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: departSchema } } },
  },
  responses: {
    200: {
      description: 'The departed delivery and the new order status',
      content: {
        'application/json': {
          schema: z.object({
            delivery: z.object({
              id: z.string().uuid(),
              order_id: z.string().uuid(),
              assigned_to_id: z.string().uuid(),
              departed_at: z.string().datetime().nullable(),
            }),
            order_status: z.literal('IN_DELIVERY'),
          }),
        },
      },
    },
    400: {
      description: 'VALIDATION_ERROR (body, or the order has no delivery address)',
      content: errorContent,
    },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role may not depart with an order', content: errorContent },
    404: { description: 'Not a member, or order outside the business', content: errorContent },
    409: {
      description:
        'ASSIGNED_TO_OTHER, DELIVERY_IN_PROGRESS (already on the road), INVALID_TRANSITION (not CONFIRMED) or conflicting gesture id',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/deliveries/{deliveryId}/fail',
  tags: ['delivery'],
  summary: 'A driver reports a delivery as failed; the order goes back to CONFIRMED (DLV-006)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema, deliveryId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: failDeliverySchema } } },
  },
  responses: {
    200: {
      description: 'The failed delivery and the new order status',
      content: {
        'application/json': {
          schema: z.object({
            delivery: z.object({
              id: z.string().uuid(),
              order_id: z.string().uuid(),
              assigned_to_id: z.string().uuid(),
              departed_at: z.string().datetime().nullable(),
              failed_at: z.string().datetime().nullable(),
              failure_reason: z.string().nullable(),
            }),
            order_status: z.literal('CONFIRMED'),
          }),
        },
      },
    },
    400: { description: 'VALIDATION_ERROR (body or path)', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role may not report a failed delivery', content: errorContent },
    404: {
      description: 'Not a member, delivery outside the business, or assigned to another driver',
      content: errorContent,
    },
    409: {
      description:
        'INVALID_TRANSITION (not departed, already arrived or failed) or conflicting gesture id',
      content: errorContent,
    },
  },
});

const deliveredEntrySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['SALE', 'PAYMENT']),
  amount: z.number().int(),
  mode: z.enum(['CASH', 'MOBILE_MONEY']).nullable(),
  order_id: z.string().uuid().nullable(),
  occurred_at: z.string().datetime(),
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/orders/{orderId}/deliver',
  tags: ['delivery'],
  summary: '"Commande livrée": deliver a whole order and record the sale and the payment (DLV-007)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema, orderId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: deliverSchema } } },
  },
  responses: {
    200: {
      description:
        'The delivered order, the SALE of its total and the PAYMENT of the collected amount (null when nothing was collected)',
      content: {
        'application/json': {
          schema: z.object({
            order: z.object({
              id: z.string().uuid(),
              status: z.literal('DELIVERED'),
              total_amount: z.number().int(),
              delivered_at: z.string().datetime().nullable(),
            }),
            sale: deliveredEntrySchema,
            payment: deliveredEntrySchema.nullable(),
          }),
        },
      },
    },
    400: {
      description: 'VALIDATION_ERROR (body or path, or a collection above 0 without mode)',
      content: errorContent,
    },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role may not deliver orders', content: errorContent },
    404: {
      description:
        'Not a member, order outside the business, or a DRIVER on an order of another driver',
      content: errorContent,
    },
    409: {
      description:
        'INVALID_TRANSITION (status does not fit the role), CREDIT_INSUFFICIENT (details.min_collect) or conflicting gesture id',
      content: errorContent,
    },
  },
});
