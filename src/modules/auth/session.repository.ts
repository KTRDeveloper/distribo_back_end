import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';

type Client = Prisma.TransactionClient;

export type RevokedReason =
  | 'LOGOUT'
  | 'DEVICE_REMOVED'
  | 'LOGOUT_ALL'
  | 'REUSE_DETECTED'
  | 'PASSWORD_RESET'
  | 'ACCOUNT_SUSPENDED';

/** Session persistence: the only place the session service touches prisma. */
export const sessionRepository = {
  createDevice(client: Client, data: Prisma.DeviceUncheckedCreateInput) {
    return client.device.create({ data });
  },

  createRefreshToken(client: Client, data: Prisma.RefreshTokenUncheckedCreateInput) {
    return client.refreshToken.create({ data });
  },

  /** Ends the person's live devices and tokens in one transaction; returns devices ended. */
  async revokeLive(
    personId: string,
    reason: RevokedReason,
    exceptDeviceId?: string
  ): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const except = exceptDeviceId ? { id: { not: exceptDeviceId } } : {};
      const exceptTok = exceptDeviceId ? { deviceId: { not: exceptDeviceId } } : {};
      await tx.refreshToken.updateMany({
        where: { personId, revokedAt: null, ...exceptTok },
        data: { revokedAt: now, revokedReason: reason },
      });
      const res = await tx.device.updateMany({
        where: { personId, revokedAt: null, ...except },
        data: { revokedAt: now },
      });
      return res.count;
    });
  },

  /**
   * Rotates a refresh token in one transaction. The mark is a single conditional
   * update (rotated_at and revoked_at both null), so of two parallel calls only one wins.
   */
  async rotate(
    tokenHash: string,
    next: { id: string; tokenHash: string; expiresAt: Date }
  ): Promise<
    | { kind: 'INVALID' }
    | { kind: 'SUSPENDED'; personId: string }
    | { kind: 'REUSE'; personId: string; deviceId: string }
    | { kind: 'OK'; personId: string; deviceId: string }
  > {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { device: true, person: { select: { status: true } } },
      });
      if (!token || token.revokedAt || token.device.revokedAt || token.expiresAt <= now) {
        return { kind: 'INVALID' as const };
      }
      const { personId, deviceId } = token;
      if (token.person.status !== 'ACTIVE') return { kind: 'SUSPENDED' as const, personId };
      const marked = await tx.refreshToken.updateMany({
        where: { id: token.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: now },
      });
      if (marked.count === 0) return { kind: 'REUSE' as const, personId, deviceId };
      await tx.refreshToken.create({ data: { ...next, personId, deviceId } });
      return { kind: 'OK' as const, personId, deviceId };
    });
  },

  /** Ends one device and its live tokens (reuse detected). */
  async revokeDevice(deviceId: string, reason: RevokedReason): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.refreshToken.updateMany({
        where: { deviceId, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
      });
      await tx.device.updateMany({
        where: { id: deviceId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  },

  /** Ends one device of one person (id and owner filtered together); false when nothing matched. */
  async revokeOwnDevice(
    personId: string,
    deviceId: string,
    reason: RevokedReason
  ): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const res = await tx.device.updateMany({
        where: { id: deviceId, personId, revokedAt: null },
        data: { revokedAt: now },
      });
      if (res.count === 0) return false;
      await tx.refreshToken.updateMany({
        where: { deviceId, personId, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
      });
      return true;
    });
  },

  /** Live devices of one person, newest first (person filter, v5.0.0-8.2.2). */
  listLive(personId: string) {
    return prisma.device.findMany({
      where: { personId, revokedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        platform: true,
        model: true,
        appVersion: true,
        createdAt: true,
        lastSyncedAt: true,
      },
    });
  },
};
