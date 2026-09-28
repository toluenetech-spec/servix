import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { User } from '../generated/prisma/client.js';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { ApiError, unauthorized } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { basicPasswordSchema } from '../lib/passwordPolicy.js';
export { strongPasswordSchema } from '../lib/passwordPolicy.js';
import { serializeUser } from '../lib/serialize.js';
import { mfaEnabled } from '../lib/securityCrypto.js';
import * as security from '../lib/securityFlow.js';

export const FLOW_COOKIE = 'servix_security';
export const flowCookieOptions = () => ({ path: '/api/v1/auth', httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' });
export function requireSecurityOrigin(req: FastifyRequest) {
  const allowed = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map(v => v.trim()).filter(Boolean);
  if (!req.headers.origin || !allowed.includes(req.headers.origin)) throw new ApiError(403, 'ORIGIN_REJECTED', 'Open Servix from its trusted website to continue.');
}
export function sendSecurityFlow(reply: FastifyReply, flow: Awaited<ReturnType<typeof security.beginSecurity>>) {
  const { raw, ...state } = flow;
  reply.header('Cache-Control', 'no-store');
  reply.setCookie(FLOW_COOKIE, raw, { ...flowCookieOptions(), maxAge: 15 * 60 });
  // The restricted cookie is never a normal application session.
  reply.clearCookie('servix_refresh', flowCookieOptions());
  return { security: state };
}

export async function securityRoutes(app: FastifyInstance, issue: (reply: FastifyReply, user: User, userAgent?: string) => Promise<string>) {
  app.get('/auth/security/config', async () => ({ enabled: mfaEnabled() }));
  // Encapsulate hooks so the existing API is untouched when disabled.
  await app.register(async scoped => {
    scoped.addHook('preHandler', async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!mfaEnabled()) throw new ApiError(404, 'NOT_AVAILABLE', 'Security enrollment is not enabled.');
      requireSecurityOrigin(req);
      if (!req.cookies[FLOW_COOKIE]) throw unauthorized('Your verification session expired. Start again.');
    });
    const opts = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };
    const raw = (req: FastifyRequest) => req.cookies[FLOW_COOKIE]!;
    const code = (req: FastifyRequest) => parseBody(z.object({ code: z.string().regex(/^\d{6}$/, 'Enter six digits.') }), req.body).code;
    scoped.post('/auth/security/status', opts, async req => security.securityStatus(raw(req)));
    scoped.post('/auth/security/email/resend', { config: { rateLimit: { max: 5, timeWindow: '5 minutes' } } }, async req => security.resendSecurityCode(raw(req)));
    scoped.post('/auth/security/email/verify', opts, async req => security.verifySecurityEmail(raw(req), code(req)));
    scoped.post('/auth/security/totp/setup', opts, async req => security.prepareTotp(raw(req)));
    scoped.post('/auth/security/totp/enroll', opts, async req => security.confirmTotpEnrollment(raw(req), code(req)));
    scoped.post('/auth/security/totp/verify', opts, async req => security.verifySecondFactor(raw(req), code(req)));
    scoped.post('/auth/security/passkey/options', opts, async req => security.preparePasskey(raw(req)));
    scoped.post('/auth/security/passkey/verify', opts, async req => {
      const { response } = parseBody(z.object({ response: z.object({ id: z.string().min(1).max(2048) }).passthrough() }), req.body);
      return security.confirmPasskey(raw(req), response as unknown as RegistrationResponseJSON | AuthenticationResponseJSON);
    });
    scoped.post('/auth/security/recovery/codes', opts, async req => security.readRecoveryCodes(raw(req)));
    scoped.post('/auth/security/recovery/verify', opts, async req => {
      const { code } = parseBody(z.object({ code: z.string().min(20).max(64) }), req.body);
      return security.verifySecondFactor(raw(req), code, true);
    });
    scoped.post('/auth/security/finish', opts, async (req, reply) => {
      const { savedRecovery } = parseBody(z.object({ savedRecovery: z.boolean().default(false) }), req.body ?? {});
      const user = await security.finishSecurity(raw(req), savedRecovery);
      const accessToken = await issue(reply, user, req.headers['user-agent']);
      reply.clearCookie(FLOW_COOKIE, flowCookieOptions());
      return { user: serializeUser(user), accessToken };
    });
    scoped.post('/auth/security/reset-password', opts, async (req, reply) => {
      const { password } = parseBody(z.object({ password: basicPasswordSchema }), req.body);
      // Validate stage BEFORE expensive password hashing.
      const state = await security.securityStatus(raw(req));
      if (state.next !== 'reset_password') throw new ApiError(400, 'SECURITY_INVALID', 'Complete verification before choosing a new password.');
      const result = await security.resetSecurityPassword(raw(req), password);
      reply.clearCookie(FLOW_COOKIE, flowCookieOptions());
      reply.clearCookie('servix_refresh', flowCookieOptions());
      return result;
    });
    scoped.post('/auth/security/cancel', opts, async (req, reply) => {
      await security.cancelSecurity(raw(req));
      reply.clearCookie(FLOW_COOKIE, flowCookieOptions());
      return { ok: true };
    });
  });
}
