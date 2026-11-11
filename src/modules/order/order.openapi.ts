import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { uuidV7Schema } from '../../shared/ids.js';
import {
  acceptOrderSchema,
  cancelOrderAsCustomerSchema,
  cancelOrderSchema,
  editOrderSchema,
  enterOrderSchema,
  listCustomerOrdersQuerySchema,
  listOrdersQuerySchema,
  placeOrderSchema,
  placePurchaseSchema,
  refuseOrderSchema,
  replaceOrderSchema,
  setSupplierNoteSchema,
} from './order.schemas.js';

const errorContent = { 'application/json': { schema: errorResponseSchema } };

const orderLineViewSchema = z.object({
  id: z.string().uuid(),
  product_variant_id: z.string().uuid(),
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
  reception_mode: z.enum(['DELIVERY', 'PICKUP']).nullable(),
  total_amount: z.number().int(),
  delivery_cost: z.number().int(),
  status: z.string(),
  accepted_at: z.string().datetime().nullable(),
  delivered_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  desired_delivery_date: z.string().nullable(),
  cancelled_by_party: z.string().nullable(),
  cancelled_at: z.string().datetime().nullable(),
  cancellation_reason: z.string().nullable(),
  parent_order_id: z.string().uuid().nullable(),
  customer_note: z.string().nullable(),
  supplier_note: z.string().nullable(),
  supplier_name_applied: z.string().nullable().openapi({ readOnly: true }),
  customer_name_applied: z.string().nullable().openapi({ readOnly: true }),
  collected_applied: z.number().int().nullable().openapi({ readOnly: true }),
  balance_after_applied: z.number().int().nullable().openapi({ readOnly: true }),
  lines: z.array(orderLineViewSchema),
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/orders',
  tags: ['order'],
  summary: 'A person places an order with a supplier, for themselves as customer (ORD-009)',
  description: [
    'Rights and scope: any signed-in person orders for themselves. The customer is always the',
    'caller, never a body field. The relationship with the supplier is found, or created ACTIVE',
    'with credit limit 0 on the first order. To order for a business, use',
    '`POST /api/v1/organizations/{organizationId}/purchases` (ORD-010).',
    '',
    'Ids made by the phone: `id` is a UUIDv7 that is both the new order id and the gesture id.',
    'Each line `id` is a UUIDv7 that becomes the line id, unique within the body.',
    '',
    'Body: `supplier_organization_id`; 1 to 100 `lines`, each with `product_variant_id` and',
    '`quantity` (greater than 0, at most 3 decimals, a decimal string or a number); optional',
    '`delivery_address` (1 to 2000 characters), `reception_mode` (DELIVERY or PICKUP: a PICKUP',
    'stores no address and refuses a `delivery_address`; absent, the mode stays null),',
    '`desired_delivery_date` (YYYY-MM-DD) and',
    '`customer_note` (up to 2000 characters). Any other field is refused: prices, labels,',
    'amounts, totals, status, customer and relationship are never accepted.',
    '',
    'The server computes the rest from its own data: each line label, the reference price',
    '(negotiated price, else catalog price), the applied unit price (equal to it), the line',
    'amounts and the total. The optional `expected_total` (integer francs, 0 up) is the total the',
    'customer saw: when it differs from the server total the answer is 409 `TOTAL_CHANGED` with',
    '`details.total` and nothing is stored; it is never a price. `delivery_address_applied` is the body address, else the usual',
    'address of the relationship; `delivery_cost` is 0; the order is PENDING and placed by the',
    'CUSTOMER. Relationship, order, lines and the `order.placed` notification to the supplier',
    'OWNER, MANAGERs and SELLERs are one transaction: a refusal writes nothing.',
    '',
    'Repeat: the same `id` sent again by the same person changes nothing and returns the first',
    'response (status and body) with the header `Idempotent-Replay: true`, for 30 days. A refusal',
    'by the server (404, 409, quantity below the minimum) is replayed the same way, so a new',
    'attempt needs a new `id`. A body refused by validation reserves nothing. While the first',
    'request is still running, a repeat gets 409 `REQUEST_IN_PROGRESS`. A 5xx keeps nothing:',
    'the same `id` can be sent again.',
  ].join('\n'),
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: placeOrderSchema } } },
  },
  responses: {
    201: {
      description: 'The PENDING order, customer view, lines in the order sent',
      headers: {
        'Idempotent-Replay': {
          description: 'Present, with the value true, only on a repeat of an earlier gesture',
          schema: { type: 'string', enum: ['true'] },
        },
      },
      content: { 'application/json': { schema: customerOrderViewSchema } },
    },
    400: {
      description:
        'VALIDATION_ERROR: invalid body (unknown or missing field, malformed id, 0 or over 100 ' +
        'lines, duplicate line id, quantity 0, negative or with over 3 decimals, text too long, ' +
        'impossible date), or a quantity below the minimum order quantity of the product',
      content: errorContent,
    },
    401: { description: 'UNAUTHORIZED: missing or invalid token', content: errorContent },
    404: {
      description:
        'NOT_FOUND: unknown supplier, or a product variant that is not ACTIVE, is paused or ' +
        'belongs to another supplier',
      content: errorContent,
    },
    409: {
      description:
        'ORGANIZATION_NOT_ACTIVE (supplier suspended or closed), RELATIONSHIP_NOT_ACTIVE ' +
        '(relationship ended by either party), TOTAL_CHANGED (`expected_total` differs from the ' +
        'server total; `details.total` is the server total, nothing is stored) or ' +
        'REQUEST_IN_PROGRESS (same id still running)',
      content: errorContent,
    },
  },
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
      description:
        'ORGANIZATION_NOT_ACTIVE, RELATIONSHIP_NOT_ACTIVE, TOTAL_CHANGED (`expected_total` ' +
        'differs from the server total, `details.total`) or conflicting gesture id',
      content: errorContent,
    },
  },
});

