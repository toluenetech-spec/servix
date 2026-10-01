/** Opt-in integration tests; creates its own loopback DB, never uses Neon. */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const origin = 'https://www.servix.name.ng';
describe.skipIf(process.env.RUN_LOCAL_ONBOARDING_TESTS !== '1')('account dashboard and onboarding, isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let ip = 1;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-security-test-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55445/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'false';
    process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10';
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55445, user: 'postgres', password: dbPassword,
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
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  async function account(provider: 'google' | 'github' | null = 'google', role: 'customer' | 'professional' | 'admin' = 'customer') {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, fullName: 'Test', passwordHash: '!oauth-only', role, status: 'active', emailVerifiedAt: new Date() } });
    if (provider) await prisma.oAuthIdentity.create({ data: { provider, subject: randomUUID(), userId: user.id } });
    const token = await (await import('../src/lib/tokens.js')).signAccessToken({ sub: user.id, role, status: 'active' });
    return { user, token };
  }
  const call = (token: string, path: string, body?: object) => app.inject({ method: body ? 'POST' : 'GET', url: `/api/v1/${path}`, payload: body, headers: { authorization: `Bearer ${token}` }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });
  for (const provider of ['google', 'github'] as const) it(`${provider} choice is saved once and never grants professional privileges`, async () => {
    const { user, token } = await account(provider);
    const first = await call(token, 'account/overview');expect(first.json().needsChoice).toBe(true);expect(first.headers['cache-control']).toBe('no-store');
    const selected = await call(token, 'account/onboarding', { intent: 'professional' });
    expect(selected.json()).toMatchObject({ kind: 'applicant', needsChoice: false, canManageServices: false });
    expect((await call(token, 'account/overview')).json().kind).toBe('applicant');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('customer');
    expect((await call(token, 'pro/profile')).statusCode).toBe(403);
    expect((await call(token, 'account/onboarding', { intent: 'customer' })).json().kind).toBe('applicant');
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: 'account.onboarding_selected' } })).toBe(1);
  });
  it('customer choice persists, and a later application is visible', async () => {
    const { user, token } = await account();
    expect((await call(token, 'account/onboarding', { intent: 'customer' })).json()).toMatchObject({ kind: 'customer', needsChoice: false });
    await prisma.professionalApplication.create({ data: { userId: user.id, title: 'Developer', status: 'under_review' } });
    expect((await call(token, 'account/overview')).json()).toMatchObject({ kind: 'applicant', applicationStatus: 'under_review', needsChoice: false });
  });
  it('blocks anonymous and forged role/identity requests', async () => {
    expect((await call('', 'account/overview')).statusCode).toBe(401);
    const { token } = await account();
    for (const body of [{ intent: 'admin' }, { intent: 'professional', role: 'admin' }, { intent: 'professional', userId: randomUUID() }]) expect((await call(token, 'account/onboarding', body)).statusCode).toBe(422);
  });
  it('isolates user choices and serializes duplicate requests', async () => {
    const a = await account(); const b = await account();
    await Promise.all([call(a.token, 'account/onboarding', { intent: 'customer' }), call(a.token, 'account/onboarding', { intent: 'professional' })]);
    expect(await prisma.auditLog.count({ where: { actorId: a.user.id, action: 'account.onboarding_selected' } })).toBe(1);
    expect((await call(b.token, 'account/overview')).json().needsChoice).toBe(true);
  });
  it('requires verification and does not prompt admin or existing professionals', async () => {
    const { user, token } = await account();
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    expect((await call(token, 'account/onboarding', { intent: 'customer' })).statusCode).toBe(403);
    for (const role of ['admin', 'professional'] as const) {
      const a = await account('google', role);
      expect((await call(a.token, 'account/overview')).json().needsChoice).toBe(false);
    }
    process.env.AUTH_MFA_ENABLED = 'true';
    try { expect((await call(token, 'account/onboarding', { intent: 'customer' })).statusCode).toBe(401); }
    finally { process.env.AUTH_MFA_ENABLED = 'false'; }
  });
  it('distinguishes approved professionals from applicants and fixes legacy no-profile applications', async () => {
    const { user, token } = await account(null, 'professional');
    expect((await call(token, 'account/overview')).json().kind).toBe('applicant');
    expect((await call(token, 'applications', { title: 'Test developer' })).statusCode).toBe(201);
    await prisma.professionalProfile.create({ data: { userId: user.id, name: 'Test', title: 'Developer', slug: randomUUID() } });
    expect((await call(token, 'account/overview')).json()).toMatchObject({ kind: 'professional', canManageServices: true });
  });
});
