/**
 * SERVIX Phase B — authentication routes.
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
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { loadConfig } from '../lib/config.js';
import { ApiError, unauthorized, validationError } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  newFamilyId,
  newOpaqueToken,
  oneTimeExpiry,
  refreshExpiry,
  sha256,
  signAccessToken,
} from '../lib/tokens.js';
import { sendMail, verifyEmailMail, resetPasswordMail } from '../lib/mailer.js';
import { serializeUser } from '../lib/serialize.js';
import { requireAuth } from '../lib/authGuard.js';

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
  password: passwordSchema,
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
  user: { id: string; role: string; status: string },
  userAgent?: string,
  familyId?: string,
) {
  const family = familyId ?? newFamilyId();
  const { raw, hash } = newOpaqueToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hash,
      familyId: family,
      expiresAt: refreshExpiry(),
      userAgent: userAgent?.slice(0, 300),
    },
  });
  reply.setCookie(REFRESH_COOKIE, raw, { ...COOKIE_OPTS, expires: refreshExpiry() });
  const accessToken = await signAccessToken({ sub: user.id, role: user.role, status: user.status });
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
  const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  /* -------- register -------- */
  app.post(
    '/auth/register',
    { config: strictLimit, schema: { tags: ['auth'], summary: 'Create an account' } },
    async (req, reply) => {
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

      const token = await createOneTimeToken(user.id, 'verify_email', 24 * 60);
      await sendMail(verifyEmailMail(user.email, token));

      const accessToken = await issueSession(reply, user, req.headers['user-agent']);
      return reply.code(201).send({ user: serializeUser(user), accessToken });
    },
  );

  /* -------- login -------- */
  app.post(
    '/auth/login',
    { config: strictLimit, schema: { tags: ['auth'], summary: 'Sign in' } },
    async (req, reply) => {
      const data = parseBody(loginSchema, req.body);
      const user = await prisma.user.findUnique({ where: { email: data.email } });

      // Uniform failure: never reveal whether the email exists.
      const ok = user && !user.deletedAt && (await verifyPassword(data.password, user.passwordHash));
      if (!ok) throw unauthorized('Incorrect email or password.');
      if (user.status === 'suspended') {
        throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended.');
      }

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
      const raw = req.cookies[REFRESH_COOKIE];
      if (!raw) throw unauthorized('No session');

      const stored = await prisma.refreshToken.findFirst({
        where: { tokenHash: sha256(raw) },
        include: { user: true },
      });
      if (!stored) throw unauthorized('Invalid session');

      // Reuse detection: token already rotated/revoked → kill the family.
      if (stored.revokedAt || stored.expiresAt < new Date()) {
        await prisma.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        reply.clearCookie(REFRESH_COOKIE, COOKIE_OPTS);
        throw unauthorized('Session expired');
      }
      if (stored.user.deletedAt || stored.user.status === 'suspended') {
        throw unauthorized('Session no longer valid');
      }

      await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      const accessToken = await issueSession(
        reply,
        stored.user,
        req.headers['user-agent'],
        stored.familyId,
      );
      return { user: serializeUser(stored.user), accessToken };
    },
  );

  /* -------- logout -------- */
  app.post(
    '/auth/logout',
    { schema: { tags: ['auth'], summary: 'End the current session' } },
    async (req, reply) => {
      const raw = req.cookies[REFRESH_COOKIE];
      if (raw) {
        const stored = await prisma.refreshToken.findFirst({ where: { tokenHash: sha256(raw) } });
        if (stored) {
          await prisma.refreshToken.updateMany({
            where: { familyId: stored.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      }
      reply.clearCookie(REFRESH_COOKIE, COOKIE_OPTS);
      return { ok: true };
    },
  );

  /* -------- email verification -------- */
  app.post(
    '/auth/verify-email',
    { config: strictLimit, schema: { tags: ['auth'], summary: 'Confirm an email address' } },
    async (req) => {
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
      const token = await createOneTimeToken(user.id, 'verify_email', 24 * 60);
      await sendMail(verifyEmailMail(user.email, token));
      return { ok: true };
    },
  );

  /* -------- password reset -------- */
  app.post(
    '/auth/forgot-password',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, schema: { tags: ['auth'], summary: 'Request a password reset link' } },
    async (req) => {
      const { email } = parseBody(emailSchema, req.body);
      const user = await prisma.user.findUnique({ where: { email } });
      if (user && !user.deletedAt) {
        const token = await createOneTimeToken(user.id, 'reset_password', 30);
        await sendMail(resetPasswordMail(user.email, token));
      }
      // Uniform response regardless of account existence.
      return { ok: true };
    },
  );

  app.post(
    '/auth/reset-password',
    { config: strictLimit, schema: { tags: ['auth'], summary: 'Set a new password with a reset token' } },
    async (req, reply) => {
      const { token, password } = parseBody(resetSchema, req.body);
      const stored = await prisma.oneTimeToken.findFirst({
        where: { tokenHash: sha256(token), purpose: 'reset_password' },
      });
      if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
        throw new ApiError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired.');
      }
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
