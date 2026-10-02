import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

/**
 * JWT payload interface
 */
export interface JwtPayload {
  accountId: string;
  phoneNumber: string;
}

/**
 * Sign an access token JWT. Short-lived and purely stateless — verification
 * never hits the database (see specs/005-refresh-tokens/research.md §1);
 * revocation instead happens at the refresh-token layer.
 */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessTokenExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

const DURATION_UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 60 * 60 * 24,
};

/**
 * Convert a jsonwebtoken-style expiry string (e.g. "15m", "7d", "900") into
 * seconds, so clients can be told exactly how long their access token is
 * valid for without having to parse the JWT themselves.
 */
export function getAccessTokenExpiresInSeconds(): number {
  const value = config.jwt.accessTokenExpiresIn;
  const match = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid ACCESS_TOKEN_EXPIRES_IN value: ${value}`);
  }
  const [, amount, unit] = match;
  return Number(amount) * (unit ? DURATION_UNIT_SECONDS[unit] : 1);
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JwtPayload {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    return decoded;
  } catch {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Decode a JWT token without verification
 * Useful for inspecting expired tokens
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.decode(token) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}
