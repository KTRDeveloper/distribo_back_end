import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';
import { ZodError } from 'zod';

/** Sanitized validation issue: field path and rule code only (ASVS 16.5.1). */
export type ValidationDetail = { path: (string | number)[]; code: string };

/** Builds details explicitly from path and code so no input value or key name leaks (ASVS 15.3.1). */
function toValidationDetails(err: ZodError): ValidationDetail[] {
  return err.issues.map((i) => ({ path: [...i.path], code: i.code }));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Standard error response interface
 */
export interface ErrorResponse {
  error: {
    message: string;
    code?: string;
    details?: ValidationDetail[] | Record<string, unknown>;
    requestId?: string;
  };
}

/**
 * Global error handling middleware
 * Catches all errors and returns standardized error responses
 */
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }

  const requestId = req.requestId;

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const details = toValidationDetails(err);
    logger.warn({ requestId, details }, 'Validation error');
    return res.status(400).json({
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details,
        requestId,
      },
    } satisfies ErrorResponse);
  }

  // Handle custom application errors with statusCode property
  if ('statusCode' in err && typeof err.statusCode === 'number') {
    logger.warn({ requestId, error: err }, 'Application error');
    if ('headers' in err && isPlainObject(err.headers)) {
      for (const [name, value] of Object.entries(err.headers)) {
        if (typeof value === 'string') res.setHeader(name, value);
      }
    }
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: 'code' in err && typeof err.code === 'string' ? err.code : undefined,
        details: 'details' in err && isPlainObject(err.details) ? err.details : undefined,
        requestId,
      },
    } satisfies ErrorResponse);
  }

  // Handle all other errors as 500 Internal Server Error
  logger.error({ requestId, error: err, stack: err.stack }, 'Unhandled error');

  return res.status(500).json({
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      requestId,
    },
  } satisfies ErrorResponse);
}

/**
 * 404 Not Found handler
 * Must be registered after all other routes
 */
export function notFoundHandler(req: Request, res: Response) {
  const requestId = req.requestId;

  logger.warn({ requestId, path: req.path }, 'Route not found');

  res.status(404).json({
    error: {
      message: 'Route not found',
      code: 'NOT_FOUND',
      requestId,
    },
  } satisfies ErrorResponse);
}
