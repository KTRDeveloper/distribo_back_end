import { Router } from 'express';
import { httpError } from '../../lib/http-error.js';
import {
  deviceIdParamSchema,
  emailConfirmSchema,
  loginSchema,
  loginVerifySchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  phoneChangeConfirmSchema,
  phoneChangeRequestSchema,
  refreshSchema,
  registerRequestSchema,
  registerSchema,
} from './auth.schemas.js';
import { refreshSession, revokeDevice, revokeSessions } from './session.service.js';
import { authMiddleware } from '../../middleware/auth.js';
import {
  changePassword,
  completeLogin,
  confirmPasswordReset,
  confirmPhoneChange,
  confirmEmail,
  listDevices,
  register,
  requestEmailVerification,
  requestLogin,
  requestPasswordReset,
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

// Authenticated route: the code is checked against the saved email of the session's person.
authRoutes.post('/email/verify/confirm', authMiddleware, (req, res, next) => {
  void (async () => {
    if (!req.user) throw httpError(401, 'UNAUTHORIZED', 'Not authenticated');
    const body = emailConfirmSchema.safeParse(req.body);
    if (!body.success) throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
    await confirmEmail(req.user.id, body.data.code);
    res.status(204).end();
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

// Authenticated route: the code must have been sent to the new number for this person.
authRoutes.post('/phone/change/confirm', authMiddleware, (req, res, next) => {
  void (async () => {
    if (!req.user) throw httpError(401, 'UNAUTHORIZED', 'Not authenticated');
    const body = phoneChangeConfirmSchema.safeParse(req.body);
    if (!body.success) throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
    await confirmPhoneChange(req.user.id, body.data);
    res.status(204).end();
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

// Authenticated route: only the session person's live devices.
authRoutes.get('/devices', authMiddleware, (req, res, next) => {
  void (async () => {
    if (!req.user) throw httpError(401, 'UNAUTHORIZED', 'Not authenticated');
    res.status(200).json({ items: await listDevices(req.user.id, req.user.deviceId ?? '') });
  })().catch(next);
});

// Authenticated route: person and device filtered together; foreign ids answer 404.
authRoutes.delete('/devices/:id', authMiddleware, (req, res, next) => {
  void (async () => {
    if (!req.user) throw httpError(401, 'UNAUTHORIZED', 'Not authenticated');
    const params = deviceIdParamSchema.safeParse(req.params);
    if (!params.success) throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
    const ok = await revokeDevice(req.user.id, params.data.id, 'DEVICE_REMOVED');
    if (!ok) throw httpError(404, 'NOT_FOUND', 'Device not found');
    res.status(204).end();
  })().catch(next);
});

// Authenticated route: ends every device of the person, this one included.
authRoutes.post('/logout-all', authMiddleware, (req, res, next) => {
  void (async () => {
    if (!req.user) throw httpError(401, 'UNAUTHORIZED', 'Not authenticated');
    await revokeSessions(req.user.id, 'LOGOUT_ALL');
    res.status(204).end();
  })().catch(next);
});

// Public route: always 202 with the same keys, whatever the number.
authRoutes.post('/password-reset/request', (req, res, next) => {
  void (async () => {
    const body = passwordResetRequestSchema.safeParse(req.body);
    if (!body.success) throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
    res.status(202).json(await requestPasswordReset(body.data, { ip: req.ip }));
  })().catch(next);
});

// Public route: the code proves the SIM or the verified email.
authRoutes.post('/password-reset/confirm', (req, res, next) => {
  void (async () => {
    const body = passwordResetConfirmSchema.safeParse(req.body);
    if (!body.success) throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
    await confirmPasswordReset(body.data);
    res.status(204).end();
  })().catch(next);
});

// Authenticated route: the current password is required (v5.0.0-6.2.3).
authRoutes.post('/password/change', authMiddleware, (req, res, next) => {
  void (async () => {
    if (!req.user?.deviceId) throw httpError(401, 'UNAUTHORIZED', 'Not authenticated');
    const body = passwordChangeSchema.safeParse(req.body);
    if (!body.success) throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
    await changePassword(req.user.id, req.user.deviceId, body.data);
    res.status(204).end();
  })().catch(next);
});
