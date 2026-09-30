import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { clearDatabase } from '../../helpers/database';
import { uniquePhone } from '../../helpers/phone';
import { otpDeliveryQueue } from '../../../src/lib/otp-delivery-queue';
import { bodyOf, type OpenApiDoc } from '../../helpers/body';

function getLastOtpCode(): string {
  const calls = (otpDeliveryQueue.add as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const { message } = calls[calls.length - 1][1] as { message: string };
  const match = message.match(/(\d{6})/);
  if (!match) throw new Error(`No OTP code found in message: ${message}`);
  return match[1];
}

describe('Executing a documented authenticated endpoint', () => {
  beforeEach(async () => {
    await clearDatabase();
    (otpDeliveryQueue.add as unknown as { mockClear: () => void }).mockClear();
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

  it('succeeds when a valid bearer token (as supplied via "Authorize") is sent', async () => {
    const phoneNumber = uniquePhone();
    const password = 'SecurePass123!';

    await request(app).post('/api/v1/auth/register').send({ name: 'Docs Tester', phoneNumber, password });
    const code = getLastOtpCode();
    const verifyResponse = await request(app)
      .post('/api/v1/auth/register/verify')
      .send({ phoneNumber, code });
    const token = bodyOf<{ accessToken: string }>(verifyResponse).accessToken;

    const response = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('id');
  });

  it('rejects the call when no Authorization header is supplied, as documented', async () => {
    const response = await request(app).get('/api/v1/users/me');

    expect(response.status).toBe(401);
  });
});
