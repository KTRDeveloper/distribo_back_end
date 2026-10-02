declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: {
        id: string;
        phoneNumber: string;
      };
    }
  }
}

export {};
