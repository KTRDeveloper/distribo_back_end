import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

/** Identity carried by an access token: the person and the device session. */
export interface AccessTokenIdentity {
  personId: string;
  deviceId: string;
}

/**
 * Sign an access token (HS256): `{ sub, did, typ: 'access' }`, no personal data.
 * Short-lived and stateless; revocation happens at the refresh-token layer.
 */
export function signAccessToken(payload: AccessTokenIdentity): string {
  return jwt.sign({ did: payload.deviceId, typ: 'access' }, config.jwt.secret, {
    algorithm: 'HS256',
    subject: payload.personId,
    expiresIn: config.jwt.accessTokenExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

/** Lifetime of an administration session: fixed, no refresh token (Q-013). */
export const ADMIN_TOKEN_EXPIRES_IN_SECONDS = 15 * 60;

/** Identity carried by an administration token. */
export interface AdminTokenIdentity {
  personId: string;
  administratorId: string;
  role: 'MODERATOR' | 'SUPER_ADMIN';
}

/**
 * Sign an administration token (HS256): `{ sub, adm, role, typ: 'admin' }`, valid 15 minutes.
 * Its `typ` keeps it out of the ordinary routes, as an access token is kept out of admin routes
 * (v5.0.0-9.2.2).
 */
export function signAdminToken(payload: AdminTokenIdentity): string {
  return jwt.sign(
    { adm: payload.administratorId, role: payload.role, typ: 'admin' },
    config.jwt.secret,
    {
      algorithm: 'HS256',
      subject: payload.personId,
      expiresIn: ADMIN_TOKEN_EXPIRES_IN_SECONDS,
    }
  );
}

/**
 * Verify an administration token: signature first, HS256 only, then `typ` must be `admin` and
 * `sub`, `adm` and `role` well formed (v5.0.0-9.1.1, 9.1.2, 9.2.2).
 * @throws Error when the token is invalid, expired or of the wrong type
 */
export function verifyAdminToken(token: string): AdminTokenIdentity {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch {
    throw new Error('Invalid or expired token');
  }
  if (
    typeof decoded === 'string' ||
    decoded.typ !== 'admin' ||
    typeof decoded.sub !== 'string' ||
    !decoded.sub ||
    typeof decoded.adm !== 'string' ||
    !decoded.adm ||
    typeof decoded.role !== 'string' ||
    (decoded.role !== 'MODERATOR' && decoded.role !== 'SUPER_ADMIN')
  ) {
    throw new Error('Invalid or expired token');
  }
  const administratorId: string = decoded.adm;
  const role: AdminTokenIdentity['role'] = decoded.role;
  return { personId: decoded.sub, administratorId, role };
}

/**
 * Transitional shim for callers still using the old signature; the phone number
 * is dropped and a fixed device id is used. Remove once callers move to signAccessToken.
 * @deprecated use signAccessToken
 */
export function signToken(payload: { accountId: string; phoneNumber?: string }): string {
  return signAccessToken({
    personId: payload.accountId,
    deviceId: '00000000-0000-7000-8000-000000000000',
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
 * Verify an access token (v5.0.0-9.1.1, 9.1.2, 9.2.2): signature first, HS256 only,
 * then `sub`, `did` must be strings and `typ` must be `access`.
 * @throws Error when the token is invalid, expired or of the wrong type
 */
export function verifyAccessToken(token: string): AccessTokenIdentity {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch {
    throw new Error('Invalid or expired token');
  }
  if (
    typeof decoded === 'string' ||
    decoded.typ !== 'access' ||
    typeof decoded.sub !== 'string' ||
    !decoded.sub ||
    typeof decoded.did !== 'string' ||
    !decoded.did
  ) {
    throw new Error('Invalid or expired token');
  }
  return { personId: decoded.sub, deviceId: decoded.did };
}

/**
 * Decode a JWT token without verification
 * Useful for inspecting expired tokens
 */
export function decodeToken(token: string): jwt.JwtPayload | null {
  try {
    const decoded = jwt.decode(token) as jwt.JwtPayload | null;
    return decoded;
  } catch {
    return null;
  }
}
