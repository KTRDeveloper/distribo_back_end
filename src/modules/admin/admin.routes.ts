import { Router } from 'express';
import { adminLoginSchema } from './admin.schemas.js';
import { adminLogin } from './admin.service.js';

/** Administration routes, mounted under /api/v1/admin. */
export const adminRoutes = Router();

// POST /api/v1/admin/auth/login - public: password and authenticator code give a 15-minute token
adminRoutes.post('/auth/login', (req, res, next) => {
  adminLogin(adminLoginSchema.parse(req.body))
    .then((result) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        access_token: result.access_token,
        expires_in: result.expires_in,
        role: result.role,
      });
    })
    .catch(next);
});
