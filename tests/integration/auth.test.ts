import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import {
  seedUser,
  clearDatabase,
  getUserByPhoneNumber,
  markEmailVerified,
  markPhoneVerified,
} from '../helpers/database';
import { uniquePhone } from '../helpers/phone';
import { otpDeliveryQueue } from '../../src/lib/otp-delivery-queue';
import { prisma } from '../setup';
import { redis } from '../../src/lib/redis.js';

/**
 * Extract the plaintext OTP job(s) enqueued for delivery. `bullmq` is
 * mocked in tests/setup.ts, so `add()` never actually sends anything —
 * this is how tests recover the code a real user would receive by SMS/email.
 */
function getOtpJobs(): Array<{ channel: string; to: string; message: string; subject?: string }> {
  const calls = (otpDeliveryQueue.add as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls.map((call) => call[1] as { channel: string; to: string; message: string; subject?: string });
}

function getLastOtpCode(): string {
  const jobs = getOtpJobs();
  const { message } = jobs[jobs.length - 1];
  const match = message.match(/(\d{6})/);
  if (!match) throw new Error(`No OTP code found in message: ${message}`);
  return match[1];
}

function createRegistrationData(overrides?: { name?: string; phoneNumber?: string; password?: string }) {
  return {
    name: 'Test User',
    phoneNumber: uniquePhone(),
    password: 'SecurePass123!',
    ...overrides,
  };
}

describe('Authentication Endpoints', () => {
  beforeEach(async () => {
    await clearDatabase();
    (otpDeliveryQueue.add as unknown as { mockClear: () => void }).mockClear();
  });

  describe('POST /auth/register + /auth/register/verify', () => {
    it('should create an unverified account and send an OTP', async () => {
      const data = createRegistrationData();

      const response = await request(app).post('/api/v1/auth/register').send(data);

      expect(response.status).toBe(201);
      expect(response.body).not.toHaveProperty('accessToken');
      const jobs = getOtpJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].channel).toBe('SMS');
      expect(jobs[0].to).toBe(data.phoneNumber);
    });

    it('should not require an email address to register', async () => {
      const data = createRegistrationData();
      const response = await request(app).post('/api/v1/auth/register').send(data);
      expect(response.status).toBe(201);
    });

    it('should return 409 when the phone number already has an account', async () => {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);

      const response = await request(app).post('/api/v1/auth/register').send(data);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PHONE_EXISTS');
    });

    it('should verify the OTP, activate the phone number, and sign the user in', async () => {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);
      const code = getLastOtpCode();

      const response = await request(app)
        .post('/api/v1/auth/register/verify')
        .send({ phoneNumber: data.phoneNumber, code });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('accessTokenExpiresIn');
      expect(response.body.user.phoneNumber).toBe(data.phoneNumber);

      const account = await getUserByPhoneNumber(data.phoneNumber);
      expect(account!.person.phoneVerifiedAt).not.toBeNull();
    });

    it('should reject an incorrect registration OTP', async () => {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);

      const response = await request(app)
        .post('/api/v1/auth/register/verify')
        .send({ phoneNumber: data.phoneNumber, code: '000000' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_OTP');
    });

    it('should validate password strength', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(createRegistrationData({ password: 'weak' }));

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/register/resend', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should send a new code that verifies successfully, invalidating the original one', async () => {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);
      const originalCode = getLastOtpCode();

      const resendResponse = await request(app)
        .post('/api/v1/auth/register/resend')
        .send({ phoneNumber: data.phoneNumber });
      expect(resendResponse.status).toBe(202);

      const jobs = getOtpJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs[1].channel).toBe('SMS');
      expect(jobs[1].to).toBe(data.phoneNumber);

      const staleAttempt = await request(app)
        .post('/api/v1/auth/register/verify')
        .send({ phoneNumber: data.phoneNumber, code: originalCode });
      expect(staleAttempt.status).toBe(400);
      expect(staleAttempt.body.error.code).toBe('INVALID_OTP');

      const newCode = getLastOtpCode();
      const verifyResponse = await request(app)
        .post('/api/v1/auth/register/verify')
        .send({ phoneNumber: data.phoneNumber, code: newCode });
      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body).toHaveProperty('accessToken');
    });

    it('should return the same generic response for an already-verified phone number without sending a code', async () => {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);
      const code = getLastOtpCode();
      await request(app).post('/api/v1/auth/register/verify').send({ phoneNumber: data.phoneNumber, code });

      const response = await request(app)
        .post('/api/v1/auth/register/resend')
        .send({ phoneNumber: data.phoneNumber });

      expect(response.status).toBe(202);
      expect(getOtpJobs()).toHaveLength(1); // only the original registration job, nothing new
    });

    it('should return the same generic response for an unknown phone number without sending a code', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register/resend')
        .send({ phoneNumber: uniquePhone() });

      expect(response.status).toBe(202);
      expect(getOtpJobs()).toHaveLength(0);
    });

    it('should return a generic response with the same shape whether or not a code was actually sent', async () => {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);

      const unverifiedResendResponse = await request(app)
        .post('/api/v1/auth/register/resend')
        .send({ phoneNumber: data.phoneNumber });
      const unknownResendResponse = await request(app)
        .post('/api/v1/auth/register/resend')
        .send({ phoneNumber: uniquePhone() });

      expect(unverifiedResendResponse.status).toBe(unknownResendResponse.status);
      expect(Object.keys(unverifiedResendResponse.body)).toEqual(Object.keys(unknownResendResponse.body));
    });

    it('should reject a resend while the account is locked', async () => {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);
      const account = await getUserByPhoneNumber(data.phoneNumber);
      await prisma.account.update({
        where: { id: account!.id },
        data: { lockedUntil: new Date(Date.now() + 10 * 60 * 1000) },
      });

      const response = await request(app)
        .post('/api/v1/auth/register/resend')
        .send({ phoneNumber: data.phoneNumber });

      expect(response.status).toBe(423);
      expect(response.body.error.code).toBe('ACCOUNT_LOCKED');
      expect(getOtpJobs()).toHaveLength(1); // only the original registration job
    });

    it('should reject a resend that exceeds the request cooldown', async () => {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);

      // Simulate the cooldown key from the original register() call already being set.
      vi.spyOn(redis, 'get').mockResolvedValueOnce('1');

      const response = await request(app)
        .post('/api/v1/auth/register/resend')
        .send({ phoneNumber: data.phoneNumber });

      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('OTP_COOLDOWN');
      expect(getOtpJobs()).toHaveLength(1); // only the original registration job
    });
  });

  describe('POST /auth/login (phone + password, no OTP)', () => {
    async function registerAndVerify(overrides?: { name?: string; password?: string }) {
      const data = createRegistrationData(overrides);
      await request(app).post('/api/v1/auth/register').send(data);
      const code = getLastOtpCode();
      await request(app).post('/api/v1/auth/register/verify').send({ phoneNumber: data.phoneNumber, code });
      return data;
    }

    it('should log in successfully with the correct phone number and password', async () => {
      const data = await registerAndVerify();

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ phoneNumber: data.phoneNumber, password: data.password });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('accessTokenExpiresIn');
      expect(response.body.user.phoneNumber).toBe(data.phoneNumber);
    });

    it('should not require or accept an OTP to log in', async () => {
      const data = await registerAndVerify();
      // No OTP request/verify call happens between register-verify and login.
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ phoneNumber: data.phoneNumber, password: data.password });
      expect(response.status).toBe(200);
    });

    it('should reject login for an unverified phone number', async () => {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ phoneNumber: data.phoneNumber, password: data.password });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('PHONE_NOT_VERIFIED');
    });

    it('should reject an incorrect password', async () => {
      const data = await registerAndVerify();

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ phoneNumber: data.phoneNumber, password: 'WrongPassword123' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should return 401 for an unknown phone number', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ phoneNumber: uniquePhone(), password: 'SecurePass123!' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should lock the account after too many failed password attempts', async () => {
      const data = await registerAndVerify();

      let lastResponse;
      for (let i = 0; i < 5; i++) {
        lastResponse = await request(app)
          .post('/api/v1/auth/login')
          .send({ phoneNumber: data.phoneNumber, password: 'WrongPassword123' });
      }

      expect(lastResponse!.status).toBe(423);
      expect(lastResponse!.body.error.code).toBe('ACCOUNT_LOCKED');
    });
  });

  describe('POST /auth/password-reset/request + /auth/password-reset/confirm', () => {
    async function seedVerifiedAccount(password = 'OldPassword123') {
      const user = await seedUser({ email: 'reset@example.com', password, name: 'Test' });
      const account = await getUserByPhoneNumber(user.phoneNumber);
      await markPhoneVerified(account!.personId);
      return user;
    }

    it('should send the reset OTP by SMS only when email is unverified', async () => {
      const user = await seedVerifiedAccount();

      const response = await request(app)
        .post('/api/v1/auth/password-reset/request')
        .send({ phoneNumber: user.phoneNumber });

      expect(response.status).toBe(202);
      const jobs = getOtpJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].channel).toBe('SMS');
    });

    it('should send the reset OTP by both SMS and email when the email is verified', async () => {
      const user = await seedVerifiedAccount();
      const account = await getUserByPhoneNumber(user.phoneNumber);
      await markEmailVerified(account!.personId);

      const response = await request(app)
        .post('/api/v1/auth/password-reset/request')
        .send({ phoneNumber: user.phoneNumber });

      expect(response.status).toBe(202);
      const jobs = getOtpJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs.map((j) => j.channel).sort()).toEqual(['EMAIL', 'SMS']);
      expect(jobs.find((j) => j.channel === 'EMAIL')!.to).toBe(user.email);
      // Both channels carry the same code.
      const codes = jobs.map((j) => j.message.match(/(\d{6})/)![1]);
      expect(codes[0]).toBe(codes[1]);
    });

    it('should reset the password successfully and allow login with the new password', async () => {
      const user = await seedVerifiedAccount();

      await request(app).post('/api/v1/auth/password-reset/request').send({ phoneNumber: user.phoneNumber });
      const code = getLastOtpCode();

      const confirmResponse = await request(app).post('/api/v1/auth/password-reset/confirm').send({
        phoneNumber: user.phoneNumber,
        code,
        newPassword: 'NewPassword123',
      });
      expect(confirmResponse.status).toBe(200);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ phoneNumber: user.phoneNumber, password: 'NewPassword123' });
      expect(loginResponse.status).toBe(200);
    });

    it('should revoke previously issued refresh tokens after a password reset (FR-008)', async () => {
      const user = await seedVerifiedAccount();
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ phoneNumber: user.phoneNumber, password: 'OldPassword123' });
      const oldRefreshToken = loginResponse.body.refreshToken;

      await request(app).post('/api/v1/auth/password-reset/request').send({ phoneNumber: user.phoneNumber });
      const code = getLastOtpCode();
      await request(app).post('/api/v1/auth/password-reset/confirm').send({
        phoneNumber: user.phoneNumber,
        code,
        newPassword: 'NewPassword123',
      });

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: oldRefreshToken });

      expect(response.status).toBe(401);
    });

    it('should reject an incorrect reset code', async () => {
      const user = await seedVerifiedAccount();
      await request(app).post('/api/v1/auth/password-reset/request').send({ phoneNumber: user.phoneNumber });

      const response = await request(app).post('/api/v1/auth/password-reset/confirm').send({
        phoneNumber: user.phoneNumber,
        code: '000000',
        newPassword: 'NewPassword123',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_OTP');
    });
  });

  describe('POST /auth/refresh (005-refresh-tokens, US1)', () => {
    async function registerVerifyAndLogin() {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);
      const code = getLastOtpCode();
      const verifyResponse = await request(app)
        .post('/api/v1/auth/register/verify')
        .send({ phoneNumber: data.phoneNumber, code });
      return { phoneNumber: data.phoneNumber, ...verifyResponse.body };
    }

    it('authorizes a protected route with the issued access token', async () => {
      const { accessToken } = await registerVerifyAndLogin();

      const response = await request(app)
        .post('/api/v1/auth/email/verify/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ email: 'someone@example.com' });

      expect(response.status).toBe(202);
    });

    it('exchanges a valid refresh token for a new token pair and rotates it', async () => {
      const { refreshToken } = await registerVerifyAndLogin();

      const response = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.refreshToken).not.toBe(refreshToken);
    });

    it('rejects reuse of an already-rotated refresh token and revokes the whole account (FR-005)', async () => {
      const { refreshToken } = await registerVerifyAndLogin();

      const firstRefresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(firstRefresh.status).toBe(200);
      const rotatedRefreshToken = firstRefresh.body.refreshToken;

      // Replay the original (now-rotated) refresh token.
      const replay = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(replay.status).toBe(401);

      // The legitimate, already-rotated token is also revoked as a precaution.
      const followUp = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotatedRefreshToken });
      expect(followUp.status).toBe(401);
    });

    it('rejects an unknown or malformed refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'not-a-real-refresh-token' });

      expect(response.status).toBe(401);
    });

    it('rejects a missing refresh token', async () => {
      const response = await request(app).post('/api/v1/auth/refresh').send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/logout (005-refresh-tokens, US2)', () => {
    async function loginOnTwoDevices() {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);
      const code = getLastOtpCode();
      await request(app).post('/api/v1/auth/register/verify').send({ phoneNumber: data.phoneNumber, code });

      const deviceA = await request(app)
        .post('/api/v1/auth/login')
        .send({ phoneNumber: data.phoneNumber, password: data.password });
      const deviceB = await request(app)
        .post('/api/v1/auth/login')
        .send({ phoneNumber: data.phoneNumber, password: data.password });

      return { deviceA: deviceA.body, deviceB: deviceB.body };
    }

    it("ends only the current device's session (FR-006)", async () => {
      const { deviceA, deviceB } = await loginOnTwoDevices();

      const logoutResponse = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: deviceA.refreshToken });
      expect(logoutResponse.status).toBe(204);

      const refreshA = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: deviceA.refreshToken });
      expect(refreshA.status).toBe(401);

      const refreshB = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: deviceB.refreshToken });
      expect(refreshB.status).toBe(200);
    });

    it('is idempotent — logging out an already-invalid refresh token still succeeds (FR-010)', async () => {
      const { deviceA } = await loginOnTwoDevices();

      const first = await request(app).post('/api/v1/auth/logout').send({ refreshToken: deviceA.refreshToken });
      expect(first.status).toBe(204);

      const second = await request(app).post('/api/v1/auth/logout').send({ refreshToken: deviceA.refreshToken });
      expect(second.status).toBe(204);
    });

    it('succeeds gracefully for an unknown refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'not-a-real-refresh-token' });

      expect(response.status).toBe(204);
    });
  });

  describe('POST /auth/logout-all (005-refresh-tokens, US3)', () => {
    async function loginOnThreeDevices() {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);
      const code = getLastOtpCode();
      await request(app).post('/api/v1/auth/register/verify').send({ phoneNumber: data.phoneNumber, code });

      const devices = [];
      for (let i = 0; i < 3; i++) {
        const login = await request(app)
          .post('/api/v1/auth/login')
          .send({ phoneNumber: data.phoneNumber, password: data.password });
        devices.push(login.body);
      }
      return devices;
    }

    it('ends every session for the account (FR-007)', async () => {
      const [deviceA, deviceB, deviceC] = await loginOnThreeDevices();

      const logoutAllResponse = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${deviceA.accessToken}`);
      expect(logoutAllResponse.status).toBe(204);

      for (const device of [deviceA, deviceB, deviceC]) {
        const refresh = await request(app)
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: device.refreshToken });
        expect(refresh.status).toBe(401);
      }
    });

    it('requires a valid access token', async () => {
      const response = await request(app).post('/api/v1/auth/logout-all');

      expect(response.status).toBe(401);
    });

    it('succeeds with only one active session', async () => {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);
      const code = getLastOtpCode();
      const verifyResponse = await request(app)
        .post('/api/v1/auth/register/verify')
        .send({ phoneNumber: data.phoneNumber, code });

      const response = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${verifyResponse.body.accessToken}`);

      expect(response.status).toBe(204);
    });

    it('is also triggered by account lockout after too many failed login attempts (FR-012)', async () => {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);
      const code = getLastOtpCode();
      await request(app).post('/api/v1/auth/register/verify').send({ phoneNumber: data.phoneNumber, code });

      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ phoneNumber: data.phoneNumber, password: data.password });
      const { refreshToken } = login.body;

      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/v1/auth/login')
          .send({ phoneNumber: data.phoneNumber, password: 'WrongPassword123' });
      }

      const refresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(refresh.status).toBe(401);
    });
  });

  describe('POST /auth/email/verify/request + /auth/email/verify/confirm', () => {
    async function registerVerifyAndLogin() {
      const data = createRegistrationData();
      await request(app).post('/api/v1/auth/register').send(data);
      const code = getLastOtpCode();
      const verifyResponse = await request(app)
        .post('/api/v1/auth/register/verify')
        .send({ phoneNumber: data.phoneNumber, code });
      return { phoneNumber: data.phoneNumber, accessToken: verifyResponse.body.accessToken as string };
    }

    it('should verify an email address and set it on the account', async () => {
      const { phoneNumber, accessToken } = await registerVerifyAndLogin();

      const requestResponse = await request(app)
        .post('/api/v1/auth/email/verify/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ email: 'verified@example.com' });
      expect(requestResponse.status).toBe(202);

      const code = getLastOtpCode();

      const confirmResponse = await request(app)
        .post('/api/v1/auth/email/verify/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code });

      expect(confirmResponse.status).toBe(200);

      const account = await getUserByPhoneNumber(phoneNumber);
      expect(account!.person.email).toBe('verified@example.com');
      expect(account!.person.emailVerifiedAt).not.toBeNull();
    });

    it('should reject an incorrect verification code', async () => {
      const { accessToken } = await registerVerifyAndLogin();
      await request(app)
        .post('/api/v1/auth/email/verify/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ email: 'someone@example.com' });

      const response = await request(app)
        .post('/api/v1/auth/email/verify/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: '000000' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_VERIFICATION_CODE');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/v1/auth/email/verify/request')
        .send({ email: 'someone@example.com' });

      expect(response.status).toBe(401);
    });
  });
});
