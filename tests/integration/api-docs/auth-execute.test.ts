import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { clearDatabase, seedUser } from '../../helpers/database';
import { createAuthenticatedRequest } from '../../helpers/request';
import { bodyOf, type OpenApiDoc } from '../../helpers/body';

describe('Executing a documented authenticated endpoint', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('marks the endpoint as requiring bearerAuth in the generated document', async () => {
    const docs = await request(app).get('/api/v1/docs/openapi.json');
    const doc = bodyOf<OpenApiDoc>(docs);
    const operation = doc.paths['/api/v1/users/me'].get;
    const bearerAuth = doc.components?.securitySchemes?.bearerAuth;

    expect(operation.security).toEqual([{ bearerAuth: [] }]);
    expect(bearerAuth?.type).toBe('http');
    expect(bearerAuth?.scheme).toBe('bearer');
  });

  it('succeeds when a valid bearer token is sent', async () => {
    const user = await seedUser({ name: 'Docs Tester', email: 'docs@example.com', password: 'Pass123!' });

    const response = createAuthenticatedRequest(app, user.id)
      .get('/api/v1/users/me');

    const result = await response;
    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty('id');
  });

  it('rejects the call when no Authorization header is supplied, as documented', async () => {
    const response = await request(app).get('/api/v1/users/me');

    expect(response.status).toBe(401);
  });
});
