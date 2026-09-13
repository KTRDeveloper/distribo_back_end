import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { clearDatabase } from '../../helpers/database';

/**
 * A "try it out" call from the Swagger UI is just a normal HTTP request to
 * the documented endpoint using the shapes the generated document itself
 * describes. This confirms that flow returns the same response a normal
 * API call would, for a public (no-auth) endpoint.
 */
describe('Executing a documented public endpoint', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('executes GET /health as documented and gets the real response', async () => {
    const docs = await request(app).get('/docs/openapi.json');
    const operation = docs.body.paths['/health'].get;
    expect(operation.responses['200']).toBeDefined();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
  });
});
