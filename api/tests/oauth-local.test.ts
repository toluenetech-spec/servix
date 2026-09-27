/** Opt-in integration tests; creates its own loopback DB, never uses Neon. */
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes, generateKeyPairSync, createHash, sign } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type { FastifyInstance } from 'fastify';

const origin = 'https://www.servix.name.ng';
const password = 'Test-Password-Only123!';
describe.skipIf(process.env.RUN_LOCAL_OAUTH_TESTS !== '1')('OAuth, isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let service: typeof import('../src/lib/securityFlow.js');
  let crypto: typeof import('../src/lib/securityCrypto.js');
  let ip = 1;
  let oauth: typeof import('../src/lib/oauth.js');
  let providerModule: typeof import('../src/lib/oauthProvider.js');
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-oauth-test-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55441/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'true';
    process.env.AUTH_OAUTH_ENABLED = 'true';
    process.env.AUTH_OAUTH_APP_ORIGIN = origin;
    for (const provider of ['GOOGLE', 'GITHUB']) {
      process.env[`AUTH_${provider}_CLIENT_ID`] = 'test-client';
      process.env[`AUTH_${provider}_CLIENT_SECRET`] = 'test-client-secret';
      process.env[`AUTH_${provider}_REDIRECT_URI`] = `https://api.servix.name.ng/api/v1/auth/${provider.toLowerCase()}/callback`;
    }
    process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10';
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55441, user: 'postgres', password: dbPassword,
      persistent: false, postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--locale=C', '--lc-messages=C', '--encoding=UTF8'], onLog: () => {}, onError: console.error });
    await cluster.initialise(); await cluster.start();
    const client = cluster.getPgClient(); await client.connect();
    try {
      const root = join(import.meta.dirname, '../prisma/migrations');
      for (const name of (await readdir(root)).sort()) {
        if (name === 'migration_lock.toml') continue;
        await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
      }
    } finally { await client.end(); }
    prisma = (await import('../src/lib/db.js')).prisma;
    service = await import('../src/lib/securityFlow.js'); crypto = await import('../src/lib/securityCrypto.js');
    oauth = await import('../src/lib/oauth.js'); providerModule = await import('../src/lib/oauthProvider.js');
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  afterEach(() => vi.restoreAllMocks());
  const identity = (provider: 'google' | 'github' = 'google') => ({ provider, subject: randomUUID(), email: `${randomUUID()}@example.test`, name: 'Provider Test' });
  const secret = { verifier: 'test-verifier', nonce: 'test-nonce' };
  const post = (path: string, cookie = '', headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: `/api/v1/auth/${path}`, headers: { origin, cookie, ...headers }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });
  async function enrolled() {
    const person = identity(); const flow = await oauth.acceptIdentity(person, secret);
    const setup = await service.prepareTotp(flow.raw);
    const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret), digits: 6, period: 30 }).generate({ timestamp: Date.now() - 30_000 });
    const result = await service.confirmTotpEnrollment(flow.raw, code);
    const user = await service.finishSecurity(flow.raw, true);
    return { person, user, codes: result.recoveryCodes };
  }
  it('binds state to provider/browser and atomically consumes it once', async () => {
    const started = await oauth.startOAuth('google'); const state = new URL(started.url).searchParams.get('state')!;
    await expect(oauth.consumeOAuth('google', state, 'another-browser')).rejects.toBeDefined();
    await expect(oauth.consumeOAuth('github', state, started.browser)).rejects.toBeDefined();
    const results = await Promise.allSettled([oauth.consumeOAuth('google', state, started.browser), oauth.consumeOAuth('google', state, started.browser)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const attempt = await prisma.oAuthAttempt.findUniqueOrThrow({ where: { stateHash: createHash('sha256').update(state).digest('hex') } });
    expect(attempt.envelope).toBeNull(); expect(attempt.usedAt).not.toBeNull();
  });
  it('rejects expired state', async () => {
    const started = await oauth.startOAuth('google'); const state = new URL(started.url).searchParams.get('state')!;
    await prisma.oAuthAttempt.update({ where: { stateHash: createHash('sha256').update(state).digest('hex') }, data: { expiresAt: new Date(0) } });
    await expect(oauth.consumeOAuth('google', state, started.browser)).rejects.toBeDefined();
  });
  it('new provider accounts must prove enrollment; no email code or session is issued', async () => {
    const person = identity(); const flow = await oauth.acceptIdentity(person, secret);
    expect(flow.next).toBe('enroll'); expect(flow.purpose).toBe('social');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: person.email } });
    expect(user.status).toBe('pending_verification'); expect(user.passwordHash).toBe('!oauth-only');
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
    await expect(service.finishSecurity(flow.raw, true)).rejects.toMatchObject({ status: 400 });
  });
  it('existing subject requires saved factor even when provider email changes', async () => {
    const { person, user, codes } = await enrolled();
    const flow = await oauth.acceptIdentity({ ...person, email: 'changed@example.test' }, secret);
    expect(flow.next).toBe('factor'); expect(flow.method).toBe('totp');
    await expect(service.prepareTotp(flow.raw)).rejects.toBeDefined();
    await expect(service.finishSecurity(flow.raw)).rejects.toBeDefined();
    await service.verifySecondFactor(flow.raw, codes[0], true);
    expect((await service.finishSecurity(flow.raw)).id).toBe(user.id);
  });
  it('never joins an existing account by email, including admins', async () => {
    const person = identity(); await prisma.user.create({ data: { email: person.email, fullName: 'Admin', passwordHash: 'not-real', role: 'admin', status: 'active' } });
    await expect(oauth.acceptIdentity(person, secret)).rejects.toMatchObject({ code: 'OAUTH_LINK_REQUIRED' });
    expect(await prisma.oAuthIdentity.count({ where: { subject: person.subject } })).toBe(0);
  });
  it('explicit linking requires an authenticated start and fresh factor before saving', async () => {
    expect((await post('github/link')).statusCode).toBe(401);
    const { user, codes } = await enrolled(); const person = identity('github');
    const flow = await oauth.acceptIdentity(person, { ...secret, linkUserId: user.id, authVersion: user.authVersion });
    expect(flow.purpose).toBe('link'); expect(flow.next).toBe('factor');
    expect(await prisma.oAuthIdentity.count({ where: { subject: person.subject } })).toBe(0);
    await expect(service.finishSecurity(flow.raw)).rejects.toBeDefined();
    await service.verifySecondFactor(flow.raw, codes[0], true); await service.finishSecurity(flow.raw);
    expect((await prisma.oAuthIdentity.findUniqueOrThrow({ where: { provider_subject: { provider: 'github', subject: person.subject } } })).userId).toBe(user.id);
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: 'security.provider_linked' } })).toBe(1);
  });
  it('rejects revoked linking starts, provider conflicts, and suspended accounts', async () => {
    const { person, user } = await enrolled();
    await expect(oauth.acceptIdentity(identity('github'), { ...secret, linkUserId: user.id, authVersion: user.authVersion + 1 })).rejects.toMatchObject({ status: 401 });
    await expect(oauth.acceptIdentity(person, { ...secret, linkUserId: user.id, authVersion: user.authVersion })).rejects.toMatchObject({ status: 409 });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });
    await expect(oauth.acceptIdentity(person, secret)).rejects.toMatchObject({ status: 401 });
  });
  it('guards start origins and callback browser binding; cancellation consumes state', async () => {
    expect((await post('google/start', '', { origin: 'https://evil.test' })).statusCode).toBe(403);
    const started = await post('google/start'); expect(started.statusCode).toBe(200);
    const state = new URL(started.json().url).searchParams.get('state')!;
    const cookie = started.cookies.find(c => c.name === 'servix_oauth_google')!;
    expect(cookie.httpOnly).toBe(true); expect(cookie.path).toBe('/api/v1/auth/google');
    const noBrowser = await app.inject({ url: `/api/v1/auth/google/callback?state=${state}&code=test` });
    expect(noBrowser.headers.location).toBe(`${origin}/login?oauth_error=failed`);
    const cancelled = await app.inject({ url: `/api/v1/auth/google/callback?state=${state}&error=access_denied`, headers: { cookie: `servix_oauth_google=${cookie.value}` } });
    expect(cancelled.headers.location).toBe(`${origin}/login?oauth_error=cancelled`);
    await expect(oauth.consumeOAuth('google', state, cookie.value)).rejects.toBeDefined();
  });
  it('provider identity races create at most one account and binding', async () => {
    const person = identity();
    const results = await Promise.allSettled([oauth.acceptIdentity(person, secret), oauth.acceptIdentity(person, secret)]);
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    expect(await prisma.user.count({ where: { email: person.email } })).toBe(1);
    expect(await prisma.oAuthIdentity.count({ where: { provider: person.provider, subject: person.subject } })).toBe(1);
  });
  it('a different account cannot link another user’s provider', async () => {
    const first = await enrolled(); const second = await enrolled();
    await expect(oauth.acceptIdentity(first.person, { ...secret, linkUserId: second.user.id, authVersion: second.user.authVersion })).rejects.toMatchObject({ status: 409 });
    const binding = await prisma.oAuthIdentity.findUniqueOrThrow({ where: { provider_subject: { provider: first.person.provider, subject: first.person.subject } } });
    expect(binding.userId).toBe(first.user.id);
  });
  it('connection list requires authentication and returns only the signed-in account’s providers', async () => {
    expect((await app.inject({ url: '/api/v1/auth/oauth/connections' })).statusCode).toBe(401);
    const { user } = await enrolled();
    const tokens = await import('../src/lib/tokens.js');
    const sid = randomUUID();
    await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: randomUUID(), familyId: sid, mfaVerified: true, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 60_000) } });
    const token = await tokens.signAccessToken({ sub: user.id, role: user.role, status: user.status, sid, mfaVerified: true, authVersion: user.authVersion });
    const response = await app.inject({ url: '/api/v1/auth/oauth/connections', headers: { authorization: `Bearer ${token}` } });
    expect(response.json()).toEqual({ providers: ['google'] });
  });
  it('callback produces only a restricted cookie and rejects replay (mock provider)', async () => {
    const person = identity(); const exchange = vi.spyOn(providerModule, 'exchangeIdentity').mockResolvedValue(person);
    const started = await post('google/start'); const state = new URL(started.json().url).searchParams.get('state')!;
    const cookie = started.cookies.find(c => c.name === 'servix_oauth_google')!;
    const options = { url: `/api/v1/auth/google/callback?state=${state}&code=mock-code`, headers: { cookie: `servix_oauth_google=${cookie.value}` } };
    const response = await app.inject(options);
    expect(response.headers.location).toBe(`${origin}/security-check`); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.cookies.find(c => c.name === 'servix_security')?.value).toBeTruthy();
    expect(response.cookies.find(c => c.name === 'servix_refresh')?.value).toBeFalsy();
    expect((await app.inject(options)).headers.location).toBe(`${origin}/login?oauth_error=failed`);
    expect(exchange).toHaveBeenCalledTimes(1);
  });
});
