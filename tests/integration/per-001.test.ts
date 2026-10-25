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
        '/api/v1/auth/devices',
        '/api/v1/auth/devices/{id}',
        '/api/v1/auth/email/verify/confirm',
        '/api/v1/auth/email/verify/request',
        '/api/v1/auth/login',
        '/api/v1/auth/login/verify',
        '/api/v1/auth/logout',
        '/api/v1/auth/logout-all',
        '/api/v1/auth/password-reset/confirm',
        '/api/v1/auth/password-reset/request',
        '/api/v1/auth/password/change',
        '/api/v1/auth/phone/change/confirm',
        '/api/v1/auth/phone/change/request',
        '/api/v1/auth/refresh',
        '/api/v1/auth/register',
        '/api/v1/auth/register/claim',
        '/api/v1/auth/register/request',
      ]);
    });

    it('/api/v1/billing/shops/{code} is listed in OpenAPI with GET (BIL-007)', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/billing/shops/{code}';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['get']));
    });

    it('lists the owner keep-choice route with POST (BIL-018)', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/organizations/{organizationId}/billing/keep-choice';
      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['post']));
    });

    it('/api/v1/billing/payments is listed in OpenAPI with POST (BIL-009)', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/billing/payments';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['post']));
    });

    it('lists public payment status with GET (BIL-015)', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/billing/payments/{id}';
      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['get']));
    });

    it('/api/v1/users/me is still listed in OpenAPI', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);

      expect(Object.keys(doc.paths)).toContain('/api/v1/users/me');
    });

    it('/api/v1/users/me/avatar is listed in OpenAPI with PUT and DELETE', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);

      expect(Object.keys(doc.paths)).toContain('/api/v1/users/me/avatar');
      const operations = Object.keys(doc.paths['/api/v1/users/me/avatar']);
      expect(operations).toEqual(expect.arrayContaining(['put', 'delete']));
    });

    it('/api/v1/organizations/{organizationId}/contacts is listed in OpenAPI with POST', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/organizations/{organizationId}/contacts';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['post']));
    });

    it('/api/v1/organizations/{organizationId}/contacts/{contactId} is listed in OpenAPI with DELETE', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/organizations/{organizationId}/contacts/{contactId}';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['delete']));
    });

    it('/api/v1/organizations/{organizationId}/contacts/{contactId}/confirm is listed in OpenAPI with POST', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/organizations/{organizationId}/contacts/{contactId}/confirm';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['post']));
    });

    it('/api/v1/organizations/{organizationId}/contacts/{contactId}/resend is listed in OpenAPI with POST', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/organizations/{organizationId}/contacts/{contactId}/resend';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['post']));
    });

    it('/api/v1/organizations/{organizationId}/logo is listed in OpenAPI with PUT and DELETE', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/organizations/{organizationId}/logo';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['put', 'delete']));
    });

    it('/api/v1/organizations/{organizationId}/products/{productId}/variants is listed in OpenAPI with POST', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/organizations/{organizationId}/products/{productId}/variants';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['post']));
    });

    it('/api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId} is listed in OpenAPI with PATCH', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path =
        '/api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['patch']));
    });

    it('/api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId} is listed in OpenAPI with DELETE', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path =
        '/api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}';

      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['delete']));
    });

    it('/api/v1/organizations/{organizationId}/products/{productId} is listed in OpenAPI with DELETE', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/organizations/{organizationId}/products/{productId}';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['delete']));
    });

    it('/api/v1/organizations/{organizationId}/products/{productId}/photos/{position} is listed in OpenAPI with PUT', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/organizations/{organizationId}/products/{productId}/photos/{position}';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['put']));
    });

    it('/api/v1/organizations/{organizationId}/products/{productId}/photos/{photoId} is listed in OpenAPI with DELETE', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/organizations/{organizationId}/products/{productId}/photos/{photoId}';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['delete']));
    });

    it('/api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}/photos/{position} is listed in OpenAPI with PUT', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path =
        '/api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}/photos/{position}';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['put']));
    });

    it('/api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}/photos/{photoId} is listed in OpenAPI with DELETE', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path =
        '/api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}/photos/{photoId}';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['delete']));
    });

    it('/api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}/photos/copy is listed in OpenAPI with POST', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path =
        '/api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}/photos/copy';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['post']));
    });

    it('/api/v1/admin/people/{personId}/release-phone is listed in OpenAPI with POST (ADM-017)', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/admin/people/{personId}/release-phone';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['post']));
    });

    it('/api/v1/admin/people/{personId}/restore-access/start is listed in OpenAPI with POST (ADM-019)', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/admin/people/{personId}/restore-access/start';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['post']));
    });

    it('/api/v1/admin/people/{personId}/restore-access/complete is listed in OpenAPI with POST (ADM-020)', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');
      const doc = bodyOf<OpenApiDoc>(response);
      const path = '/api/v1/admin/people/{personId}/restore-access/complete';

      expect(Object.keys(doc.paths)).toContain(path);
      expect(Object.keys(doc.paths[path])).toEqual(expect.arrayContaining(['post']));
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
