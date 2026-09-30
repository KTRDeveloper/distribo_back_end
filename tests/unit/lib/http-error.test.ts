import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../../src/middleware/error-handler.js';
import { httpError } from '../../../src/lib/http-error.js';

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

describe('httpError', () => {
  it('returns the status, message, code, and request ID through the global handler', async () => {
    const app = createApp(() => {
      throw httpError(409, 'PHONE_EXISTS', 'Already registered');
    });

    const response = await request(app).get('/test');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        message: 'Already registered',
        code: 'PHONE_EXISTS',
        requestId: 'test-request-id',
      },
    });
  });

  it('does not expose an unexpected error message', async () => {
    const app = createApp(() => {
      throw new Error('db password is x');
    });

    const response = await request(app).get('/test');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
        requestId: 'test-request-id',
      },
    });
    expect(response.text).not.toContain('db password is x');
  });
});
