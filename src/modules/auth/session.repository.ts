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
  async revokeLive(personId: string, reason: RevokedReason, exceptDeviceId?: string): Promise<number> {
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
};
