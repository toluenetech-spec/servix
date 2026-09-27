import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { ApiError, unauthorized } from './errors.js';
import { emailOtpMail } from './mailer.js';
import { emailCodeDigest, generateEmailCode, matchesEmailCode, sealOtpMail } from './emailOtpCrypto.js';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS = 5;
const MAX_ATTEMPTS = 5;

export async function requestEmailOtp(userId: string) {
  return prisma.$transaction(async (tx) => {
    // Serialize both issuing and checking on the same user, even for first send.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || ['suspended', 'deactivated'].includes(user.status)) throw unauthorized();
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true, method: 'otp', retryAfterSeconds: 0 };
    const now = new Date();
    const previous = await tx.emailVerificationOtp.findUnique({ where: { userId } });
    const sameWindow = previous && now.getTime() - previous.windowStart.getTime() < WINDOW_MS;
    if (previous && now.getTime() - previous.sentAt.getTime() < 60_000) {
      throw new ApiError(429, 'OTP_COOLDOWN', 'Please wait 60 seconds before requesting another code.');
    }
    if (sameWindow && (previous.sends >= MAX_SENDS || previous.attempts >= MAX_ATTEMPTS)) {
      throw new ApiError(429, 'OTP_LIMIT', 'Too many attempts or requests. Please try again in one hour.');
    }
    const code = generateEmailCode();
    const nonce = randomUUID();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    const data = { nonce, digest: emailCodeDigest(userId, nonce, code), expiresAt, sentAt: now,
      windowStart: sameWindow ? previous.windowStart : now,
      sends: sameWindow ? previous.sends + 1 : 1,
      attempts: sameWindow ? previous.attempts : 0, usedAt: null };
    await tx.emailVerificationOtp.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await tx.oneTimeToken.updateMany({ where: { userId, purpose: 'verify_email', usedAt: null }, data: { usedAt: now } });
    // Transactional outbox: either the code and email job both exist, or neither.
    await tx.job.create({ data: { queue: 'email', name: 'email.send',
      payload: { encryptedOtpMail: sealOtpMail(emailOtpMail(user.email, code)), otpExpiresAt: expiresAt.toISOString(), otpUserId: userId, otpNonce: nonce },
      idempotencyKey: `verify-otp-${nonce}`, maxAttempts: 5 } });
    return { ok: true, method: 'otp', retryAfterSeconds: 60 };
  });
}

export async function confirmEmailOtp(userId: string, code: string) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || ['suspended', 'deactivated'].includes(user.status)) return { error: 'INVALID' } as const;
    const stored = await tx.emailVerificationOtp.findUnique({ where: { userId } });
    if (!stored || stored.usedAt || stored.expiresAt <= new Date()) return { error: 'EXPIRED' } as const;
    if (stored.attempts >= MAX_ATTEMPTS) return { error: 'LOCKED' } as const;
    // Commit failed-attempt counts; throwing inside this transaction would roll them back.
    await tx.emailVerificationOtp.update({ where: { userId }, data: { attempts: { increment: 1 } } });
    if (!matchesEmailCode(stored.digest, emailCodeDigest(userId, stored.nonce, code))) return { error: 'INVALID' } as const;
    await tx.emailVerificationOtp.update({ where: { userId }, data: { usedAt: new Date() } });
    await tx.oneTimeToken.updateMany({ where: { userId, purpose: 'verify_email', usedAt: null }, data: { usedAt: new Date() } });
    const verified = await tx.user.update({ where: { id: userId }, data: {
      emailVerifiedAt: new Date(), status: user.status === 'pending_verification' ? 'active' : user.status } });
    return { user: verified };
  });
  if ('error' in result) {
    if (result.error === 'LOCKED') throw new ApiError(429, 'OTP_LIMIT', 'Too many incorrect codes. Please try again in one hour.');
    throw new ApiError(400, 'INVALID_OTP', 'That code is incorrect, expired, or already used. Check the newest email or request another code.');
  }
  return result.user;
}
