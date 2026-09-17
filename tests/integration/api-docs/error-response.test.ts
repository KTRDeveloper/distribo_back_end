import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { clearDatabase } from '../../helpers/database';

describe('Executing a documented endpoint with invalid input', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('returns the real 4xx status and error body, not a generic failure', async () => {
    // Missing required fields (phoneNumber, password) for a documented endpoint.
    const response = await request(app).post('/api/v1/auth/register').send({ name: 'Only A Name' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body).toBeDefined();
  });
});
