import type { Role } from '../shared/access/roles.js';

export type Actor = {
  personId: string;
  organizationId: string;
  role: Role;
};

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: {
        id: string;
        deviceId: string;
      };
      actor?: Actor;
      /** Set by adminAuthMiddleware: the live administrator behind an admin token. */
      admin?: {
        personId: string;
        administratorId: string;
        role: 'MODERATOR' | 'SUPER_ADMIN';
      };
    }
  }
}

export {};
