/**
 * Token utilities.
 *
 * Access tokens:  JWT HS256 (jose), 15 min TTL, carries sub/role/status.
 * Refresh tokens: 256-bit random, stored HASHED (sha256) in DB, rotating
 *                 families with reuse detection — presenting an already-
 *                 rotated token revokes the entire family.
 * One-time tokens (email verify / password reset): 256-bit random,
 *                 sha256-hashed at rest, single-use, short TTL.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { loadConfig } from './config.js';

const config = loadConfig();
const secret = new TextEncoder().encode(config.authJwtSecret);

export interface AccessClaims {
  sub: string;
  role: string;
  status: string;
  sid?: string;
  mfaVerified?: boolean;
  authVersion?: number;
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role, status: claims.status, sid: claims.sid, mfaVerified: claims.mfaVerified ?? false, authVersion: claims.authVersion ?? 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer('servix-api')
    .setAudience('servix-app')
    .setIssuedAt()
    .setExpirationTime(`${config.accessTtlMin}m`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: 'servix-api',
      audience: 'servix-app',
    });
    if (!payload.sub) return null;
    return { sub: payload.sub, sid: typeof payload.sid === 'string' ? payload.sid : undefined, role: String(payload.role), status: String(payload.status), mfaVerified: payload.mfaVerified === true, authVersion: typeof payload.authVersion === 'number' ? payload.authVersion : 0 };
  } catch {
    return null;
  }
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function newOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: sha256(raw) };
}

export const newFamilyId = () => randomUUID();

export function refreshExpiry(): Date {
  return new Date(Date.now() + config.refreshTtlDays * 24 * 60 * 60 * 1000);
}

export function oneTimeExpiry(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}
