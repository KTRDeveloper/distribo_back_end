import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { uuidV7Schema } from '../../shared/ids.js';
import { placePurchaseSchema } from './order.schemas.js';

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
