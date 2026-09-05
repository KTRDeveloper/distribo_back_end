import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';
import { ZodError } from 'zod';

/**
 * Standard error response interface
 */
export interface ErrorResponse {
  error: {
    message: string;
    code?: string;
    details?: unknown;
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
    logger.warn({ requestId, errors: err.errors }, 'Validation error');
    return res.status(400).json({
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: err.errors,
        requestId,
      },
    } satisfies ErrorResponse);
  }

  // Handle custom application errors with statusCode property
  if ('statusCode' in err && typeof err.statusCode === 'number') {
    logger.warn({ requestId, error: err }, 'Application error');
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: (err as any).code,
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
