import { Router } from 'express';
import { httpError } from '../../lib/http-error.js';
import {
  loginSchema,
  loginVerifySchema,
  phoneChangeRequestSchema,
  refreshSchema,
  registerRequestSchema,
  registerSchema,
} from './auth.schemas.js';
import { refreshSession, revokeDevice } from './session.service.js';
import { authMiddleware } from '../../middleware/auth.js';
import {
  completeLogin,
  register,
  requestEmailVerification,
  requestLogin,
  requestPhoneChange,
  requestRegistrationCode,
} from './auth.service.js';

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

// Public route: the code proves ownership of the number.
authRoutes.post('/register', (req, res, next) => {
  void (async () => {
    const body = registerSchema.safeParse(req.body);
    if (!body.success) throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
    res.status(201).json(await register(body.data));
  })().catch(next);
});

// Public route: password first step; a code follows (AUTH-014 opens the session).
authRoutes.post('/login', (req, res, next) => {
  void (async () => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
    res.status(202).json(await requestLogin(body.data, { ip: req.ip }));
  })().catch(next);
});

// Public route: the LOGIN code proves the second factor and opens the session.
authRoutes.post('/login/verify', (req, res, next) => {
  void (async () => {
    const body = loginVerifySchema.safeParse(req.body);
    if (!body.success) throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
    res.status(200).json(await completeLogin(body.data));
  })().catch(next);
});

// Public route: the refresh token itself is the credential.
authRoutes.post('/refresh', (req, res, next) => {
  void (async () => {
    const body = refreshSchema.safeParse(req.body);
    if (!body.success) throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
    const s = await refreshSession(body.data.refresh_token);
    res.status(200).json({
      access_token: s.accessToken,
      refresh_token: s.refreshToken,
      expires_in: s.expiresIn,
      token_type: 'Bearer',
    });
  })().catch(next);
});

// Authenticated route: the body is ignored, the target is the saved email.
authRoutes.post('/email/verify/request', authMiddleware, (req, res, next) => {
  void (async () => {
    if (!req.user) throw httpError(401, 'UNAUTHORIZED', 'Not authenticated');
    const result = await requestEmailVerification(req.user.id, {
      ip: req.ip,
      ...(req.user.deviceId ? { deviceId: req.user.deviceId } : {}),
    });
    if (result === null) {
      res.status(204).end();
      return;
    }
    res.status(202).json(result);
  })().catch(next);
});

// Authenticated route: the person comes from the session; the code goes to the new number only.
authRoutes.post('/phone/change/request', authMiddleware, (req, res, next) => {
  void (async () => {
    if (!req.user) throw httpError(401, 'UNAUTHORIZED', 'Not authenticated');
    const body = phoneChangeRequestSchema.safeParse(req.body);
    if (!body.success) throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
    res.status(202).json(await requestPhoneChange(req.user.id, body.data, { ip: req.ip }));
  })().catch(next);
});

// Authenticated route: ends the device named in the token; repeats and foreign devices are no-ops.
authRoutes.post('/logout', authMiddleware, (req, res, next) => {
  void (async () => {
    if (!req.user) throw httpError(401, 'UNAUTHORIZED', 'Not authenticated');
    if (req.user.deviceId) await revokeDevice(req.user.id, req.user.deviceId, 'LOGOUT');
    res.status(204).end();
  })().catch(next);
});
