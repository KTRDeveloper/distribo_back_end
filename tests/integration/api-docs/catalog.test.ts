import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { bodyOf, type OpenApiDoc } from '../../helpers/body';

describe('GET /docs/openapi.json', () => {
  it('returns a valid OpenAPI document', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');

    expect(response.status).toBe(200);
    const doc = bodyOf<OpenApiDoc>(response);
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.info).toHaveProperty('title');
    expect(doc.paths).toBeTypeOf('object');
  });

  it('lists every current endpoint from every module', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');
    const paths = Object.keys(bodyOf<OpenApiDoc>(response).paths);

    expect(paths).toContain('/api/v1/health');
    expect(paths).toContain('/api/v1/health/ready');
    expect(paths).toContain('/api/v1/health/live');

    expect(paths).toContain('/api/v1/users/me');

    expect(paths).toContain('/api/v1/tasks');
    expect(paths).toContain('/api/v1/tasks/{id}');

    expect(paths).toContain('/api/v1/remote-config');
    expect(paths).toContain('/api/v1/remote-config/{id}');
    expect(paths).toContain('/api/v1/remote-config/migrate');

    // Verify no auth paths exist
    const authPaths = paths.filter((p) => p.startsWith('/api/v1/auth'));
    expect(authPaths).toHaveLength(0);
  });

  it('groups endpoints by feature-area tags', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');
    const { paths } = bodyOf<OpenApiDoc>(response);

    expect(paths['/api/v1/health'].get.tags).toContain('health');
    expect(paths['/api/v1/users/me'].get.tags).toContain('user');
    expect(paths['/api/v1/tasks'].get.tags).toContain('tasks');
    expect(paths['/api/v1/remote-config'].get.tags).toContain('remote-config');
  });

  it('describes each endpoint with request/response schema details', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');
    const usersOp = bodyOf<OpenApiDoc>(response).paths['/api/v1/users/me'].get;

    expect(usersOp.security).toBeDefined();
    expect(usersOp.responses?.['200']).toBeDefined();
  });
});
