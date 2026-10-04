/** New-device sign-in alerts — real API against an isolated local PostgreSQL (opt-in: RUN_LOCAL_SECURITY_TESTS=1). */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { describeDevice, clientAddress } from '../src/lib/deviceInfo.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const ANDROID_2 = 'Mozilla/5.0 (Linux; Android 13; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const WINDOWS_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

describe('describeDevice / clientAddress (pure)', () => {
  it('summarises common user agents into browser + OS', () => {
    expect(describeDevice(ANDROID).label).toBe('Chrome on Android');
    expect(describeDevice(IPHONE).label).toBe('Safari on iPhone');
    expect(describeDevice(WINDOWS_EDGE).label).toBe('Microsoft Edge on Windows');
    expect(describeDevice('').label).toBe('Unknown browser on Unknown device');
    expect(describeDevice(ANDROID).key).toBe(describeDevice(ANDROID_2).key); // same kind of device → not "new"
    expect(describeDevice(ANDROID).key).not.toBe(describeDevice(IPHONE).key);
  });
  it('prefers the first forwarded hop and rejects garbage', () => {
    expect(clientAddress({ 'x-forwarded-for': '41.58.1.2, 10.0.0.1' }, '10.0.0.9')).toBe('41.58.1.2');
    expect(clientAddress({}, '::ffff:41.58.1.2')).toBe('::ffff:41.58.1.2');
    expect(clientAddress({ 'x-forwarded-for': '<script>' }, undefined)).toBeNull();
  });
});

const origin = 'https://www.servix.name.ng';
describe.skipIf(process.env.RUN_LOCAL_SECURITY_TESTS !== '1')('new-device sign-in alerts, isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-login-alerts-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55462/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'false';
    process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10';
    delete process.env.LOGIN_ALERTS;
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55462, user: 'postgres', password: dbPassword,
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
  }, 180_000);
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

  const post = (path: string, body: object | undefined, ua: string, extra: Record<string, string> = {}) => app.inject({
    method: 'POST', url: `/api/v1/auth/${path}`, payload: body, headers: { origin, 'user-agent': ua, 'x-forwarded-for': '41.58.1.2, 10.0.0.1', ...extra }, remoteAddress: '10.0.0.1' });
  const alertMails = (userEmail: string) => prisma.job.findMany({ where: { name: 'email.send', payload: { path: ['to'], equals: userEmail } } }).then((jobs) => jobs.filter((j) => String((j.payload as { subject?: string }).subject).startsWith('New sign-in to your Servix account')));
  const alertNotes = (userId: string) => prisma.notification.findMany({ where: { userId, type: 'security.new_device' } });

  it('registration never alerts; same kind of device never alerts; a new device emails + notifies once; refresh never alerts', async () => {
    const email = `${randomUUID()}@example.test`; const password = 'Abcdef1!x';
    const reg = await post('register', { fullName: 'Alert Test', email, password }, ANDROID);
    expect(reg.statusCode).toBe(201);
    const userId = reg.json().user.id as string;
    await prisma.user.update({ where: { id: userId }, data: { status: 'active' } });
    expect(await alertMails(email)).toHaveLength(0);

    // Same browser family on another Android phone: known kind of device → silent.
    expect((await post('login', { email, password }, ANDROID_2)).statusCode).toBe(200);
    expect(await alertMails(email)).toHaveLength(0);
    expect(await alertNotes(userId)).toHaveLength(0);

    // iPhone Safari for the first time → one email + one in-app notification + audit row.
    const iphone = await post('login', { email, password }, IPHONE);
    expect(iphone.statusCode).toBe(200);
    const mails = await alertMails(email);
    expect(mails).toHaveLength(1);
    const payload = mails[0].payload as { subject: string; text: string; html: string };
    expect(payload.subject).toBe('New sign-in to your Servix account from Safari on iPhone');
    expect(payload.text).toContain('Safari on iPhone');
    expect(payload.text).toContain('41.58.1.2');
    expect(payload.text).toContain('Lagos time');
    expect(payload.text).not.toMatch(/token=|password=/i);
    const notes = await alertNotes(userId);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('New sign-in from Safari on iPhone');
    expect(notes[0].link).toBe('/dashboard/settings');
    expect(await prisma.auditLog.count({ where: { actorId: userId, action: 'security.new_device' } })).toBe(1);

    // Token rotation on the iPhone session is not a sign-in.
    const cookie = iphone.cookies.find((c) => c.name === 'servix_refresh' || /refresh/i.test(c.name));
    expect(cookie).toBeTruthy();
    const refreshed = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { origin, 'user-agent': IPHONE, cookie: `${cookie!.name}=${cookie!.value}` } });
    expect(refreshed.statusCode).toBe(200);
    expect(await alertMails(email)).toHaveLength(1);

    // iPhone again: now a known device → silent. Windows/Edge → second alert.
    expect((await post('login', { email, password }, IPHONE)).statusCode).toBe(200);
    expect(await alertMails(email)).toHaveLength(1);
    expect((await post('login', { email, password }, WINDOWS_EDGE)).statusCode).toBe(200);
    expect(await alertMails(email)).toHaveLength(2);
    expect((await alertMails(email))[1].payload).toMatchObject({ subject: 'New sign-in to your Servix account from Microsoft Edge on Windows' });
  }, 60_000);

  it('LOGIN_ALERTS=false keeps the in-app notification but sends no email', async () => {
    process.env.LOGIN_ALERTS = 'false';
    try {
      const email = `${randomUUID()}@example.test`; const password = 'Abcdef1!x';
      const reg = await post('register', { fullName: 'Quiet Test', email, password }, ANDROID);
      const userId = reg.json().user.id as string;
      await prisma.user.update({ where: { id: userId }, data: { status: 'active' } });
      expect((await post('login', { email, password }, IPHONE)).statusCode).toBe(200);
      expect(await alertMails(email)).toHaveLength(0);
      expect(await alertNotes(userId)).toHaveLength(1);
    } finally { delete process.env.LOGIN_ALERTS; }
  }, 30_000);
});
