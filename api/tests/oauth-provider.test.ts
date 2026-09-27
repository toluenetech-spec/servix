import { afterEach, describe, it, expect, vi } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { validateProductionConfig } from '../src/lib/config.js';
import { authorizationUrl, githubIdentity, verifyGoogleIdentity, enabledProviders, exchangeIdentity } from '../src/lib/oauthProvider.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function configure() {
  vi.stubEnv('AUTH_MFA_ENABLED', 'true'); vi.stubEnv('AUTH_OAUTH_ENABLED', 'true');
  for (const provider of ['GOOGLE', 'GITHUB']) {
    vi.stubEnv(`AUTH_${provider}_CLIENT_ID`, 'unit-client'); vi.stubEnv(`AUTH_${provider}_CLIENT_SECRET`, 'unit-secret-not-real');
    vi.stubEnv(`AUTH_${provider}_REDIRECT_URI`, `https://api.servix.name.ng/api/v1/auth/${provider.toLowerCase()}/callback`);
  }
}
describe('provider verification without live provider access', () => {
  it('rejects unsafe production OAuth settings', () => {
    const env = { NODE_ENV: 'production', AUTH_OAUTH_ENABLED: 'true', AUTH_MFA_ENABLED: 'true',
      AUTH_OAUTH_APP_ORIGIN: 'https://www.servix.name.ng', CORS_ORIGINS: 'https://www.servix.name.ng',
      AUTH_GOOGLE_CLIENT_ID: 'test-client', AUTH_GOOGLE_CLIENT_SECRET: 'test-secret', AUTH_GOOGLE_REDIRECT_URI: 'https://api.servix.name.ng/api/v1/auth/google/callback' };
    const relevant = (values: NodeJS.ProcessEnv) => validateProductionConfig(values).filter(v => /OAuth|AUTH_OAUTH|AUTH_GOOGLE|AUTH_GITHUB/.test(v));
    expect(relevant(env)).toEqual([]);
    expect(relevant({ ...env, AUTH_MFA_ENABLED: 'false' })).not.toEqual([]);
    expect(relevant({ ...env, AUTH_OAUTH_APP_ORIGIN: 'https://evil.test' })).not.toEqual([]);
    expect(relevant({ ...env, AUTH_GOOGLE_CLIENT_SECRET: '' })).not.toEqual([]);
    expect(relevant({ ...env, AUTH_GOOGLE_REDIRECT_URI: 'https://api.servix.name.ng/api/v1/auth/google/callback?next=https://evil.test' })).not.toEqual([]);
  });
  it('requires both feature flags and complete credentials', () => {
    configure(); expect(enabledProviders()).toEqual(['google', 'github']);
    vi.stubEnv('AUTH_MFA_ENABLED', 'false'); expect(enabledProviders()).toEqual([]);
    vi.stubEnv('AUTH_MFA_ENABLED', 'true'); vi.stubEnv('AUTH_OAUTH_ENABLED', 'false'); expect(enabledProviders()).toEqual([]);
  });
  it('binds authorization to state, exact callback, S256 and Google nonce', () => {
    configure();
    for (const provider of ['google', 'github'] as const) {
      const url = new URL(authorizationUrl(provider, 'state-test', 'verifier-test', 'nonce-test'));
      expect(url.searchParams.get('state')).toBe('state-test'); expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toHaveLength(43);
      expect(url.searchParams.get('redirect_uri')).toBe(`https://api.servix.name.ng/api/v1/auth/${provider}/callback`);
      expect(url.searchParams.has('client_secret')).toBe(false);
      if (provider === 'google') expect(url.searchParams.get('nonce')).toBe('nonce-test');
    }
  });
  it('validates signed Google issuer, audience, nonce, expiry and verified email', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey); jwk.kid = 'unit';
    const keys = createLocalJWKSet({ keys: [jwk] });
    const sign = (overrides: Record<string, unknown> = {}) => new SignJWT({ sub: 'google-subject', iss: 'https://accounts.google.com', aud: 'unit-client',
      nonce: 'unit-nonce', email: 'Person@example.test', email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid: 'unit' }).sign(privateKey);
    expect((await verifyGoogleIdentity(await sign(), 'unit-client', 'unit-nonce', keys)).email).toBe('person@example.test');
    for (const invalid of [{ iss: 'https://evil.test' }, { aud: 'another-client' }, { nonce: 'wrong' }, { exp: 1 }, { email_verified: false }, { azp: 'another-client' }, { sub: '' }, { aud: ['unit-client', 'other'] }]) {
      await expect(verifyGoogleIdentity(await sign(invalid), 'unit-client', 'unit-nonce', keys)).rejects.toBeDefined();
    }
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'unit' }).sign(other.privateKey);
    await expect(verifyGoogleIdentity(forged, 'unit-client', 'unit-nonce', keys)).rejects.toBeDefined();
  });
  it('uses immutable GitHub ID and only a verified primary email', () => {
    const profile = { id: 42, login: 'renamable', email: 'untrusted@example.test' };
    expect(githubIdentity(profile, [{ email: 'real@example.test', verified: true, primary: true }]).subject).toBe('42');
    expect(() => githubIdentity(profile, [{ email: 'real@example.test', verified: false, primary: true }])).toThrow();
    expect(() => githubIdentity(profile, [{ email: 'real@example.test', verified: true, primary: false }])).toThrow();
  });
  it('exchanges GitHub codes server-side with PKCE and fetches identity using the new token', async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'provider-test-token', token_type: 'bearer' }))
      .mockResolvedValueOnce(Response.json({ id: 51, login: 'person' }))
      .mockResolvedValueOnce(Response.json([{ email: 'verified@example.test', primary: true, verified: true }]));
    vi.stubGlobal('fetch', fetchMock);
    expect((await exchangeIdentity('github', 'test-code', 'test-verifier', 'nonce')).subject).toBe('51');
    expect(fetchMock.mock.calls[0][1].body.get('code_verifier')).toBe('test-verifier');
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer provider-test-token');
  });
  it('fails closed on provider error responses', async () => {
    configure(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'bad_verification_code' })));
    await expect(exchangeIdentity('google', 'bad', 'verifier', 'nonce')).rejects.toBeDefined();
    await expect(exchangeIdentity('github', 'bad', 'verifier', 'nonce')).rejects.toBeDefined();
  });
});
