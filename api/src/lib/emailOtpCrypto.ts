import { createHmac, randomInt, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

export const emailOtpEnabled = () => process.env.EMAIL_VERIFICATION_OTP === 'true';
function key(label: string): Buffer {
  const secret = process.env.EMAIL_OTP_SECRET ?? '';
  if (secret.length < 32) throw new Error('EMAIL_OTP_SECRET must contain at least 32 characters');
  return createHmac('sha256', secret).update(`servix-email-otp:${label}`).digest();
}
export const generateEmailCode = () => randomInt(0, 1_000_000).toString().padStart(6, '0');
export const emailCodeDigest = (userId: string, nonce: string, code: string) =>
  createHmac('sha256', key('digest')).update(JSON.stringify(['verify_email', userId, nonce, code])).digest('hex');
export function matchesEmailCode(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}
// Queue messages contain an encrypted mail envelope, never a plaintext OTP.
export function sealOtpMail(mail: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key('mail'), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(mail), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((v) => v.toString('base64url')).join('.');
}
export function openOtpMail(value: string): unknown {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted mail');
  const [iv, tag, encrypted] = parts.map((v) => Buffer.from(v, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key('mail'), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
}
