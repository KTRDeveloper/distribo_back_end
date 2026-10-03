import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { bodyOf, type ErrorBody, type OpenApiDoc } from '../helpers/body';
import { clearDatabase, seedUser } from '../helpers/database';
import { createAuthenticatedRequest } from '../helpers/request';

describe('PER-001: Retire the old sign-in module', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  describe('AC-1: Legacy routes are gone', () => {
    it('POST /api/v1/auth/register no longer accepts the legacy payload (AUTH-010)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ name: 'Test', phoneNumber: '+237123456789', password: 'Pass123!' });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/v1/auth/login no longer accepts the legacy payload (AUTH-013)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ phoneNumber: '+237123456789', password: 'Pass123!' });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/v1/auth/refresh no longer accepts the legacy payload (AUTH-016)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'some-token' });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('AC-2: Documentation matches', () => {
    it('no OpenAPI path starts with /api/v1/auth', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const paths = Object.keys(doc.paths);

      const authPaths = paths.filter((p) => p.startsWith('/api/v1/auth'));
      expect(authPaths.sort()).toEqual([
        '/api/v1/auth/email/verify/request',
        '/api/v1/auth/login',
        '/api/v1/auth/login/verify',
        '/api/v1/auth/phone/change/request',
        '/api/v1/auth/refresh',
        '/api/v1/auth/register',
        '/api/v1/auth/register/request',
      ]);
    });

    it('/api/v1/users/me is still listed in OpenAPI', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);

      expect(Object.keys(doc.paths)).toContain('/api/v1/users/me');
    });
  });

  describe('AC-3: Profile still works with a signed token', () => {
    it('returns 200 with expected fields for a seeded account with a signed token', async () => {
      const user = await seedUser({
        name: 'Test User',
        email: 'test@example.com',
        password: 'TestPass123',
      });

      const response = createAuthenticatedRequest(app, user.id).get('/api/v1/users/me');

      const result = await response;
      expect(result.status).toBe(200);
      expect(result.body).toHaveProperty('id');
      expect((result.body as Record<string, unknown>).id).toBe(user.id);
      expect(result.body).toHaveProperty('full_name');
      expect(result.body).toHaveProperty('phone_number');
    });
  });
});
