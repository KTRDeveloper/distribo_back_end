import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { uuidV7Schema } from '../../shared/ids.js';
import {
  acceptOrderSchema,
  cancelOrderSchema,
  editOrderSchema,
  enterOrderSchema,
  placePurchaseSchema,
  refuseOrderSchema,
  setSupplierNoteSchema,
} from './order.schemas.js';

const errorContent = { 'application/json': { schema: errorResponseSchema } };

const orderLineViewSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  label_applied: z.string(),
  quantity: z.string(),
  delivered_quantity: z.string().nullable(),
  reference_price: z.number().int(),
  unit_price_applied: z.number().int(),
  amount: z.number().int(),
});

/** Customer-side order view (`projectOrderForCustomer`). */
const customerOrderViewSchema = z.object({
  id: z.string().uuid(),
  customer_relationship_id: z.string().uuid(),
  placed_by_party: z.enum(['CUSTOMER', 'SUPPLIER']),
  delivery_address_applied: z.string().nullable(),
  total_amount: z.number().int(),
  delivery_cost: z.number().int(),
  status: z.string(),
  delivered_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  desired_delivery_date: z.string().nullable(),
  cancelled_by_party: z.string().nullable(),
  cancelled_at: z.string().datetime().nullable(),
  cancellation_reason: z.string().nullable(),
  parent_order_id: z.string().uuid().nullable(),
  customer_note: z.string().nullable(),
  supplier_note: z.string().nullable(),
  lines: z.array(orderLineViewSchema),
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/purchases',
  tags: ['order'],
  summary: 'A manager orders from a supplier on behalf of the business (ORD-010)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: placePurchaseSchema } } },
  },
  responses: {
    201: {
      description: 'The PENDING order, customer view',
      content: { 'application/json': { schema: customerOrderViewSchema } },
    },
    400: {
      description: 'Invalid body, quantity below the minimum or supplier is the organization',
      content: errorContent,
    },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role may not order from a supplier', content: errorContent },
    404: { description: 'Not a member, unknown supplier or product', content: errorContent },
    409: {
      description: 'ORGANIZATION_NOT_ACTIVE, RELATIONSHIP_NOT_ACTIVE or conflicting gesture id',
      content: errorContent,
    },
  },
});

/** Supplier-side order view (`projectOrderForSupplier`); the price author goes to OWNER and MANAGER only. */
const supplierOrderViewSchema = customerOrderViewSchema.extend({
  entered_by_id: z.string().uuid(),
  delivered_by_id: z.string().uuid().nullable(),
  cancelled_by_id: z.string().uuid().nullable(),
  sync_issue: z.string().nullable(),
  lines: z.array(
    orderLineViewSchema.extend({
      price_set_by_id: z.string().uuid().nullable().optional(),
      price_set_at: z.string().datetime().nullable().optional(),
    })
  ),
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/orders/{orderId}/accept',
  tags: ['order'],
  summary: 'The supplier accepts a PENDING order, lowering prices if agreed (ORD-011)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema, orderId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: acceptOrderSchema } } },
  },
  responses: {
    200: {
      description: 'The CONFIRMED order, supplier view',
      content: { 'application/json': { schema: supplierOrderViewSchema } },
    },
    400: {
      description: 'VALIDATION_ERROR (body) or PRICE_INCREASE_REFUSED (a price above the current)',
      content: errorContent,
    },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role may not accept orders', content: errorContent },
    404: {
      description: 'Not a member, order outside the business, or a line of another order',
      content: errorContent,
    },
    409: {
      description: 'INVALID_TRANSITION (not PENDING) or conflicting gesture id',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/orders/{orderId}/refuse',
  tags: ['order'],
  summary: 'The supplier refuses a PENDING order with a reason (ORD-012)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema, orderId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: refuseOrderSchema } } },
  },
  responses: {
    200: {
      description: 'The CANCELLED order, supplier view',
      content: { 'application/json': { schema: supplierOrderViewSchema } },
    },
    400: { description: 'Invalid body (missing or too long reason)', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role may not refuse orders', content: errorContent },
    404: { description: 'Not a member, or order outside the business', content: errorContent },
    409: {
      description: 'INVALID_TRANSITION (not PENDING) or conflicting gesture id',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/orders/{orderId}/cancel',
  tags: ['order'],
  summary: 'The supplier cancels a PENDING or CONFIRMED order with a reason (ORD-016)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema, orderId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: cancelOrderSchema } } },
  },
  responses: {
    200: {
      description: 'The CANCELLED order, supplier view',
      content: { 'application/json': { schema: supplierOrderViewSchema } },
    },
    400: { description: 'Invalid body (missing or too long reason)', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role may not cancel orders', content: errorContent },
    404: { description: 'Not a member, or order outside the business', content: errorContent },
    409: {
      description: 'INVALID_TRANSITION (left, delivered or cancelled) or conflicting gesture id',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/orders',
  tags: ['order'],
  summary: 'A seller enters a CONFIRMED order for a customer (ORD-013)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: enterOrderSchema } } },
  },
  responses: {
    201: {
      description: 'The CONFIRMED order, supplier view',
      content: { 'application/json': { schema: supplierOrderViewSchema } },
    },
    400: { description: 'Invalid body (lines, prices, unknown fields)', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role may not enter orders', content: errorContent },
    404: {
      description: 'Not a member, relationship outside the business, or product not ACTIVE',
      content: errorContent,
    },
    409: {
      description:
        'USE_COUNTER_SALE, RELATIONSHIP_NOT_ACTIVE, ORGANIZATION_NOT_ACTIVE or conflicting gesture id',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/organizations/{organizationId}/orders/{orderId}',
  tags: ['order'],
  summary: 'A seller edits a CONFIRMED order the business entered (ORD-014)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema, orderId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: editOrderSchema } } },
  },
  responses: {
    200: {
      description: 'The edited order, supplier view',
      content: { 'application/json': { schema: supplierOrderViewSchema } },
    },
    400: {
      description: 'Invalid body (no field, lines, prices, unknown fields)',
      content: errorContent,
    },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role may not edit orders', content: errorContent },
    404: {
      description: 'Not a member, order outside the business, or product not ACTIVE',
      content: errorContent,
    },
    409: {
      description:
        'ORDER_FROZEN (not CONFIRMED or placed by the customer), ORGANIZATION_NOT_ACTIVE or conflicting gesture id',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/organizations/{organizationId}/orders/{orderId}/note',
  tags: ['order'],
  summary: 'A seller writes or clears the supplier note of an order, in any status (ORD-015)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema, orderId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: setSupplierNoteSchema } } },
  },
  responses: {
    200: {
      description: 'The order with its note, supplier view',
      content: { 'application/json': { schema: supplierOrderViewSchema } },
    },
    400: {
      description: 'Invalid body (note over 2000 characters, other keys)',
      content: errorContent,
    },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'The role may not write the note', content: errorContent },
    404: { description: 'Not a member or order outside the business', content: errorContent },
  },
});
