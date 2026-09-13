import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt.js';
import { logger } from '../lib/logger.js';
import { authRepository } from '../modules/auth/auth.repository.js';

/**
 * JWT authentication middleware
 * Verifies JWT token from Authorization header and attaches user to request
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          message: 'Missing or invalid authorization header',
          code: 'UNAUTHORIZED',
          requestId: req.requestId,
        },
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const payload = verifyToken(token);

    // Reject tokens whose embedded tokenVersion is stale — bumped on every
    // password change (e.g. via the OTP-verified reset flow), this is how
    // prior sessions get invalidated (FR-013).
    const account = await authRepository.findById(payload.accountId);
    if (!account || account.tokenVersion !== payload.tokenVersion) {
      return res.status(401).json({
        error: {
          message: 'Invalid or expired token',
          code: 'INVALID_TOKEN',
          requestId: req.requestId,
        },
      });
    }

    // Attach user information to request
    req.user = {
      id: payload.accountId,
      phoneNumber: payload.phoneNumber,
    };

    logger.debug({ requestId: req.requestId, accountId: payload.accountId }, 'User authenticated');

    next();
  } catch (error) {
    logger.warn(
      { requestId: req.requestId, error },
      'Authentication failed'
    );

    return res.status(401).json({
      error: {
        message: 'Invalid or expired token',
        code: 'INVALID_TOKEN',
        requestId: req.requestId,
      },
    });
  }
}
