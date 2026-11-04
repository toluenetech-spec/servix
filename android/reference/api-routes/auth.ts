/**
 * SERVIX Phase B — authentication routes (Phase E: email via job queue,
 * admin bootstrap).
 *
 * Security model:
 *  - scrypt password hashes (OWASP parameters, timing-safe compare)
 *  - Access token: JWT HS256, 15 min, sent in response body (memory-only
 *    on the client — never persisted to localStorage)
 *  - Refresh token: 256-bit opaque value in an httpOnly SameSite=Lax
 *    cookie scoped to /api/v1/auth; stored sha256-hashed; ROTATING with
 *    family reuse detection (a replayed old token revokes the family)
 *  - Email verify / password reset: single-use hashed tokens (24h / 30m)
 *  - Uniform responses on forgot-password (no account enumeration);
 *    generic "invalid credentials" on login failures
 *  - Per-route rate limits on top of the global limiter
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/db.js';
import { loadConfig } from '../lib/config.js';
import { ApiError, unauthorized, validationError } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { resetPasswordPolicy, resetPasswordSchema } from '../lib/passwordPolicy.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  newFamilyId,
  newOpaqueToken,
  oneTimeExpiry,
  refreshExpiry,
  sha256,
  signAccessToken,
} from '../lib/tokens.js';
import { verifyEmailMail, resetPasswordMail } from '../lib/mailer.js';
import { enqueueMail } from '../lib/jobs.js';
import { alertIfNewDevice, clientAddress } from '../lib/loginAlerts.js';
import { serializeUser } from '../lib/serialize.js';
import { requireAuth } from '../lib/authGuard.js';

import { emailOtpEnabled } from '../lib/emailOtpCrypto.js';
import { requestEmailOtp, confirmEmailOtp } from '../lib/emailOtp.js';

import { mfaEnabled } from '../lib/securityCrypto.js';
import { oauthRoutes } from './oauth.js';
import { beginSecurity } from '../lib/securityFlow.js';
import { securityRoutes, requireSecurityOrigin, sendSecurityFlow, strongPasswordSchema } from './security.js';

const config = loadConfig();

const REFRESH_COOKIE = 'servix_refresh';
const COOKIE_OPTS = {
  path: '/api/v1/auth',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.nodeEnv === 'production',
};

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(200, 'Password is too long.');

const registerSchema = z.object({
  fullName: z.string().trim().min(1, 'Please enter your full name.').max(200),
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.').max(320),
  password: strongPasswordSchema,
  accountType: z.enum(['customer', 'professional']).default('customer'),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.'),
  password: z.string().min(1, 'Please enter your password.'),
});

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.'),
});

const verifySchema = z.object({ token: z.string().min(10).max(200) });

const resetSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});

/* ---------------- helpers ---------------- */

async function issueSession(
  reply: FastifyReply,
  user: { id: string; role: string; status: string; authVersion?: number },
  userAgent?: string,
  familyId?: string,
  mfaVerified = false,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const family = familyId ?? newFamilyId();
  const { raw, hash } = newOpaqueToken();
  const session = await db.refreshToken.create({
    data: {
      userId: user.id,
      mfaVerified,
      authVersion: user.authVersion ?? 0,
      tokenHash: hash,
      familyId: family,
      expiresAt: refreshExpiry(),
      userAgent: userAgent?.slice(0, 300),
    },
    select: { id: true },
  });
  // A brand-new session family = a completed sign-in (password, Google or the security-check flow); token
  // rotation passes `familyId` and is never a "new device". Alerting never blocks the sign-in.
  if (!familyId) {
    await alertIfNewDevice(db, { userId: user.id, sessionId: session.id, userAgent, ip: clientAddress(reply.request.headers as Record<string, unknown>, reply.request.ip), log: reply.log });
  }
  reply.setCookie(REFRESH_COOKIE, raw, { ...COOKIE_OPTS, expires: refreshExpiry() });
  const accessToken = await signAccessToken({ sub: user.id, role: user.role, status: user.status, sid: family, mfaVerified, authVersion: user.authVersion ?? 0 });
  return accessToken;
}

