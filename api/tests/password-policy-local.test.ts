/** Opt-in integration tests; creates its own loopback DB, never uses Neon. */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const origin = 'https://www.servix.name.ng';
describe.skipIf(process.env.RUN_LOCAL_PASSWORD_TESTS !== '1')('password policy, isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let service: typeof import('../src/lib/securityFlow.js');
  let ip = 1;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-security-test-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55444/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'false';
    process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10';
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55444, user: 'postgres', password: dbPassword,
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
    service = await import('../src/lib/securityFlow.js');
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  const post = (path: string, cookie = '', body?: object, extra: Record<string, string> = {}) => app.inject({
    method: 'POST', url: `/api/v1/auth/${path}`, payload: body, headers: { origin, cookie, ...extra }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });
  async function resetAccount(role: 'admin' | 'customer' | 'professional' = 'customer') {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, fullName: 'Policy test', role, status: 'active', passwordHash: 'unchanged' } });
    const token = randomUUID();
    await prisma.oneTimeToken.create({ data: { userId: user.id, purpose: 'reset_password', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60000) } });
    return { user, token };
  }
  it('accepts an eight-character registration password and rejects missing complexity', async () => {
    for (const [password, expected] of [['Abcdef1!', 201], ['abcdefgh', 422], ['Abcde1!', 422]] as const) {
      const res = await post('register', '', { fullName: 'Test', email: `${randomUUID()}@example.test`, password });
      expect(res.statusCode).toBe(expected);
    }
  });
  it('enforces regular-user reset rules regardless of forged role/policy', async () => {
    const { user, token } = await resetAccount();
    expect((await post('reset-password/policy', '', { token })).json()).toEqual({ passwordPolicy: 'standard' });
    expect((await post('reset-password', '', { token, password: 'abcdefgh', role: 'admin', passwordPolicy: 'basic' })).statusCode).toBe(422);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe('unchanged');
    expect((await post('reset-password', '', { token, password: 'Abcdef1!' })).statusCode).toBe(200);
    expect((await post('reset-password/policy', '', { token })).statusCode).toBe(400);
  });
  it('allows basic admin resets but keeps minimum and maximum bounds', async () => {
    const { token, user } = await resetAccount('admin');
    const policy = await post('reset-password/policy', '', { token });
    expect(policy.json()).toEqual({ passwordPolicy: 'basic' });
    expect(policy.headers['cache-control']).toBe('no-store');
    for (const password of ['short', 'x'.repeat(201)]) expect((await post('reset-password', '', { token, password })).statusCode).toBe(422);
    expect((await post('reset-password', '', { token, password: 'abcdefgh' })).statusCode).toBe(200);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await (await import('../src/lib/password.js')).verifyPassword('abcdefgh', updated.passwordHash)).toBe(true);
  });
  it('does not reveal policy for unknown, expired, or consumed tokens', async () => {
    expect((await post('reset-password/policy', '', { token: 'invalid', email: 'admin@servix.app' })).statusCode).toBe(400);
    const { token, user } = await resetAccount('admin');
    await prisma.oneTimeToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
    expect((await post('reset-password/policy', '', { token })).statusCode).toBe(400);
  });
  it('uses database role for MFA resets and exposes policy only after verification', async () => {
    process.env.AUTH_MFA_ENABLED = 'true';
    try {
      for (const role of ['admin', 'customer'] as const) {
        const { user } = await resetAccount(role);
        const started = await service.beginSecurity(user.id, 'reset');
        expect(started).not.toHaveProperty('passwordPolicy');
        // Simulate the already-verified stage; full factor verification is covered by security-local.
        await prisma.accountSecurity.update({ where: { userId: user.id }, data: { method: 'totp' } });
        await prisma.securityFlow.update({ where: { tokenHash: createHash('sha256').update(started.raw).digest('hex') }, data: { stage: 'reset_password' } });
        expect((await service.securityStatus(started.raw) as any).passwordPolicy).toBe(role === 'admin' ? 'basic' : 'standard');
        if (role === 'customer') await expect(service.resetSecurityPassword(started.raw, 'abcdefgh')).rejects.toMatchObject({ status: 422 });
        await service.resetSecurityPassword(started.raw, role === 'admin' ? 'abcdefgh' : 'Abcdef1!');
      }
    } finally { process.env.AUTH_MFA_ENABLED = 'false'; }
  });
});
