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
    }
  }
}

export {};
