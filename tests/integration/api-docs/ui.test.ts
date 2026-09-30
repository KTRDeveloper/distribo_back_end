import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';

describe('GET /docs', () => {
  it('renders the Swagger UI HTML page', async () => {
    const response = await request(app).get('/api/v1/docs/');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('swagger-ui');
  });
});
