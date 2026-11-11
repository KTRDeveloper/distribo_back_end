import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../../src/middleware/error-handler.js';
import { httpError } from '../../../src/lib/http-error.js';
import { logger } from '../../../src/lib/logger.js';

function createApp(route: express.RequestHandler): express.Express {
  const app = express();
  app.use((req, _res, next) => {
    req.requestId = 'test-request-id';
    next();
  });
  app.get('/test', route);
  app.use(errorHandler);
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('error headers', () => {
  it('sets the headers and keeps the usual body', async () => {
    const app = createApp(() => {
      throw httpError(429, 'LOGIN_LOCKED', 'Too many failed attempts', undefined, {
        'Retry-After': '42',
      });
    });
    const response = await request(app).get('/test');
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('42');
    expect(response.body).toEqual({
      error: {
        message: 'Too many failed attempts',
        code: 'LOGIN_LOCKED',
        requestId: 'test-request-id',
      },
    });
  });

  it('answers as before without headers', async () => {
    const app = createApp(() => {
      throw httpError(409, 'PHONE_EXISTS', 'Already registered');
    });
    const response = await request(app).get('/test');
    expect(response.status).toBe(409);
    expect(response.headers['retry-after']).toBeUndefined();
    expect(response.body).toEqual({
      error: { message: 'Already registered', code: 'PHONE_EXISTS', requestId: 'test-request-id' },
    });
  });

  it('does not leak headers in the body or the log entry', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const app = createApp(() => {
      throw httpError(429, 'LOGIN_LOCKED', 'Too many failed attempts', undefined, {
        'X-Secret-Marker': 'marker-value-123',
      });
    });
    const response = await request(app).get('/test');
    expect((response.body as { error: object }).error).not.toHaveProperty('headers');
    expect(JSON.stringify(response.body)).not.toContain('marker-value-123');
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('marker-value-123');
  });
});
