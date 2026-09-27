import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import { requireAuth } from '../lib/authGuard.js';
import { requireSecurityOrigin, sendSecurityFlow } from './security.js';
import { enabledProviders, exchangeIdentity, oauthEnabled, providerConfig, providers } from '../lib/oauthProvider.js';
import { startOAuth, consumeOAuth, acceptIdentity } from '../lib/oauth.js';

export function oauthAppOrigin() {
  const url = new URL(process.env.AUTH_OAUTH_APP_ORIGIN ?? 'https://www.servix.name.ng');
  if (url.protocol !== 'https:' || url.origin !== url.href.replace(/\/$/, '') || url.username || url.password) throw new Error('Invalid OAuth app origin');
  return url.origin;
}
export async function oauthRoutes(app: FastifyInstance) {
  app.get('/auth/oauth/config', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { providers: enabledProviders() };
  });
  app.get('/auth/oauth/connections', { preHandler: requireAuth }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { providers: (await prisma.oAuthIdentity.findMany({ where: { userId: req.auth!.sub }, select: { provider: true } })).map(row => row.provider) };
  });
  for (const provider of providers) {
    const cookie = `servix_oauth_${provider}`;
    const cookieOptions = () => ({ path: `/api/v1/auth/${provider}`, httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' });
    const limit = { rateLimit: { max: 10, timeWindow: '5 minutes' } };
    for (const linking of [false, true]) {
      app.post(`/auth/${provider}/${linking ? 'link' : 'start'}`, { config: limit }, async (req, reply) => {
        reply.header('Cache-Control', 'no-store');
        requireSecurityOrigin(req); providerConfig(provider); oauthAppOrigin();
        if (linking) await requireAuth(req, reply);
        const result = await startOAuth(provider, linking ? { userId: req.auth!.sub, authVersion: req.auth!.authVersion! } : undefined);
        reply.setCookie(cookie, result.browser, { ...cookieOptions(), maxAge: 600 });
        return { url: result.url };
      });
    }
    app.get(`/auth/${provider}/callback`, { config: limit }, async (req, reply) => {
      reply.header('Cache-Control', 'no-store'); reply.header('Referrer-Policy', 'no-referrer');
      reply.clearCookie(cookie, cookieOptions());
      const origin = oauthAppOrigin();
      try {
        if (!oauthEnabled()) throw new ApiError(404, 'OAUTH_DISABLED', 'Provider unavailable.');
        providerConfig(provider);
        const query = z.object({ state: z.string().min(32).max(256), code: z.string().min(1).max(4096).optional(), error: z.string().max(256).optional() }).parse(req.query);
        const browser = req.cookies[cookie];
        if (!browser) throw new ApiError(400, 'OAUTH_INVALID', 'Missing browser binding.');
        const attempt = await consumeOAuth(provider, query.state, browser);
        if (query.error || !query.code) return reply.redirect(`${origin}/login?oauth_error=cancelled`);
        const identity = await exchangeIdentity(provider, query.code, attempt.verifier, attempt.nonce);
        sendSecurityFlow(reply, await acceptIdentity(identity, attempt));
        return reply.redirect(`${origin}/security-check`);
      } catch (error) {
        // Do not log provider responses, authorization codes, tokens or claims.
        const reason = error instanceof ApiError && error.code === 'OAUTH_LINK_REQUIRED' ? 'link_required' : 'failed';
        return reply.redirect(`${origin}/login?oauth_error=${reason}`);
      }
    });
  }
}
