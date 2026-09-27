import { createHmac, createCipheriv, createDecipheriv, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import * as OTPAuth from 'otpauth';

export const mfaEnabled = () => process.env.AUTH_MFA_ENABLED === 'true';
function key(context: string) {
  const secret = process.env.AUTH_SECURITY_SECRET ?? '';
  if (secret.length < 32) throw new Error('AUTH_SECURITY_SECRET must be at least 32 characters');
  return createHmac('sha256', secret).update(`servix-security:${context}`).digest();
}
export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key('encryption'), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(v => v.toString('base64url')).join('.');
}
export function unseal<T>(value: string): T {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted security value');
  const [iv, tag, data] = parts.map(v => Buffer.from(v, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key('encryption'), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}
export function securityDigest(purpose: string, owner: string, value: string) {
  return createHmac('sha256', key('digest')).update(JSON.stringify([purpose, owner, value])).digest('hex');
}
export function equalDigest(a: string, b: string) {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
export const randomCode = () => randomInt(0, 1_000_000).toString().padStart(6, '0');
export const recoveryCodes = () => Array.from({ length: 8 }, () => randomBytes(12).toString('hex').match(/.{1,6}/g)!.join('-'));
export const normalizeRecovery = (code: string) => code.replace(/[-\s]/g, '').toLowerCase();
export function newTotp(email: string) {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({ issuer: 'Servix', label: email, algorithm: 'SHA1', digits: 6, period: 30, secret });
  return { secret: secret.base32, uri: totp.toString() };
}
export function verifyTotp(secret: string, token: string, lastStep: number, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(token)) return null;
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 });
  const delta = totp.validate({ token, timestamp: now, window: 1 });
  if (delta === null) return null;
  const step = Math.floor(now / 30_000) + delta;
  return step > lastStep ? step : null;
}