const customerCancelResponses = {
  200: {
    description: 'The CANCELLED order, customer view',
    content: { 'application/json': { schema: customerOrderViewSchema } },
  },
  400: { description: 'Invalid body (reason too long) or order id', content: errorContent },
  401: { description: 'Missing or invalid token', content: errorContent },
  403: { description: 'The role may not cancel purchases', content: errorContent },
  404: { description: 'Not a member, or order outside the customer', content: errorContent },
  409: {
    description: 'INVALID_TRANSITION (left, delivered or cancelled) or conflicting gesture id',
    content: errorContent,
  },
};

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/orders/{orderId}/cancel',
  tags: ['order'],
  summary: 'The customer cancels a PENDING or CONFIRMED order before departure (ORD-017)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ orderId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: cancelOrderAsCustomerSchema } } },
  },
  responses: customerCancelResponses,
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/purchases/{orderId}/cancel',
  tags: ['order'],
  summary: 'A manager cancels an order of the business before departure (ORD-017)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema, orderId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: cancelOrderAsCustomerSchema } } },
  },
  responses: customerCancelResponses,
});

const replaceOrderResponses = {
  201: {
    description: 'The new PENDING order, customer view, and the id of the replaced order',
    headers: {
      'Idempotent-Replay': {
        description: 'Present, with the value true, only on a repeat of an earlier gesture',
        schema: { type: 'string' as const, enum: ['true'] },
      },
    },
    content: {
      'application/json': {
        schema: z.object({
          order: customerOrderViewSchema,
          replaced_order_id: z.string().uuid(),
        }),
      },
    },
  },
  400: {
    description: 'VALIDATION_ERROR: invalid body (unknown field, missing expected_total) or id',
    content: errorContent,
  },
  401: { description: 'Missing or invalid token', content: errorContent },
  404: {
    description: 'NOT_FOUND: order of another customer, already replaced, or unknown product',
    content: errorContent,
  },
  409: {
    description:
      'INVALID_TRANSITION (not PENDING), TOTAL_CHANGED (`details.total` is the server total), ' +
      'ORGANIZATION_NOT_ACTIVE, RELATIONSHIP_NOT_ACTIVE or conflicting gesture id',
    content: errorContent,
  },
};

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/orders/{orderId}/replace',
  tags: ['order'],
  summary: 'The customer changes a PENDING order (ORD-039)',
  description: [
    'The customer replaces one of their own PENDING orders by a new version, so the supplier gets',
    'the right order without a cancellation and a new order. Body: the new order `id` (a UUIDv7,',
    'also the gesture id), 1 to 100 `lines`, `expected_total` (required, integer francs: the total',
    'the customer saw) and the optional `delivery_address`, `reception_mode`,',
    '`desired_delivery_date` and `customer_note` of placing an order. The supplier is the one of',
    'the replaced order; status, prices, labels and totals are never accepted.',
    '',
    "The new order is PENDING at today's prices, placed by the CUSTOMER on the same relationship,",
    'and keeps only the supplier note. The old order becomes CANCELLED by the CUSTOMER and',
    'disappears from lists and detail (404). The notifications about it now open the new order and',
    'the supplier OWNER, MANAGERs and SELLERs get one `order.replaced`. All in one transaction.',
    '',
    'Repeat: the same `id` returns the first response with the header `Idempotent-Replay: true`.',
  ].join('\n'),
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ orderId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: replaceOrderSchema } } },
  },
  responses: replaceOrderResponses,
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/purchases/{orderId}/replace',
  tags: ['order'],
  summary: 'A manager changes a pending purchase of the business (ORD-044)',
  description:
    'Same body, rules and answer as `POST /api/v1/orders/{orderId}/replace` (ORD-039). The ' +
    'caller needs the ability to order from a supplier (OWNER or MANAGER of the business); the ' +
    "purchase is found through the business's own relationship, so any other id is a 404.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema, orderId: uuidV7Schema }),
    body: { content: { 'application/json': { schema: replaceOrderSchema } } },
  },
  responses: {
    ...replaceOrderResponses,
    403: {
      description: 'FORBIDDEN: the role may not order from a supplier',
      content: errorContent,
    },
  },
});

