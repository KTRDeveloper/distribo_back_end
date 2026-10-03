import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import { uuidV7Schema } from '../shared/ids.js';
import { idempotencyRepository } from '../modules/access/idempotency.repository.js';

const bodySchema = z.object({ id: uuidV7Schema }).passthrough();

function validationError(res: Response) {
  return res.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      requestId: res.req.requestId,
    },
  });
}

/**
 * Ensures a person-scoped online gesture executes at most once.
 *
 * The database primary key arbitrates concurrent requests (ASVS 2.3.3/2.3.4).
 * Successful JSON responses are captured verbatim; 5xx responses release the
 * reservation because they cannot safely be treated as completed gestures.
 *
 * @returns Express middleware for authenticated data-changing routes.
 */
export function idempotent(): RequestHandler {
  return async (req, res, next) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return validationError(res);

    const personId = req.user?.id;
    if (!personId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          requestId: req.requestId,
        },
      });
    }
    const key = parsed.data.id;
    const reserved = await idempotencyRepository.reserve(personId, key);
    if (!reserved) {
      const prior = await idempotencyRepository.find(personId, key);
      if (
        prior?.statusCode !== null &&
        prior?.statusCode !== undefined &&
        prior.responseBody !== null
      ) {
        res.setHeader('Idempotent-Replay', 'true');
        return res.status(prior.statusCode).json(prior.responseBody);
      }
      return res.status(409).json({
        error: {
          code: 'REQUEST_IN_PROGRESS',
          message: 'A request with this id is already in progress',
          requestId: req.requestId,
        },
      });
    }

    const originalJson = res.json.bind(res);
    let capturedBody: unknown;
    res.json = ((body: unknown) => {
      capturedBody = body;
      return originalJson(body);
    }) as typeof res.json;

    res.once('finish', () => {
      const operation =
        res.statusCode >= 500
          ? idempotencyRepository.remove(personId, key)
          : idempotencyRepository.complete(personId, key, res.statusCode, capturedBody ?? null);
      void operation.catch(next);
    });
    return next();
  };
}
