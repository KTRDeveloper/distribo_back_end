import { Router } from 'express';
import {
  createPaymentBodySchema, paymentStatusParamsSchema, paymentStatusQuerySchema, shopParamsSchema,
} from './billing.schemas.js';
import { lookupShop } from './billing.service.js';
import { createPayment, readPayment } from './payment.service.js';

/** Billing routes; the payment site asks for no sign-in, so the shop lookup is public. */
export const billingRoutes = Router();

billingRoutes.get('/shops/:code', (req, res, next) => {
  void (async () => {
    const { code } = shopParamsSchema.parse(req.params);
    const shop = await lookupShop(code, req.ip ?? 'unknown');
    res.status(200).json({ name: shop.name });
  })().catch(next);
});

/** Public: the payer-held UUID is the only key; reads are limited before any lookup. */
billingRoutes.get('/payments/:id', (req, res, next) => {
  void (async () => {
    const { id } = paymentStatusParamsSchema.parse(req.params);
    paymentStatusQuerySchema.parse(req.query);
    const payment = await readPayment(id, req.ip ?? 'unknown');
    res.status(200).json(payment);
  })().catch(next);
});

/** A payer starts a payment for a business; public, the server computes the amount (BIL-009). */
billingRoutes.post('/payments', (req, res, next) => {
  void (async () => {
    const body = createPaymentBodySchema.parse(req.body);
    const payment = await createPayment(
      {
        id: body.id,
        code: body.code,
        plan: body.plan,
        months: body.months,
        operator: body.operator,
        payerPhoneNumber: body.payer_phone_number,
        customerTaxId: body.customer_tax_id ?? null,
        termsVersion: body.terms_version,
      },
      req.ip ?? 'unknown'
    );
    res.status(201).json({ ...payment, amount: Number(payment.amount) });
  })().catch(next);
});
