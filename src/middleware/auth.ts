import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt.js';
import { logger } from '../lib/logger.js';

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

    // Attach user information to request
    req.user = {
      id: payload.userId,
      email: payload.email,
    };

    logger.debug({ requestId: req.requestId, userId: payload.userId }, 'User authenticated');

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
