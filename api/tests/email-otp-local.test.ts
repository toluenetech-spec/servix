/** Opt-in disposable LOCAL database. Never uses the configured Neon database. */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

describe.skipIf(process.env.RUN_LOCAL_OTP_TESTS !== '1')('OTP disposable database integration', () => {
  let cluster: EmbeddedPostgres;
  let directory: string;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let request: typeof import('../src/lib/emailOtp.js')['requestEmailOtp'];
  let confirm: typeof import('../src/lib/emailOtp.js')['confirmEmailOtp'];
  let open: typeof import('../src/lib/emailOtpCrypto.js')['openOtpMail'];
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-otp-test-'));
    const password = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${password}@127.0.0.1:55439/postgres`;
    process.env.EMAIL_OTP_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test';
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55439, user: 'postgres', password,
      persistent: false, postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: console.error, initdbFlags: ['--locale=C', '--lc-messages=C', '--encoding=UTF8'] });
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
    const service = await import('../src/lib/emailOtp.js'); request = service.requestEmailOtp; confirm = service.confirmEmailOtp;
    open = (await import('../src/lib/emailOtpCrypto.js')).openOtpMail;
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    if (cluster) await cluster.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const account = () => prisma.user.create({ data: { email: `${randomUUID()}@example.test`, fullName: 'OTP Test', passwordHash: 'test-only', status: 'pending_verification' } });
  async function code(userId: string) {
    const stored = await prisma.emailVerificationOtp.findUniqueOrThrow({ where: { userId } });
    const job = await prisma.job.findFirstOrThrow({ where: { idempotencyKey: `verify-otp-${stored.nonce}` } });
    const mail = open((job.payload as { encryptedOtpMail: string }).encryptedOtpMail) as { text: string };
    return { code: mail.text.match(/\b\d{6}\b/)![0], job, stored };
  }
  const advanceCooldown = (userId: string) => prisma.emailVerificationOtp.update({ where: { userId }, data: { sentAt: new Date(Date.now() - 61_000) } });
  it('queues encrypted email and consumes only once', async () => {
    const user = await account(); await request(user.id); const sent = await code(user.id);
    expect(JSON.stringify(sent.job.payload)).not.toContain(sent.code);
    expect((await confirm(user.id, sent.code)).status).toBe('active');
    await expect(confirm(user.id, sent.code)).rejects.toMatchObject({ code: 'INVALID_OTP' });
  });
  it('failed guesses persist and cannot be reset by resend', async () => {
    const user = await account(); await request(user.id); const sent = await code(user.id);
    const wrong = sent.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await expect(confirm(user.id, wrong)).rejects.toMatchObject({ code: 'INVALID_OTP' });
    await expect(confirm(user.id, sent.code)).rejects.toMatchObject({ code: 'OTP_LIMIT' });
    await advanceCooldown(user.id);
    await expect(request(user.id)).rejects.toMatchObject({ code: 'OTP_LIMIT' });
  });
  it('only one concurrent consume succeeds', async () => {
    const user = await account(); await request(user.id); const sent = await code(user.id);
    const results = await Promise.allSettled([confirm(user.id, sent.code), confirm(user.id, sent.code)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('serializes first sends and enforces cooldown', async () => {
    const user = await account();
    const results = await Promise.allSettled([request(user.id), request(user.id)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await expect(request(user.id)).rejects.toMatchObject({ code: 'OTP_COOLDOWN' });
  });
  it('rejects expired and cross-account codes', async () => {
    const a = await account(); const b = await account(); await request(a.id); const sent = await code(a.id);
    await expect(confirm(b.id, sent.code)).rejects.toMatchObject({ code: 'INVALID_OTP' });
    await prisma.emailVerificationOtp.update({ where: { userId: a.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(confirm(a.id, sent.code)).rejects.toMatchObject({ code: 'INVALID_OTP' });
  });
  it('rejects suspended accounts', async () => {
    const user = await account(); await request(user.id); const sent = await code(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });
    await expect(request(user.id)).rejects.toMatchObject({ status: 401 });
    await expect(confirm(user.id, sent.code)).rejects.toMatchObject({ code: 'INVALID_OTP' });
  });
  it('resend rotates nonce, preserves failures, and enforces hourly cap', async () => {
    const user = await account(); await request(user.id); const first = await code(user.id);
    await expect(confirm(user.id, first.code === '000000' ? '111111' : '000000')).rejects.toBeDefined();
    for (let i = 0; i < 4; i++) { await advanceCooldown(user.id); await request(user.id); }
    const last = await code(user.id); expect(last.stored.nonce).not.toBe(first.stored.nonce); expect(last.stored.attempts).toBe(1);
    await advanceCooldown(user.id); await expect(request(user.id)).rejects.toMatchObject({ code: 'OTP_LIMIT' });
  });
});
