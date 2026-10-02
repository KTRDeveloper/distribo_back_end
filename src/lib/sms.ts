import { Textbee } from '@textbee/sdk';
import { config } from '../config/index.js';
import { logger } from './logger.js';

/**
 * SMS provider abstraction. Kept behind an interface so `auth.service.ts`
 * (and its tests) never depend on the TextBee SDK directly — swapping
 * providers later only touches this file.
 */
export interface SmsSender {
  send(to: string, body: string): Promise<void>;
}

const textbee = new Textbee({ apiKey: config.sms.textbeeApiKey });

export const smsSender: SmsSender = {
  async send(to: string, body: string): Promise<void> {
    try {
      await textbee.sendSms({
        recipients: [to],
        message: body,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to send SMS via TextBee');
      throw error;
    }
  },
};
