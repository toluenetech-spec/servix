/** Fixed provider endpoints; no caller-controlled URLs or stored provider tokens. */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { mfaEnabled } from './securityCrypto.js';

export type Provider = 'google' | 'github';
export type ProviderIdentity = { provider: Provider; subject: string; email: string; name: string };
export const providers = ['google', 'github'] as const;
export const oauthEnabled = () => mfaEnabled() && process.env.AUTH_OAUTH_ENABLED === 'true';
export function providerConfig(provider: Provider) {
  const prefix = `AUTH_${provider.toUpperCase()}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  const redirectUri = process.env[`${prefix}_REDIRECT_URI`];
  if (!oauthEnabled() || !clientId || !clientSecret || !redirectUri) throw new ApiError(404, 'OAUTH_DISABLED', 'This sign-in provider is not available.');
  return { clientId, clientSecret, redirectUri };
}
export function enabledProviders() {
  return providers.filter(p => { try { providerConfig(p); return true; } catch { return false; } });
}
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
export function authorizationUrl(provider: Provider, state: string, verifier: string, nonce: string) {
  const config = providerConfig(provider);
  const url = new URL(provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://github.com/login/oauth/authorize');
  const params: Record<string, string> = { client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', state,
    scope: provider === 'google' ? 'openid email profile' : 'read:user user:email', code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256' };
  if (provider === 'google') { params.nonce = nonce; params.prompt = 'select_account'; }
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { timeoutDuration: 10_000 });
const emailSchema = z.string().trim().toLowerCase().email().max(320);
const invalid = () => new ApiError(400, 'OAUTH_INVALID', 'Provider verification failed. Please start again.');
export async function verifyGoogleIdentity(token: string, clientId: string, nonce: string, keys: JWTVerifyGetKey = googleKeys): Promise<ProviderIdentity> {
  const { payload } = await jwtVerify(token, keys, { algorithms: ['RS256'], issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId, requiredClaims: ['sub', 'iat', 'exp', 'nonce'], maxTokenAge: '10m', clockTolerance: 5 });
  if (payload.nonce !== nonce || payload.email_verified !== true || !payload.sub || payload.sub.length > 255 ||
      (payload.azp !== undefined && payload.azp !== clientId) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) throw invalid();
  return { provider: 'google', subject: payload.sub, email: emailSchema.parse(payload.email), name: typeof payload.name === 'string' ? payload.name.slice(0, 200) : 'Servix member' };
}
async function providerJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw invalid();
  return response.json();
}
export function githubIdentity(profile: unknown, emails: unknown): ProviderIdentity {
  const person = z.object({ id: z.number().int().positive().safe(), login: z.string().min(1), name: z.string().nullable().optional() }).parse(profile);
  const list = z.array(z.object({ email: z.string(), primary: z.boolean(), verified: z.boolean() })).parse(emails);
  const primary = list.find(v => v.primary && v.verified);
  if (!primary) throw invalid();
  return { provider: 'github', subject: String(person.id), email: emailSchema.parse(primary.email), name: (person.name || person.login).slice(0, 200) };
}
export async function exchangeIdentity(provider: Provider, code: string, verifier: string, nonce: string): Promise<ProviderIdentity> {
  const config = providerConfig(provider);
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier,
    client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri });
  const token = await providerJson(provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (provider === 'google') {
    const value = z.object({ id_token: z.string().min(1).max(32768) }).parse(token);
    return verifyGoogleIdentity(value.id_token, config.clientId, nonce);
  }
  const value = z.object({ access_token: z.string().min(1).max(4096), token_type: z.string().toLowerCase().refine(v => v === 'bearer') }).parse(token);
  const headers = { Authorization: `Bearer ${value.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Servix', 'X-GitHub-Api-Version': '2022-11-28' };
  const profile = await providerJson('https://api.github.com/user', { headers });
  const emails = await providerJson('https://api.github.com/user/emails?per_page=100', { headers });
  return githubIdentity(profile, emails);
}
