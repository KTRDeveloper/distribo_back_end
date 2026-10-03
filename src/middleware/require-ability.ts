import { subject } from '@casl/ability';
import type { Request, RequestHandler } from 'express';
import { httpError } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';
import { abilityFor } from '../shared/access/ability.js';

const SERVER_CONTEXT = {
  onServer: false,
  online: true,
  daysSinceSync: 0,
} as const;

/**
 * Enforces a route's declared permission using only the server-populated actor.
 * Missing actors and denied abilities fail closed per ASVS 8.2.1; every refusal
 * is recorded without request-provided identity or personal data.
 *
 * @param action - Action declared by the guarded route.
 * @param subjectType - CASL subject type declared by the route.
 * @param conditionsFrom - Optional mapper for condition-bearing subject fields.
 * @returns Express middleware that continues only when the actor is authorized.
 */
export function requireAbility(
  action: string,
  subjectType: string,
  conditionsFrom?: (req: Request) => Record<string, unknown>,
): RequestHandler {
  return (req, _res, next) => {
    const actor = req.actor;
    const permitted =
      actor !== undefined &&
      abilityFor(actor.role, SERVER_CONTEXT).can(
        action,
        conditionsFrom ? subject(subjectType, conditionsFrom(req)) : subjectType,
      );

    if (permitted) {
      next();
      return;
    }

    logger.warn(
      {
        event: 'permission_refused',
        personId: actor?.personId,
        action,
        subjectType,
      },
      'Permission refused',
    );
    next(httpError(403, 'FORBIDDEN', 'Permission denied'));
  };
}
