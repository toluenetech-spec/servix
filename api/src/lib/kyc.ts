/**
 * KYC helpers — everything privacy-sensitive about identity verification
 * lives here so the route file stays readable:
 *
 *  - ID numbers: encrypted at rest with AES-256-GCM (seal/unseal, keyed from
 *    AUTH_SECURITY_SECRET) plus an HMAC digest so the same document cannot be
 *    attached to two accounts without ever storing the number in clear.
 *  - Files: stored under private keys `kyc/<userId>/<part>-<uuid>.<ext>` that
 *    are NOT served by /media (that route only accepts public upload kinds).
 *    Admins get short-lived signed URLs (20 minutes) to GET /kyc/files/<token>.
 *  - Server-side MIME inspection by magic bytes — the declared Content-Type
 *    must match what the bytes actually are.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { seal, unseal, securityDigest } from './securityCrypto.js';

export const KYC_DOCUMENT_TYPES = ['nin_slip', 'international_passport', 'voters_card', 'drivers_license'] as const;
export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];
export const KYC_DOCUMENT_LABELS: Record<KycDocumentType, string> = {
  nin_slip: 'NIN slip',
  international_passport: 'International passport',
  voters_card: "Voter's card",
  drivers_license: "Driver's licence",
};

export const KYC_PARTS = ['document', 'selfie'] as const;
export type KycPart = (typeof KYC_PARTS)[number];

export const KYC_MAX_BYTES = 5 * 1024 * 1024;
export const KYC_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
export const KYC_DOCUMENT_TYPES_ALLOWING_PDF: KycDocumentType[] = ['nin_slip'];
export const KYC_SIGNED_URL_TTL_SECONDS = 20 * 60;

export const KYC_REJECTION_REASONS = [
  'Document blurry',
  'Name mismatch',
  'Selfie does not match ID',
  'Expired document',
] as const;

/** Magic-byte sniffing: returns the real type or null when unrecognised. */
export function sniffMime(bytes: Buffer): 'image/jpeg' | 'image/png' | 'application/pdf' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

export function kycExtension(mime: string): string {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'pdf';
}

export function kycFileKey(userId: string, part: KycPart, mime: string): string {
  return `kyc/${userId}/${part}-${randomUUID()}.${kycExtension(mime)}`;
}

const KEY_RE = /^kyc\/([0-9a-f-]{36})\/(document|selfie)-[0-9a-f-]{36}\.(jpg|png|pdf)$/;

/** True when `key` is one of our KYC keys and belongs to `userId`. */
export function ownsKycKey(key: string, userId: string, part?: KycPart): boolean {
  const m = KEY_RE.exec(key);
  if (!m) return false;
  if (m[1] !== userId) return false;
  if (part && m[2] !== part) return false;
  return true;
}

export function isKycKey(key: string): boolean {
  return KEY_RE.test(key);
}

/* ---------- ID number at rest ---------- */

export function normalizeIdNumber(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export function encryptIdNumber(value: string): string {
  return seal({ v: value });
}

export function decryptIdNumber(sealed: string): string {
  try {
    return unseal<{ v: string }>(sealed).v;
  } catch {
    return '';
  }
}

/** Last 4 characters only — safe for lists and notifications. */
export function maskIdNumber(value: string): string {
  if (!value) return '';
  const tail = value.slice(-4);
  return `${'•'.repeat(Math.max(0, Math.min(8, value.length - 4)))}${tail}`;
}

export function idNumberDigest(documentType: KycDocumentType, normalized: string): string {
  return securityDigest('kyc-id-number', documentType, normalized);
}

/* ---------- signed file URLs ---------- */

function signingKey(): Buffer {
  const secret = process.env.AUTH_SECURITY_SECRET ?? '';
  if (secret.length < 32) throw new Error('AUTH_SECURITY_SECRET must be at least 32 characters');
  return createHmac('sha256', secret).update('servix-kyc:file-url').digest();
}

export interface KycFileToken {
  key: string;
  exp: number; // unix seconds
  by: string; // admin user id
}

export function signKycFileToken(payload: KycFileToken): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', signingKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Returns the payload when the signature is valid and not expired, else null. */
export function verifyKycFileToken(token: string, now = Date.now()): KycFileToken | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  const expected = createHmac('sha256', signingKey()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: KycFileToken;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.key !== 'string' || typeof payload.exp !== 'number' || typeof payload.by !== 'string') return null;
  if (!isKycKey(payload.key)) return null;
  if (payload.exp * 1000 <= now) return null;
  return payload;
}