async function createOneTimeToken(userId: string, purpose: string, ttlMinutes: number) {
  // Invalidate previous unused tokens for the same purpose.
  await prisma.oneTimeToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });
  const { raw, hash } = newOpaqueToken();
  await prisma.oneTimeToken.create({
    data: { userId, purpose, tokenHash: hash, expiresAt: oneTimeExpiry(ttlMinutes) },
  });
  return raw;
}

/* ---------------- routes ---------------- */

export async function authRoutes(app: FastifyInstance) {
  await oauthRoutes(app);
  await securityRoutes(app, (reply, user, agent) => issueSession(reply, user, agent, undefined, true));
  const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  /* -------- register -------- */
  app.post(
    '/auth/register',
    { config: strictLimit, schema: { tags: ['auth'], summary: 'Create an account' } },
    async (req, reply) => {
      if (mfaEnabled()) requireSecurityOrigin(req);
      const data = parseBody(registerSchema, req.body);

      const existing = await prisma.user.findUnique({ where: { email: data.email } });
      if (existing) {
        throw validationError({ email: 'An account with this email already exists.' });
      }

      const user = await prisma.user.create({
        data: {
          email: data.email,
          fullName: data.fullName,
          passwordHash: await hashPassword(data.password),
          role: data.accountType,
          status: 'pending_verification',
        },
      });

      if (mfaEnabled()) return reply.code(201).send(sendSecurityFlow(reply, await beginSecurity(user.id, 'registration')));

      if (emailOtpEnabled()) {
        await requestEmailOtp(user.id);
      } else {
        const token = await createOneTimeToken(user.id, 'verify_email', 24 * 60);
        await enqueueMail(verifyEmailMail(user.email, token), `verify-${user.id}-${sha256(token).slice(0, 16)}`);
      }

      const accessToken = await issueSession(reply, user, req.headers['user-agent']);
      return reply.code(201).send({ user: serializeUser(user), accessToken });
    },
  );

  /* -------- login -------- */
  app.post(
    '/auth/login',
    { config: strictLimit, schema: { tags: ['auth'], summary: 'Sign in' } },
    async (req, reply) => {
      if (mfaEnabled()) requireSecurityOrigin(req);
      const data = parseBody(loginSchema, req.body);
      const user = await prisma.user.findUnique({ where: { email: data.email } });

      // Uniform failure: never reveal whether the email exists.
      const ok = user && !user.deletedAt && (await verifyPassword(data.password, user.passwordHash));
      if (!ok) throw unauthorized('Incorrect email or password.');
      if (['suspended', 'deactivated'].includes(user.status)) {
        throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended.');
      }

      if (mfaEnabled()) return sendSecurityFlow(reply, await beginSecurity(user.id, 'login'));
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const accessToken = await issueSession(reply, user, req.headers['user-agent']);
      return { user: serializeUser(user), accessToken };
    },
  );

  /* -------- refresh (rotation + reuse detection) -------- */
  app.post(
    '/auth/refresh',
    { schema: { tags: ['auth'], summary: 'Rotate the refresh token, get a new access token' } },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (mfaEnabled() || req.headers.origin) requireSecurityOrigin(req);
      const raw = req.cookies[REFRESH_COOKIE];
      if (!raw) throw unauthorized('No session');
      const found = await prisma.refreshToken.findFirst({ where: { tokenHash: sha256(raw) } });
      if (!found) throw unauthorized('Invalid session');
      // Same lock order as reset/recovery: serialize all session mutations by user.
      const result = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${found.userId} FOR UPDATE`;
        const stored = await tx.refreshToken.findUnique({ where: { id: found.id }, include: { user: { include: { security: true } } } });
        if (!stored) return null;
        const invalid = stored.revokedAt || stored.expiresAt <= new Date() || stored.user.deletedAt ||
          ['suspended', 'deactivated'].includes(stored.user.status) || stored.authVersion !== stored.user.authVersion ||
          (mfaEnabled() && (!stored.mfaVerified || !stored.user.security?.method));
        if (invalid) {
          await tx.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
          // Return rather than throw: family revocation must COMMIT on replay.
          return null;
        }
        await tx.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
        const accessToken = await issueSession(reply, stored.user, req.headers['user-agent'], stored.familyId, stored.mfaVerified, tx);
        return { user: serializeUser(stored.user), accessToken };
      });
      if (!result) {
        reply.clearCookie(REFRESH_COOKIE, COOKIE_OPTS);
        throw unauthorized('Session no longer valid');
      }
      return result;
    },
  );

  /* -------- logout -------- */
  app.post(
    '/auth/logout',
    { schema: { tags: ['auth'], summary: 'End the current session' } },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (mfaEnabled() || req.headers.origin) requireSecurityOrigin(req);
      const raw = req.cookies[REFRESH_COOKIE];
      if (raw) {
        const stored = await prisma.refreshToken.findFirst({ where: { tokenHash: sha256(raw) } });
        if (stored) await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${stored.userId} FOR UPDATE`;
          await tx.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        });
      }
      reply.clearCookie(REFRESH_COOKIE, COOKIE_OPTS);
      return { ok: true };
    },
  );

  app.get('/auth/verification-method', async () => ({ method: emailOtpEnabled() ? 'otp' : 'link' }));
  app.post('/auth/verify-email/code', { config: strictLimit, preHandler: requireAuth }, async (req) => {
    if (mfaEnabled() || !emailOtpEnabled()) throw new ApiError(404, 'NOT_AVAILABLE', 'Code verification is not enabled.');
    const { code } = parseBody(z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the six-digit code.') }), req.body);
    const user = await confirmEmailOtp(req.auth!.sub, code);
    return { user: serializeUser(user) };
  });

  /* -------- email verification -------- */
  app.post(
    '/auth/verify-email',
    { config: strictLimit, schema: { tags: ['auth'], summary: 'Confirm an email address' } },
    async (req) => {
      if (mfaEnabled() || emailOtpEnabled()) throw new ApiError(400, 'OTP_REQUIRED', 'Sign in and request a verification code instead of using a link.');
      const { token } = parseBody(verifySchema, req.body);
      const stored = await prisma.oneTimeToken.findFirst({
        where: { tokenHash: sha256(token), purpose: 'verify_email' },
        include: { user: true },
      });
      if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
        throw new ApiError(400, 'INVALID_TOKEN', 'This verification link is invalid or has expired.');
      }
      await prisma.$transaction([
        prisma.oneTimeToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
        prisma.user.update({
          where: { id: stored.userId },
          data: {
            emailVerifiedAt: new Date(),
            status: stored.user.status === 'pending_verification' ? 'active' : stored.user.status,
          },
        }),
      ]);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: stored.userId } });
      return { user: serializeUser(user) };
    },
  );

  app.post(
    '/auth/verify-email/resend',
    {
      config: { rateLimit: { max: 3, timeWindow: '5 minutes' } },
      preHandler: requireAuth,
      schema: { tags: ['auth'], summary: 'Resend the verification email', security: [{ bearerAuth: [] }] },
    },
    async (req) => {
      const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
      if (!user) throw unauthorized();
      if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
      if (mfaEnabled()) throw new ApiError(400, 'SECURITY_REQUIRED', 'Use the security verification steps.');
      if (emailOtpEnabled()) return requestEmailOtp(user.id);
      const token = await createOneTimeToken(user.id, 'verify_email', 24 * 60);
      await enqueueMail(verifyEmailMail(user.email, token), `verify-${user.id}-${sha256(token).slice(0, 16)}`);
      return { ok: true };
    },
  );

  /* -------- password reset -------- */
  app.post(
    '/auth/forgot-password',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, schema: { tags: ['auth'], summary: 'Request a password reset link' } },
    async (req, reply) => {
      if (mfaEnabled()) requireSecurityOrigin(req);
      const { email } = parseBody(emailSchema, req.body);
      const user = await prisma.user.findUnique({ where: { email } });
      if (mfaEnabled()) {
        // Same response and cookie shape for unknown, blocked and rate-limited accounts.
        let flow;
        try { flow = await beginSecurity(user && !user.deletedAt && !['suspended', 'deactivated'].includes(user.status) ? user.id : null, 'reset'); }
        catch (error) {
          if (!(error instanceof ApiError)) throw error;
          flow = await beginSecurity(null, 'reset');
        }
        flow.email = 'your email address'; flow.method = null;
        return sendSecurityFlow(reply, flow);
      }
      if (user && !user.deletedAt) {
        const token = await createOneTimeToken(user.id, 'reset_password', 30);
        await enqueueMail(resetPasswordMail(user.email, token), `reset-${user.id}-${sha256(token).slice(0, 16)}`);
      }
      // Uniform response regardless of account existence.
      return { ok: true };
    },
  );

  // Only a valid, unconsumed reset token can reveal its password policy.
  app.post('/auth/reset-password/policy', { config: strictLimit }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (mfaEnabled()) throw new ApiError(400, 'SECURITY_REQUIRED', 'Use the security verification flow.');
    const { token } = parseBody(z.object({ token: z.string().min(1).max(512) }), req.body);
    const stored = await prisma.oneTimeToken.findFirst({ where: { tokenHash: sha256(token), purpose: 'reset_password' }, include: { user: true } });
    if (!stored || stored.usedAt || stored.expiresAt <= new Date() || stored.user.deletedAt) {
      throw new ApiError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired.');
    }
    return { passwordPolicy: resetPasswordPolicy(stored.user.role) };
  });

  app.post(
    '/auth/reset-password',
    { config: strictLimit, schema: { tags: ['auth'], summary: 'Set a new password with a reset token' } },
    async (req, reply) => {
      if (mfaEnabled()) throw new ApiError(400, 'SECURITY_REQUIRED', 'Use email and your enrolled security method to reset your password.');
      const { token, password } = parseBody(resetSchema, req.body);
      const stored = await prisma.oneTimeToken.findFirst({
        where: { tokenHash: sha256(token), purpose: 'reset_password' },
      });
      if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
        throw new ApiError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired.');
      }
      const user = await prisma.user.findUnique({ where: { id: stored.userId } });
      if (!user || user.deletedAt) throw new ApiError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired.');
      parseBody(z.object({ password: resetPasswordSchema(user.role) }), { password });
      await prisma.$transaction([
        prisma.oneTimeToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
        prisma.user.update({
          where: { id: stored.userId },
          data: { passwordHash: await hashPassword(password) },
        }),
        // Security: revoke every existing session after a password reset.
        prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
      reply.clearCookie(REFRESH_COOKIE, COOKIE_OPTS);
      return { ok: true };
    },
  );

  /* -------- current user -------- */
  app.get(
    '/me',
    { preHandler: requireAuth, schema: { tags: ['auth'], summary: 'Current authenticated user', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
      if (!user || user.deletedAt) throw unauthorized();
      return { user: serializeUser(user) };
    },
  );
}

/** Phase E: idempotent admin bootstrap from env (server-side only). */
export async function bootstrapAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email) return;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'admin') {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'admin' } });
    }
    return;
  }
  if (!password || password.length < 12) return; // refuse weak bootstrap creds
  await prisma.user.create({
    data: {
      email,
      fullName: 'Servix Admin',
      passwordHash: await hashPassword(password),
      role: 'admin',
      status: 'active',
      emailVerifiedAt: new Date(),
    },
  });
}
