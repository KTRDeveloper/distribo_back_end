import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import { logger } from './logger.js';

/**
 * Email provider abstraction, backed by a generic SMTP transport so the
 * underlying provider (SES, SendGrid, Postmark, ...) can change via config
 * alone. Used only for the secondary password-reset OTP channel and email
 * verification — never for sign-in.
 */
export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.password,
  },
});

export const emailSender: EmailSender = {
  async send(to: string, subject: string, body: string): Promise<void> {
    try {
      await transporter.sendMail({
        from: config.smtp.fromAddress,
        to,
        subject,
        text: body,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to send email via SMTP');
      throw error;
    }
  },
};
