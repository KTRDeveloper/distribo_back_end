import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { httpError } from '../lib/http-error.js';
import { verifyAdminToken } from '../lib/jwt.js';
import { logger } from '../lib/logger.js';
import { findLiveAdministrator } from '../modules/admin/admin.repository.js';

const RANK = { MODERATOR: 1, SUPER_ADMIN: 2 } as const;

/**
 * Authenticates an administration request (v5.0.0-9.2.2, v5.0.0-7.2.1). Accepts only a valid
 * HS256 token of type `admin`; an ordinary access token is refused here, as an admin token is
 * refused by `authMiddleware`. Unlike ordinary tokens, the administrator is looked up on every
 * request, so a removal takes effect at once. The role comes from the database row, not the
 * token. Sets `req.admin`. Every failure is the same 401 and fails closed on a lookup error.
 */
export const adminAuthMiddleware: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const header = req.headers.authorization;
  const unauthorized = () => httpError(401, 'UNAUTHORIZED', 'Authentication required');
  if (!header || !header.startsWith('Bearer ')) return next(unauthorized());

  let identity: ReturnType<typeof verifyAdminToken>;
  try {
    identity = verifyAdminToken(header.substring(7));
  } catch {
    logger.warn({ requestId: req.requestId, event: 'admin_auth_failed' }, 'Admin auth failed');
    return next(unauthorized());
  }

  findLiveAdministrator(identity.administratorId, identity.personId)
    .then((administrator) => {
      if (!administrator) {
        logger.warn(
          { requestId: req.requestId, event: 'admin_auth_removed', personId: identity.personId },
          'Admin token of a removed administrator'
        );
        return next(unauthorized());
      }
      req.admin = {
        personId: administrator.personId,
        administratorId: administrator.id,
        role: administrator.role,
      };
      return next();
    })
    .catch(next);
};

/**
 * Allows the request only when the signed-in administrator's role is `min` or higher
 * (SUPER_ADMIN above MODERATOR). Use after `adminAuthMiddleware`; with no `req.admin` it
 * answers 401.
 */
export function requireAdminRole(min: 'MODERATOR' | 'SUPER_ADMIN'): RequestHandler {
  return (req, _res, next) => {
    if (!req.admin) return next(httpError(401, 'UNAUTHORIZED', 'Authentication required'));
    if (RANK[req.admin.role] < RANK[min]) {
      logger.warn(
        { requestId: req.requestId, event: 'admin_access_denied', personId: req.admin.personId },
        'Admin role too low'
      );
      return next(httpError(403, 'FORBIDDEN', 'Not allowed'));
    }
    return next();
  };
}
