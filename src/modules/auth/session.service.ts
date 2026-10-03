import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { config } from '../../config/index.js';
import { httpError } from '../../lib/http-error.js';
import { signAccessToken, getAccessTokenExpiresInSeconds } from '../../lib/jwt.js';
import { generateRefreshToken, hashRefreshToken } from '../../lib/refresh-token.js';
import { newId } from '../../shared/ids.js';
import { sessionRepository, type RevokedReason } from './session.repository.js';

export type { RevokedReason };

export type DeviceInfo = {
  platform: 'ANDROID' | 'IOS';
  model?: string;
  app_version: string;
  push_token?: string;
  integrity_verdict?: string;
};

const deviceInfoSchema = z
  .object({
    platform: z.enum(['ANDROID', 'IOS']),
    model: z.string().min(1).max(100).optional(),
    app_version: z.string().min(1).max(32),
    push_token: z.string().min(1).max(512).optional(),
    integrity_verdict: z.string().min(1).max(100).optional(),
  })
  .strict();

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Open a session (v5.0.0-7.2.4): a new device, a refresh token (32 random bytes,
 * only its SHA-256 stored, v5.0.0-7.2.2) and an access token. Device info is
 * validated before anything is written; pass `tx` to join a caller's transaction.
 * @throws httpError 400 VALIDATION_ERROR on invalid device info
 */
export async function issueSession(
  personId: string,
  device: DeviceInfo,
  tx?: Prisma.TransactionClient
): Promise<{ deviceId: string; accessToken: string; refreshToken: string; expiresIn: number }> {
  const parsed = deviceInfoSchema.safeParse(device);
  if (!parsed.success) {
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid device information');
  }
  const d = parsed.data;
  const deviceId = newId();
  const refreshToken = generateRefreshToken();

  const write = async (client: Prisma.TransactionClient) => {
    await sessionRepository.createDevice(client, {
      id: deviceId,
      personId,
      platform: d.platform,
      model: d.model ?? null,
      appVersion: d.app_version,
      pushToken: d.push_token ?? null,
      integrityVerdict: d.integrity_verdict ?? null,
    });
    await sessionRepository.createRefreshToken(client, {
      id: newId(),
      personId,
      deviceId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + config.jwt.refreshTokenExpiresInDays * DAY_MS),
    });
  };
  if (tx) await write(tx);
  else await prisma.$transaction(write);

  return {
    deviceId,
    accessToken: signAccessToken({ personId, deviceId }),
    refreshToken,
    expiresIn: getAccessTokenExpiresInSeconds(),
  };
}

/**
 * End the person's live sessions in one transaction (v5.0.0-7.4.2), optionally
 * sparing one device. Only the named person's rows are touched.
 * @returns number of devices ended
 */
export function revokeSessions(
  personId: string,
  reason: RevokedReason,
  options: { exceptDeviceId?: string } = {}
): Promise<number> {
  return sessionRepository.revokeLive(personId, reason, options.exceptDeviceId);
}
