import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';

describe('GET /docs/openapi.json', () => {
  it('returns a valid OpenAPI document', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toMatch(/^3\.1/);
    expect(response.body.info).toHaveProperty('title');
    expect(response.body.paths).toBeTypeOf('object');
  });

  it('lists every current endpoint from every module', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');
    const paths = Object.keys(response.body.paths);

    expect(paths).toContain('/api/v1/health');
    expect(paths).toContain('/api/v1/health/ready');
    expect(paths).toContain('/api/v1/health/live');

    expect(paths).toContain('/api/v1/auth/register');
    expect(paths).toContain('/api/v1/auth/register/verify');
    expect(paths).toContain('/api/v1/auth/login');
    expect(paths).toContain('/api/v1/auth/password-reset/request');
    expect(paths).toContain('/api/v1/auth/password-reset/confirm');
    expect(paths).toContain('/api/v1/auth/email/verify/request');
    expect(paths).toContain('/api/v1/auth/email/verify/confirm');

    expect(paths).toContain('/api/v1/users/me');

    expect(paths).toContain('/api/v1/tasks');
    expect(paths).toContain('/api/v1/tasks/{id}');

    expect(paths).toContain('/api/v1/remote-config');
    expect(paths).toContain('/api/v1/remote-config/{id}');
    expect(paths).toContain('/api/v1/remote-config/migrate');
  });

  it('groups endpoints by feature-area tags', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');
    const { paths } = response.body;

    expect(paths['/api/v1/health'].get.tags).toContain('health');
    expect(paths['/api/v1/auth/login'].post.tags).toContain('auth');
    expect(paths['/api/v1/users/me'].get.tags).toContain('user');
    expect(paths['/api/v1/tasks'].get.tags).toContain('tasks');
    expect(paths['/api/v1/remote-config'].get.tags).toContain('remote-config');
  });

  it('describes each endpoint with request/response schema details', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');
    const registerOp = response.body.paths['/api/v1/auth/register'].post;

    expect(registerOp.requestBody.content['application/json'].schema).toBeDefined();
    expect(registerOp.responses['201']).toBeDefined();
  });
});
