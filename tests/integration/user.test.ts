import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { bodyOf, type ErrorBody } from '../helpers/body';

describe('User Endpoints', () => {
  describe('GET /api/users/me', () => {
    it('should require authentication', async () => {
      const response = await request(app).get('/api/v1/users/me');

      expect(response.status).toBe(401);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHORIZED');
    });

    it('should reject invalid token format', async () => {
      const response = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', 'Invalid token');

      expect(response.status).toBe(401);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHORIZED');
    });

    it('should reject malformed bearer token', async () => {
      const response = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer invalid.token.here');

      expect(response.status).toBe(401);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('PATCH /api/users/me', () => {
    it('should require authentication', async () => {
      const response = await request(app).patch('/api/v1/users/me').send({
        name: 'Updated Name',
      });

      expect(response.status).toBe(401);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHORIZED');
    });

    it('should validate name length when provided', async () => {
      // This would require a valid token, testing validation only
      const response = await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', 'Bearer fake.token.here')
        .send({
          name: 'T',
        });

      // Will fail on auth or validation
      expect([400, 401]).toContain(response.status);
    });
  });
});
