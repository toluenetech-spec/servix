/**
 * SERVIX API — Phase B authentication integration tests.
 * Requires the running, migrated database. Each run uses unique emails.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { sha256 } from '../src/lib/tokens.js';

let app: FastifyInstance;
const stamp = Date.now();
const EMAIL = `user-${stamp}@test.servix`;
const PASSWORD = 'correct-horse-battery';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.servix' } } });
  await app.close();
});

const post = (url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload, headers });

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((x) => x.name === 'servix_refresh');
  return c ? `servix_refresh=${c.value}` : '';
}

/* ---------------- register ---------------- */
describe('POST /api/v1/auth/register', () => {
  it('creates an account, returns user + access token, sets refresh cookie', async () => {
    const res = await post('/api/v1/auth/register', {
      fullName: 'Ada Test',
      email: EMAIL,
      password: PASSWORD,
      accountType: 'customer',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({
      email: EMAIL,
      fullName: 'Ada Test',
      role: 'customer',
      status: 'pending_verification',
      emailVerified: false,
    });
    expect(body.accessToken).toMatch(/^eyJ/);
    expect(body.user).not.toHaveProperty('passwordHash');
    const cookie = res.cookies.find((c) => c.name === 'servix_refresh');
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.path).toBe('/api/v1/auth');
  });

  it('stores the password hashed (scrypt), never plaintext', async () => {
    const user = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(user!.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(user!.passwordHash).not.toContain(PASSWORD);
  });

  it('rejects a duplicate email with a field error', async () => {
    const res = await post('/api/v1/auth/register', {
      fullName: 'Dup',
      email: EMAIL,
      password: PASSWORD,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.errors.email).toContain('already exists');
  });

  it('validates the body (short password, bad email, missing name)', async () => {
    const res = await post('/api/v1/auth/register', {
      fullName: '',
      email: 'not-an-email',
      password: 'short',
    });
    expect(res.statusCode).toBe(422);
    const errors = res.json().error.errors;
    expect(errors.fullName).toBeDefined();
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
  });

  it('registers professionals with the professional role', async () => {
    const res = await post('/api/v1/auth/register', {
      fullName: 'Pro Test',
      email: `pro-${stamp}@test.servix`,
      password: PASSWORD,
      accountType: 'professional',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe('professional');
  });
});

/* ---------------- login ---------------- */
describe('POST /api/v1/auth/login', () => {
  it('authenticates valid credentials', async () => {
    const res = await post('/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(EMAIL);
    expect(res.json().accessToken).toMatch(/^eyJ/);
  });

  it('rejects a wrong password with a generic message', async () => {
    const res = await post('/api/v1/auth/login', { email: EMAIL, password: 'wrong-password' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Incorrect email or password.');
  });

  it('rejects an unknown email with the SAME generic message (no enumeration)', async () => {
    const res = await post('/api/v1/auth/login', {
      email: `ghost-${stamp}@test.servix`,
      password: 'whatever123',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Incorrect email or password.');
  });
});

/* ---------------- /me + access token ---------------- */
describe('GET /api/v1/me', () => {
  it('returns the current user with a valid Bearer token', async () => {
    const login = await post('/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
    const token = login.json().accessToken;
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(EMAIL);
  });

  it('401s without a token and with a garbage token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: { authorization: 'Bearer garbage.token.here' },
        })
      ).statusCode,
    ).toBe(401);
  });
});

/* ---------------- refresh rotation + reuse detection ---------------- */
describe('POST /api/v1/auth/refresh', () => {
  it('rotates the refresh token and returns a new access token', async () => {
    const login = await post('/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
    const cookie1 = cookieOf(login);

    const r1 = await post('/api/v1/auth/refresh', undefined, { cookie: cookie1 });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().accessToken).toMatch(/^eyJ/);
    const cookie2 = cookieOf(r1);
    expect(cookie2).not.toBe(cookie1);

    // The new cookie works…
    const r2 = await post('/api/v1/auth/refresh', undefined, { cookie: cookie2 });
    expect(r2.statusCode).toBe(200);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const login = await post('/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
    const oldCookie = cookieOf(login);

    const rotated = await post('/api/v1/auth/refresh', undefined, { cookie: oldCookie });
    expect(rotated.statusCode).toBe(200);
    const newCookie = cookieOf(rotated);

    // Replay the OLD token → 401 and the family dies.
    const replay = await post('/api/v1/auth/refresh', undefined, { cookie: oldCookie });
    expect(replay.statusCode).toBe(401);

    // Even the NEW token is now dead (family revoked).
    const afterBreach = await post('/api/v1/auth/refresh', undefined, { cookie: newCookie });
    expect(afterBreach.statusCode).toBe(401);
  });

  it('401s with no cookie', async () => {
    expect((await post('/api/v1/auth/refresh')).statusCode).toBe(401);
  });
});

/* ---------------- logout ---------------- */
describe('POST /api/v1/auth/logout', () => {
  it('revokes the session; refresh no longer works', async () => {
    const login = await post('/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
    const cookie = cookieOf(login);
    const out = await post('/api/v1/auth/logout', undefined, { cookie });
    expect(out.statusCode).toBe(200);
    const refresh = await post('/api/v1/auth/refresh', undefined, { cookie });
    expect(refresh.statusCode).toBe(401);
  });
});

/* ---------------- email verification ---------------- */
describe('email verification', () => {
  it('verifies with a valid token and activates the account; token is single-use', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    // Grab the latest unused token straight from the DB (email transport is queued).
    const ott = await prisma.oneTimeToken.findFirst({
      where: { userId: user.id, purpose: 'verify_email', usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(ott).toBeDefined();
    // We only have the hash — issue a fresh one through the API to get a raw token.
    const login = await post('/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
    const token = login.json().accessToken;
    await post('/api/v1/auth/verify-email/resend', undefined, {
      authorization: `Bearer ${token}`,
    });
    // The resend invalidated priors and made a new one — read raw from mail?
    // Queued transport doesn't expose raw here, so simulate the link by
    // inserting a known token hash (same code path as production).
    const raw = `test-verify-${stamp}`;
    await prisma.oneTimeToken.create({
      data: {
        userId: user.id,
        purpose: 'verify_email',
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const res = await post('/api/v1/auth/verify-email', { token: raw });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.emailVerified).toBe(true);
    expect(res.json().user.status).toBe('active');

    // Single use: second attempt fails.
    const again = await post('/api/v1/auth/verify-email', { token: raw });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('INVALID_TOKEN');
  });

  it('rejects unknown and expired tokens', async () => {
    expect((await post('/api/v1/auth/verify-email', { token: 'unknown-token-xyz' })).statusCode).toBe(400);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const raw = `expired-${stamp}`;
    await prisma.oneTimeToken.create({
      data: {
        userId: user.id,
        purpose: 'verify_email',
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect((await post('/api/v1/auth/verify-email', { token: raw })).statusCode).toBe(400);
  });
});

/* ---------------- password reset ---------------- */
describe('password reset', () => {
  it('forgot-password returns the SAME response for existing and unknown emails', async () => {
    const a = await post('/api/v1/auth/forgot-password', { email: EMAIL });
    const b = await post('/api/v1/auth/forgot-password', {
      email: `ghost-${stamp}@test.servix`,
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
  });

  it('resets the password, invalidates the token and revokes all sessions', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const login = await post('/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
    const preCookie = cookieOf(login);

    const raw = `reset-${stamp}`;
    await prisma.oneTimeToken.create({
      data: {
        userId: user.id,
        purpose: 'reset_password',
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const NEW_PASSWORD = 'brand-new-password-1';
    const res = await post('/api/v1/auth/reset-password', { token: raw, password: NEW_PASSWORD });
    expect(res.statusCode).toBe(200);

    // Old password dead, new one works.
    expect(
      (await post('/api/v1/auth/login', { email: EMAIL, password: PASSWORD })).statusCode,
    ).toBe(401);
    expect(
      (await post('/api/v1/auth/login', { email: EMAIL, password: NEW_PASSWORD })).statusCode,
    ).toBe(200);

    // Pre-reset session revoked.
    expect((await post('/api/v1/auth/refresh', undefined, { cookie: preCookie })).statusCode).toBe(401);

    // Token single-use.
    expect(
      (await post('/api/v1/auth/reset-password', { token: raw, password: 'yet-another-99' }))
        .statusCode,
    ).toBe(400);
  });

  it('validates the new password strength', async () => {
    const res = await post('/api/v1/auth/reset-password', { token: 'x'.repeat(20), password: 'short' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.errors.password).toBeDefined();
  });
});

/* ---------------- security headers / CORS for auth ---------------- */
describe('auth CORS', () => {
  it('allows credentials from the frontend origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: {
        origin: 'https://servix-two.vercel.app',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-origin']).toBe('https://servix-two.vercel.app');
  });
});