/** Supplier-side order view (`projectOrderForSupplier`); the price author goes to OWNER and MANAGER only. */
export const supplierOrderViewSchema = customerOrderViewSchema.extend({
  // Absent for a DRIVER: the customer's debt is not theirs to see.
  balance_after_applied: z.number().int().nullable().optional().openapi({ readOnly: true }),
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

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/orders',
  tags: ['order'],
  summary: 'A seller lists the orders of the business, newest first, with lines (ORD-019)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema }),
    query: listOrdersQuerySchema,
  },
  responses: {
    200: {
      description: 'A page of orders, supplier view, and the cursor of the next page or null',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(supplierOrderViewSchema),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: {
      description: 'Invalid query (unknown field, status, id or cursor)',
      content: errorContent,
    },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'A DRIVER may not list orders', content: errorContent },
    404: { description: 'Not a member of the organization', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/orders/{orderId}',
  tags: ['order'],
  summary: 'A seller opens one order of the business, with lines (ORD-020)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema, orderId: uuidV7Schema }),
  },
  responses: {
    200: {
      description: 'The order, supplier view',
      content: { 'application/json': { schema: supplierOrderViewSchema } },
    },
    400: { description: 'The order id is not a UUID', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'A DRIVER may not open orders', content: errorContent },
    404: { description: 'Not a member or order outside the business', content: errorContent },
  },
});

const customerOrderPageResponses = (forbidden: string) => ({
  200: {
    description: 'A page of orders, customer view, and the cursor of the next page or null',
    content: {
      'application/json': {
        schema: z.object({
          items: z.array(customerOrderViewSchema),
          next_cursor: z.string().nullable(),
        }),
      },
    },
  },
  400: {
    description: 'Invalid query (unknown field, status, id or cursor)',
    content: errorContent,
  },
  401: { description: 'Missing or invalid token', content: errorContent },
  ...(forbidden ? { 403: { description: forbidden, content: errorContent } } : {}),
  ...(forbidden
    ? { 404: { description: 'Not a member of the organization', content: errorContent } }
    : {}),
});

const customerOrderResponses = (forbidden: string) => ({
  200: {
    description: 'The order, customer view',
    content: { 'application/json': { schema: customerOrderViewSchema } },
  },
  400: { description: 'The order id is not a UUID', content: errorContent },
  401: { description: 'Missing or invalid token', content: errorContent },
  ...(forbidden ? { 403: { description: forbidden, content: errorContent } } : {}),
  404: { description: 'Order not found for the caller as customer', content: errorContent },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/orders',
  tags: ['order'],
  summary: 'A person lists their own orders, newest first, with lines (ORD-021)',
  security: [{ bearerAuth: [] }],
  request: { query: listCustomerOrdersQuerySchema },
  responses: customerOrderPageResponses(''),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/orders/{orderId}',
  tags: ['order'],
  summary: 'A person opens one of their own orders (ORD-021)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ orderId: uuidV7Schema }) },
  responses: customerOrderResponses(''),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/purchases',
  tags: ['order'],
  summary: 'A manager lists the purchases of the business, newest first (ORD-021)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema }),
    query: listCustomerOrdersQuerySchema,
  },
  responses: customerOrderPageResponses('The role is below MANAGER'),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/purchases/{orderId}',
  tags: ['order'],
  summary: 'A manager opens one purchase of the business (ORD-021)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ organizationId: uuidV7Schema, orderId: uuidV7Schema }) },
  responses: customerOrderResponses('The role is below MANAGER'),
});
