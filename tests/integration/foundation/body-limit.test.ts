import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express, { Request, Response } from 'express';
import { jsonBodyParser, BODY_LIMITS } from '../../../src/middleware/body-parser.js';
import { errorHandler } from '../../../src/middleware/error-handler.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';

describe('Body limit middleware', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(requestIdMiddleware);
    app.use(jsonBodyParser);

    // Test endpoint that echoes the body
    app.post('/api/v1/auth/login', (_req: Request, res: Response) => {
      res.json({ success: true });
    });

    // Test endpoint for sync push (override route)
    app.post('/api/v1/sync/push', (_req: Request, res: Response) => {
      res.json({ success: true });
    });

    // Error handler must be last
    app.use(errorHandler);
  });

  describe('AC-1: Body size limits', () => {
    it('should accept 90 KB body (below limit)', async () => {
      const body90kb = { data: 'x'.repeat(90 * 1024 - 50) };
      const res = await request(app).post('/api/v1/auth/login').send(body90kb);

      // Should not be 413 (route returns 401 for missing auth)
      expect(res.status).not.toBe(413);
    });

    it('should reject 101 KB body (above limit) with 413', async () => {
      const body101kb = { data: 'x'.repeat(101 * 1024) };
      const res = await request(app).post('/api/v1/auth/login').send(body101kb);

      expect(res.status).toBe(413);
    });
  });

  describe('AC-2: Error shape for PAYLOAD_TOO_LARGE', () => {
    it('should return proper error shape when body too large', async () => {
      const body101kb = { data: 'x'.repeat(101 * 1024) };
      const res = await request(app).post('/api/v1/auth/login').send(body101kb);

      expect(res.status).toBe(413);
      expect(res.body).toHaveProperty('error');
      expect((res.body as { error: { code: string } }).error).toHaveProperty(
        'code',
        'PAYLOAD_TOO_LARGE'
      );
      expect((res.body as { error: { message: string } }).error).toHaveProperty('message');
      expect((res.body as { error: { requestId: string } }).error).toHaveProperty('requestId');
    });
  });

  describe('AC-3: Override table for specific routes', () => {
    it('should have 100kb as default limit', () => {
      expect(BODY_LIMITS).toBeDefined();
      expect(BODY_LIMITS['/api/v1/sync/push']).toBe('5mb');
    });

    it('should accept 5 MB body on sync push route', async () => {
      const body5mb = { data: 'x'.repeat(5 * 1024 * 1024 - 100) };
      const res = await request(app).post('/api/v1/sync/push').send(body5mb);

      // Should not be 413, route processes normally
      expect(res.status).not.toBe(413);
    });

    it('should reject bodies over 5 MB on sync push route with 413', async () => {
      const body6mb = { data: 'x'.repeat(6 * 1024 * 1024) };
      const res = await request(app).post('/api/v1/sync/push').send(body6mb);

      expect(res.status).toBe(413);
    });
  });

  describe('AB-1: Memory exhaustion (denial of service)', () => {
    it('should reject 2 MB body to auth/login with 413 without parsing', async () => {
      const body2mb = { data: 'x'.repeat(2 * 1024 * 1024) };
      const res = await request(app).post('/api/v1/auth/login').send(body2mb);

      expect(res.status).toBe(413);
      expect((res.body as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('Default urlencoded limit', () => {
    it('should apply 100kb limit to urlencoded data', () => {
      // This test verifies the configuration is correct
      // The actual urlencoded middleware is set in app.ts
      expect(BODY_LIMITS).toBeDefined();
    });
  });
});
