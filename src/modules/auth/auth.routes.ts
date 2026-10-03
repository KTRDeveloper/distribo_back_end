import { Router } from 'express';
import { httpError } from '../../lib/http-error.js';
import { registerRequestSchema } from './auth.schemas.js';
import { requestRegistrationCode } from './auth.service.js';

export const authRoutes = Router();

// Public route: a visitor has no session yet.
authRoutes.post('/register/request', (req, res, next) => {
  void (async () => {
    const body = registerRequestSchema.safeParse(req.body);
    if (!body.success) throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
    const result = await requestRegistrationCode(body.data, { ip: req.ip });
    res.status(202).json(result);
  })().catch(next);
});
