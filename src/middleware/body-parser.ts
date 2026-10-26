import express, { Request, Response, NextFunction } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer;
  }
}

interface BodyParserError {
  status?: number;
  code?: string;
}

/**
 * Per-route body size limits
 * Maps route paths to their specific limit overrides
 * All other routes use the default 100kb limit
 */
export const BODY_LIMITS: Record<string, string> = {
  '/api/v1/sync/push': '5mb',
};

/**
 * Custom JSON body parser middleware with per-route limit support
 * Enforces a 100kb default limit on JSON bodies with route-specific overrides
 * Returns 413 PAYLOAD_TOO_LARGE if body exceeds the limit for the route
 *
 * @security ASVS v5.0.0-2.2.1: explicit maximum on every request body
 * @security ASVS v5.0.0-15.2.2: the limit is checked before parsing
 */
export function jsonBodyParser(req: Request, res: Response, next: NextFunction) {
  // Determine the limit for this route
  const limit = BODY_LIMITS[req.path] || '100kb';

  // Create a parser with the appropriate limit
  const parser = express.json({
    limit,
    verify: (_request, _response, body) => {
      // Signature verification must see the original bytes, not re-serialized JSON.
      if (req.path === '/api/v1/billing/confirmations') req.rawBody = body;
    },
  });

  // If the body exceeds the limit, express will emit a 'PayloadTooLargeError'
  // We need to catch this and handle it
  parser(req, res, (err: unknown) => {
    if (err && typeof err === 'object') {
      const bodyParserError = err as BodyParserError;
      if (bodyParserError.status === 413 || bodyParserError.code === 'ENTITY_TOO_LARGE') {
        return res.status(413).json({
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Request body too large',
            requestId: req.requestId,
          },
        });
      }
    }

    if (err) {
      return next(err);
    }

    next();
  });
}
