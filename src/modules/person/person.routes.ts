import { Router, type Request } from 'express';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { checkAndConsume } from '../../lib/rate-limit.js';
import { authMiddleware } from '../../middleware/auth.js';
import {
  findByActivePhone,
  toPublicPerson,
  type PublicPerson,
} from './person.repository.js';
import { lookupQuerySchema } from './person.schemas.js';

const LOOKUP_LIMIT = 60;
const LOOKUP_WINDOW_SECONDS = 3600;

export const personRoutes = Router();
personRoutes.use(authMiddleware);

function callerIdFrom(request: Request): string {
  const user = request.user as { id?: string; personId?: string } | undefined;
  const auth = (request as Request & { auth?: { personId?: string } }).auth;
  const callerId = user?.personId ?? auth?.personId ?? user?.id;

  if (!callerId) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  return callerId;
}

/**
 * Looks up only a registered active owner while keeping absent and non-registered identities indistinguishable.
 * The caller-scoped fixed window limits phone-number enumeration (ASVS v5.0.0-2.4.1).
 *
 * @param callerId - Authenticated person consuming the lookup allowance.
 * @param phone - Normalized E.164 phone number.
 * @returns The closed public person view, or a non-registration response for every hidden state.
 * @throws A 429 `RATE_LIMITED` error after 60 lookups in an hour.
 */
export async function lookupPerson(callerId: string, phone: string): Promise<PublicPerson> {
  const result = await checkAndConsume(
    `lookup:${callerId}`,
    LOOKUP_LIMIT,
    LOOKUP_WINDOW_SECONDS
  );

  if (!result.allowed) {
    logger.warn({ event: 'lookup_rate_limited', personId: callerId }, 'Person lookup rate limited');
    throw httpError(429, 'RATE_LIMITED', 'Too many person lookups');
  }

  const person = await findByActivePhone(phone);
  if (!person || person.registeredAt === null) {
    return { phone_number: phone, registered: false, public_name: null };
  }

  return toPublicPerson(person);
}

personRoutes.get('/lookup', (req, res, next) => {
  void (async () => {
    const query = lookupQuerySchema.parse(req.query);
    const person = await lookupPerson(callerIdFrom(req), query.phone);
    res.status(200).json(person);
  })().catch(next);
});
