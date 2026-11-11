import { createHmac } from 'node:crypto';
import { config } from '../config/index.js';

/**
 * Fingerprint of an Android id: HMAC-SHA256 keyed by the server key (ANDROID_ID_HASH_KEY) over
 * `personId:androidId`, as lowercase hex (ASVS v5.0.0-11.2.1, v5.0.0-13.3.1).
 * The person id is part of the input so two accounts never share a fingerprint for one phone;
 * the key stops anyone with database access from brute-forcing the short Android id space.
 * Never log the key, the Android id or the result.
 */
export function hashAndroidId(personId: string, androidId: string): string {
  return createHmac('sha256', config.auth.androidIdHashKey)
    .update(`${personId}:${androidId}`)
    .digest('hex');
}
