import { Router } from 'express';
import { shopParamsSchema } from './billing.schemas.js';
import { lookupShop } from './billing.service.js';

/** Billing routes; the payment site asks for no sign-in, so the shop lookup is public. */
export const billingRoutes = Router();

billingRoutes.get('/shops/:code', (req, res, next) => {
  void (async () => {
    const { code } = shopParamsSchema.parse(req.params);
    const shop = await lookupShop(code, req.ip ?? 'unknown');
    res.status(200).json({ name: shop.name });
  })().catch(next);
});
