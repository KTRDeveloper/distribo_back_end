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
        phoneNumber: string;
      };
      actor?: Actor;
    }
  }
}

export {};
