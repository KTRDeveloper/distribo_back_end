import { JwtPayload } from '../lib/jwt.js';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: {
        id: string;
        email: string;
      };
    }
  }
}

export {};
