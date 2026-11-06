import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import { requireAuth } from '../lib/authGuard.js';
import { nativeClientIds, requireSecurityOrigin, sendSecurityFlow } from './security.js';
import { parseBody } from '../lib/query.js';
import { enabledProviders, exchangeIdentity, oauthEnabled, providerConfig, providers } from '../lib/oauthProvider.js';
import { startOAuth, consumeOAuth, acceptIdentity, createNativeHandoff, consumeNativeHandoff } from '../lib/oauth.js';

export function oauthAppOrigin() {
  const url = new URL(process.env.AUTH_OAUTH_APP_ORIGIN ?? 'https://www.servix.name.ng');
  if (url.protocol !== 'https:' || url.origin !== url.href.replace(/\/$/, '') || url.username || url.password) throw new Error('Invalid OAuth app origin');
  return url.origin;
}
/** Where the native app receives the one-time ticket (custom scheme or verified App Link). Fixed by env, never by the request. */
export function nativeOAuthRedirect() {
  const raw = process.env.NATIVE_OAUTH_REDIRECT ?? 'ng.name.servix.app://oauth/callback';
  const url = new URL(raw);
  if (url.search || url.hash || url.username || url.password) throw new Error('Invalid native OAuth redirect');
  return url.href;
}
const nativeTarget = (params: Record<string, string>) => `${nativeOAuthRedirect()}?${new URLSearchParams(params).toString()}`;
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
    /* Native app: the system browser opens this URL directly so the browser-binding cookie lives in that browser.
     * Creating an attempt is harmless (rate limited, single use), so no Origin check applies to this GET. */
    app.get(`/auth/${provider}/native/start`, { config: limit, schema: { tags: ['auth'], summary: 'Native app: begin provider sign-in in the system browser' } }, async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { client } = z.object({ client: z.string().min(3).max(200) }).parse(req.query ?? {});
      if (!nativeClientIds().includes(client)) throw new ApiError(403, 'ORIGIN_REJECTED', 'Unknown client.');
      providerConfig(provider); nativeOAuthRedirect();
      const result = await startOAuth(provider, undefined, { native: true });
      reply.setCookie(cookie, result.browser, { ...cookieOptions(), maxAge: 600 });
      return reply.redirect(result.url);
    });
    app.get(`/auth/${provider}/callback`, { config: limit }, async (req, reply) => {
      reply.header('Cache-Control', 'no-store'); reply.header('Referrer-Policy', 'no-referrer');
      reply.clearCookie(cookie, cookieOptions());
      const origin = oauthAppOrigin();
      let native = false;
      try {
        if (!oauthEnabled()) throw new ApiError(404, 'OAUTH_DISABLED', 'Provider unavailable.');
        providerConfig(provider);
        const query = z.object({ state: z.string().min(32).max(256), code: z.string().min(1).max(4096).optional(), error: z.string().max(256).optional() }).parse(req.query);
        const browser = req.cookies[cookie];
        if (!browser) throw new ApiError(400, 'OAUTH_INVALID', 'Missing browser binding.');
        const attempt = await consumeOAuth(provider, query.state, browser);
        native = Boolean(attempt.native);
        if (query.error || !query.code) return reply.redirect(native ? nativeTarget({ provider, error: 'cancelled' }) : `${origin}/login?oauth_error=cancelled`);
        const identity = await exchangeIdentity(provider, query.code, attempt.verifier, attempt.nonce);
        const flow = await acceptIdentity(identity, attempt);
        if (native) return reply.redirect(nativeTarget({ provider, ticket: await createNativeHandoff(flow) }));
        sendSecurityFlow(reply, flow);
        return reply.redirect(`${origin}/security-check`);
      } catch (error) {
        // Do not log provider responses, authorization codes, tokens or claims.
        const reason = error instanceof ApiError && error.code === 'OAUTH_LINK_REQUIRED' ? 'link_required' : 'failed';
        return reply.redirect(native ? nativeTarget({ provider, error: reason }) : `${origin}/login?oauth_error=${reason}`);
      }
    });
  }
  /* Native app: trade the one-time ticket for the normal security-flow response (sets `servix_security` in the app's cookie jar). */
  app.post('/auth/oauth/native/exchange', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } }, schema: { tags: ['auth'], summary: 'Native app: exchange provider sign-in ticket for the security flow' } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    requireSecurityOrigin(req);
    const { ticket } = parseBody(z.object({ ticket: z.string().min(32).max(128) }), req.body);
    return sendSecurityFlow(reply, await consumeNativeHandoff(ticket));
  });
}
