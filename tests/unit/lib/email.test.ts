import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockLogger } from '../../helpers/mocks.js';

const doubles = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  smtp: {
    host: 'smtp.test.local',
    port: 587,
    user: 'fake-user',
    password: 'fake-password',
    fromAddress: 'sender@test.local',
  },
}));

vi.mock('../../../src/config/index.js', () => ({ config: { smtp: doubles.smtp } }));
vi.mock('../../../src/lib/logger.js', () => ({ logger: createMockLogger() }));
vi.mock('nodemailer', () => ({ default: { createTransport: doubles.createTransport } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  doubles.smtp.port = 587;
  doubles.sendMail.mockReset().mockResolvedValue({ messageId: 'fake-message' });
  doubles.createTransport.mockReturnValue({ sendMail: doubles.sendMail });
});

describe('SMTP email sender', () => {
  it.each([
    [465, true],
    [587, false],
  ])('configures SMTP port %s with secure=%s', async (port, secure) => {
    doubles.smtp.port = port;
    await import('../../../src/lib/email.js');
    expect(doubles.createTransport).toHaveBeenCalledExactlyOnceWith({
      host: 'smtp.test.local',
      port,
      secure,
      auth: { user: 'fake-user', pass: 'fake-password' },
    });
    expect(doubles.sendMail).not.toHaveBeenCalled();
  });

  it('forwards only the expected message fields and resolves without exposing transport data', async () => {
    const { emailSender } = await import('../../../src/lib/email.js');
    await expect(
      emailSender.send('recipient@test.local', 'Fake subject', 'Fake body')
    ).resolves.toBeUndefined();
    expect(doubles.sendMail).toHaveBeenCalledExactlyOnceWith({
      from: 'sender@test.local',
      to: 'recipient@test.local',
      subject: 'Fake subject',
      text: 'Fake body',
    });
  });

  it('logs and propagates SMTP failures unchanged', async () => {
    const error = new Error('fake SMTP failure');
    doubles.sendMail.mockRejectedValue(error);
    const { emailSender } = await import('../../../src/lib/email.js');
    const { logger } = await import('../../../src/lib/logger.js');
    await expect(
      emailSender.send('recipient@test.local', 'Fake subject', 'Fake body')
    ).rejects.toBe(error);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { error },
      'Failed to send email via SMTP'
    );
  });
});
