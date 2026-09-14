import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt.js';
import { logger } from '../lib/logger.js';

/**
 * JWT authentication middleware
 *
 * Verifies the access token by signature alone — no database lookup. This
 * is safe because access tokens are short-lived (see config.jwt.accessTokenExpiresIn)
 * and revocation lives at the refresh-token layer instead (see
 * specs/005-refresh-tokens/research.md §1); a revoked/locked account simply
 * cannot obtain further access tokens once its refresh tokens are revoked.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
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
