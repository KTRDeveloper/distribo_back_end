import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { uuidV7Schema } from '../../shared/ids.js';
import {
  creditNoteSchema,
  ledgerQuerySchema,
  openingBalanceSchema,
  paymentParamSchema,
  recordPaymentSchema,
  returnSchema,
  reverseEntrySchema,
  reverseParamSchema,
} from './finance.schemas.js';

const organizationParamsSchema = z.object({ organizationId: uuidV7Schema });
const errorContent = { 'application/json': { schema: errorResponseSchema } };

const kindSchema = z.enum(['SALE', 'PAYMENT', 'REFUND', 'CREDIT_NOTE', 'OPENING_BALANCE']);
const modeSchema = z.enum(['CASH', 'MOBILE_MONEY']).nullable();

/** The entry a gesture stores, with the customer's balance after it. */
const gestureEntrySchema = z.object({
  id: z.string().uuid(),
  kind: kindSchema,
  amount: z.number().int(),
  mode: modeSchema,
  occurred_at: z.string().datetime(),
  balance: z.number().int(),
});

/** One ledger item; `transaction_reference` is never listed, `recorded_by_id` for the supplier's OWNER and MANAGER only. */
const ledgerItemSchema = z.object({
  id: z.string().uuid(),
  kind: kindSchema,
  amount: z.number().int(),
  balance_effect: z.number().int(),
  mode: modeSchema,
  order_id: z.string().uuid().nullable(),
  reverses_entry_id: z.string().uuid().nullable(),
  note: z.string().nullable(),
  occurred_at: z.string().datetime(),
  recorded_by_id: z.string().uuid().optional(),
});

const ledgerPageSchema = z.object({
  balance: z.number().int(),
  items: z.array(ledgerItemSchema),
  next_cursor: z.string().nullable(),
});

const gestureErrors = {
  400: { description: 'Invalid path or body', content: errorContent },
  401: { description: 'Missing or invalid token', content: errorContent },
  403: { description: 'The role cannot do this', content: errorContent },
  404: { description: 'Not found or not a member', content: errorContent },
  409: {
    description: 'Business state forbids it or conflicting repeat of the gesture id',
    content: errorContent,
  },
};

/** Registers one `POST .../customers/{relationshipId}/<segment>` gesture that stores one entry. */
function registerCustomerGesture(
  segment: string,
  summary: string,
  body: z.ZodTypeAny,
  response: z.ZodTypeAny
): void {
  openApiRegistry.registerPath({
    method: 'post',
    path: `/api/v1/organizations/{organizationId}/customers/{relationshipId}/${segment}`,
    tags: ['finance'],
    summary,
    security: [{ bearerAuth: [] }],
    request: {
      params: organizationParamsSchema.merge(paymentParamSchema),
      body: { content: { 'application/json': { schema: body } } },
    },
    responses: {
      201: {
        description: 'The stored entry',
        content: { 'application/json': { schema: response } },
      },
      ...gestureErrors,
    },
  });
}

registerCustomerGesture(
  'payments',
  "Record a customer's payment (SELLER and above)",
  recordPaymentSchema,
  gestureEntrySchema
);
registerCustomerGesture(
  'refunds',
  'Give money back to a customer (MANAGER and above)',
  recordPaymentSchema,
  gestureEntrySchema
);
registerCustomerGesture(
  'credit-notes',
  'Grant a credit note to a customer (MANAGER and above)',
  creditNoteSchema,
  gestureEntrySchema
);
registerCustomerGesture(
  'opening-balances',
  "Record a customer's opening balance from a paper notebook (MANAGER and above)",
  openingBalanceSchema,
  gestureEntrySchema
);
registerCustomerGesture(
  'returns',
  'Record a refunded return: a credit note and a refund in one transaction (MANAGER and above)',
  returnSchema,
  z.object({ credit_note: gestureEntrySchema, refund: gestureEntrySchema })
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/ledger-entries/{entryId}/reverse',
  tags: ['finance'],
  summary: 'Reverse a ledger entry by adding its mirror (MANAGER and above)',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParamsSchema.merge(reverseParamSchema),
    body: { content: { 'application/json': { schema: reverseEntrySchema } } },
  },
  responses: {
    201: {
      description: 'The mirror entry',
      content: { 'application/json': { schema: gestureEntrySchema } },
    },
    ...gestureErrors,
  },
});

const readErrors = {
  400: { description: 'Invalid path or query', content: errorContent },
  401: { description: 'Missing or invalid token', content: errorContent },
  404: { description: 'Not found, not a party or not a member', content: errorContent },
};

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/customers/{relationshipId}/ledger',
  tags: ['finance'],
  summary: "Read a customer's ledger, newest first, with the balance (SELLER and above)",
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParamsSchema.merge(paymentParamSchema),
    query: ledgerQuerySchema,
  },
  responses: {
    200: {
      description: 'A page of entries; recorded_by_id only for OWNER and MANAGER',
      content: { 'application/json': { schema: ledgerPageSchema } },
    },
    403: { description: 'A DRIVER cannot read the ledger', content: errorContent },
    ...readErrors,
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/suppliers/{relationshipId}/ledger',
  tags: ['finance'],
  summary: 'Read my own account with a supplier, newest first, with the balance',
  security: [{ bearerAuth: [] }],
  request: { params: paymentParamSchema, query: ledgerQuerySchema },
  responses: {
    200: {
      description: 'A page of entries, without recorded_by_id',
      content: { 'application/json': { schema: ledgerPageSchema } },
    },
    ...readErrors,
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/suppliers/{relationshipId}/ledger',
  tags: ['finance'],
  summary: "Read an organization's account with a supplier, newest first (MANAGER and above)",
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParamsSchema.merge(paymentParamSchema),
    query: ledgerQuerySchema,
  },
  responses: {
    200: {
      description: 'A page of entries, without recorded_by_id',
      content: { 'application/json': { schema: ledgerPageSchema } },
    },
    403: { description: 'Below MANAGER', content: errorContent },
    ...readErrors,
  },
});
