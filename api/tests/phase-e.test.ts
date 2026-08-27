/**
 * SERVIX API — Phase E production-hardening tests.
 * Job queue lifecycle (retry/backoff/dead-letter, idempotency, duplicate
 * execution), R2 SigV4 presigning (AWS official test vector), storage stub
 * honesty, webhook replay safety, payout failure recovery (exactly-once
 * reversal), production config validation and readiness degradation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/password.js';
import { enqueue, enqueueMail, runOneJob } from '../src/lib/jobs.js';
import { presignS3Url, makeKey } from '../src/lib/storage.js';
import { validateProductionConfig } from '../src/lib/config.js';
import { SandboxControl, signWebhook } from '../src/lib/payments.js';
import { accountBalance } from '../src/lib/ledger.js';

let app: FastifyInstance;
const stamp = Date.now();

const customer = { email: `pe-cust-${stamp}@test.servix`, password: 'customer-pass-1', token: '' };
const proUser = { email: `pe-pro-${stamp}@test.servix`, password: 'pro-pass-1', token: '', profileId: '' };
let adminToken = '';
let serviceSlug = '';
const PRICE = 100000; // naira

const inject = (method: string, url: string, token?: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({
    method: method as 'GET',
    url,
    payload,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });

async function futureSlot(offsetDays: number, hour: number): Promise<string> {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function drainJobs(max = 50) {
  for (let i = 0; i < max; i += 1) {
    if (!(await runOneJob())) break;
  }
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();

  for (const a of [customer, proUser]) {
    const res = await inject('POST', '/api/v1/auth/register', undefined, {
      fullName: `T ${a.email.split('@')[0]}`,
      email: a.email,
      password: a.password,
    });
    a.token = res.json().accessToken;
  }
  await prisma.user.create({
    data: {
      email: `pe-admin-${stamp}@test.servix`,
      fullName: 'Phase E Admin',
      passwordHash: await hashPassword('phase-e-admin-1'),
      role: 'admin',
      status: 'active',
    },
  });
  const login = await inject('POST', '/api/v1/auth/login', undefined, {
    email: `pe-admin-${stamp}@test.servix`,
    password: 'phase-e-admin-1',
  });
  adminToken = login.json().accessToken;

  // Promote pro + publish a service for the financial scenarios.
  const appRes = await inject('POST', '/api/v1/applications', proUser.token, { title: 'Phase E Pro' });
  const appId = appRes.json().id;
  await inject('POST', `/api/v1/applications/${appId}/submit`, proUser.token);
  await inject('POST', `/api/v1/admin/applications/${appId}/approve`, adminToken);
  const profile = await prisma.professionalProfile.findFirstOrThrow({ where: { user: { email: proUser.email } } });
  proUser.profileId = profile.id;

  const svc = await inject('POST', '/api/v1/pro/services', proUser.token, {
    title: `Phase E Service ${stamp}`,
    categorySlug: 'consulting',
    price: PRICE,
    shortDescription: 'A service used by the Phase E hardening test suite.',
    description: 'Full-length description used by the automated Phase E hardening test-suite runs.',
  });
  serviceSlug = svc.json().id;
  await inject('POST', `/api/v1/pro/services/${serviceSlug}/publish`, proUser.token);
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { endsWith: '@test.servix' } } });
  const ids = users.map((u) => u.id);
  const profiles = await prisma.professionalProfile.findMany({ where: { userId: { in: ids } } });
  const pids = profiles.map((p) => p.id);
  await prisma.booking.deleteMany({ where: { OR: [{ customerId: { in: ids } }, { professionalId: { in: pids } }] } });
  await prisma.payout.deleteMany({ where: { professionalId: { in: pids } } });
  await prisma.service.deleteMany({ where: { professionalId: { in: pids } } });
  await prisma.professionalProfile.deleteMany({ where: { id: { in: pids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.job.deleteMany({ where: { idempotencyKey: { contains: `${stamp}` } } });
  await app.close();
});

/* ================= job queue ================= */

describe('job queue (PgQueue)', () => {
  it('email jobs: enqueue → run → done (provider must accept)', async () => {
    const key = `mail-ok-${stamp}`;
    await enqueueMail({ to: 'jobs@test.servix', subject: 'Queue test', text: 'hello' }, key);
    await drainJobs();
    const job = await prisma.job.findFirstOrThrow({ where: { idempotencyKey: key } });
    expect(job.status).toBe('done');
    expect(job.attempts).toBe(1);
  });

  it('duplicate enqueue with the same idempotency key is a no-op', async () => {
    const key = `mail-dup-${stamp}`;
    await enqueueMail({ to: 'dup@test.servix', subject: 'A', text: 'a' }, key);
    await enqueueMail({ to: 'dup@test.servix', subject: 'A', text: 'a' }, key);
    const count = await prisma.job.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it('failing jobs back off exponentially and die after maxAttempts', async () => {
    // payouts.retry with a nonexistent payout id throws in the handler.
    const key = `dead-${stamp}`;
    // maxAttempts 2 keeps the test quick.
    await enqueue('payouts.retry', { payoutId: 'not-a-real-id' }, { idempotencyKey: key, maxAttempts: 2 });

    // Drain the whole backlog (earlier suites enqueue mails); our job gets
    // its first attempt somewhere in the drain and backs off to the future.
    await drainJobs();
    let job = await prisma.job.findFirstOrThrow({ where: { idempotencyKey: key } });
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(1);
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now()); // backed off
    expect(job.lastError).toBeTruthy();

    // attempt 2 — force due now, then it must go dead.
    await prisma.job.update({ where: { id: job.id }, data: { runAt: new Date() } });
    await runOneJob();
    job = await prisma.job.findFirstOrThrow({ where: { idempotencyKey: key } });
    expect(job.status).toBe('dead');
    expect(job.attempts).toBe(2);
  });

  it('duplicate worker execution: two concurrent claims never run the same job twice', async () => {
    const key = `race-${stamp}`;
    await enqueueMail({ to: 'race@test.servix', subject: 'Race', text: 'r' }, key);
    // Run claim attempts concurrently — SKIP LOCKED must hand the job to only one.
    await Promise.all([runOneJob(), runOneJob(), runOneJob()]);
    const job = await prisma.job.findFirstOrThrow({ where: { idempotencyKey: key } });
    expect(job.status).toBe('done');
    expect(job.attempts).toBe(1); // exactly one execution
  });
});

/* ================= storage / R2 ================= */

describe('storage (R2 SigV4 + stub honesty)', () => {
  it('SigV4 presign matches the OFFICIAL AWS documentation test vector', () => {
    const url = presignS3Url({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      expiresSeconds: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    const sig = new URL(url).searchParams.get('X-Amz-Signature');
    // Expected signature from AWS docs "Authenticating Requests: Using Query
    // Parameters (AWS Signature Version 4)" example.
    expect(sig).toBe('aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });

  it('generated keys are safe: uuid names, extension from content type only', () => {
    const key = makeKey('profile', '../../etc/passwd.png;rm -rf.jpg', 'image/png');
    expect(key).toMatch(/^profile\/[0-9a-f-]{36}\.png$/);
    expect(key).not.toContain('..');
    const evil = makeKey('service', 'x.png', 'application/x-msdownload');
    expect(evil.endsWith('.bin')).toBe(true);
  });

  it('without R2 credentials the stub NEVER pretends uploads work', async () => {
    const res = await inject('POST', '/api/v1/pro/uploads', proUser.token, {
      kind: 'portfolio',
      fileName: 'shot.png',
      contentType: 'image/png',
      size: 50_000,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
    expect(res.json().uploadUrl).toBeNull();
    expect(res.json().note).toContain('not configured');

    // presign requests are audit-tracked for orphan cleanup
    const row = await prisma.auditLog.findFirst({
      where: { action: 'upload.presigned', entityId: res.json().key },
    });
    expect(row).not.toBeNull();
  });
});

/* ================= webhook replay + retry job ================= */

describe('webhook resilience', () => {
  it('replayed events (same provider id) are acknowledged but never re-processed', async () => {
    const create = await inject('POST', '/api/v1/bookings', customer.token, {
      serviceId: serviceSlug,
      scheduledAt: await futureSlot(12, 9),
    });
    const bookingId = create.json().id;
    const pay = await inject('POST', `/api/v1/bookings/${bookingId}/pay`, customer.token);
    const reference = pay.json().reference;
    await app.inject({
      method: 'POST',
      url: `/sandbox/checkout/${reference}/complete`,
      payload: 'outcome=success',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    const ledgerBefore = await prisma.ledgerEntry.count({ where: { bookingId } });
    const eventsBefore = await prisma.webhookEvent.count();

    // Replay the exact same event id THREE times.
    const body = JSON.stringify({ id: `evt-${reference}-success`, event: 'charge.success', data: { id: `evt-${reference}-success`, reference, status: 'success' } });
    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/paystack',
        payload: body,
        headers: { 'content-type': 'application/json', 'x-paystack-signature': signWebhook(body) },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().duplicate).toBe(true);
    }
    expect(await prisma.ledgerEntry.count({ where: { bookingId } })).toBe(ledgerBefore);
    expect(await prisma.webhookEvent.count()).toBe(eventsBefore);

    // leave the booking paid for the payout scenario below
  });
});

/* ================= payout failure recovery ================= */

describe('payout failure recovery', () => {
  it('failed transfer reverses the hold EXACTLY once; retry succeeds; money conserved', async () => {
    // Complete the paid booking so the pro has a payable balance.
    const booking = await prisma.booking.findFirstOrThrow({
      where: { professionalId: proUser.profileId, status: 'requested' },
    });
    await inject('POST', `/api/v1/pro/bookings/${booking.id}/accept`, proUser.token);
    await inject('POST', `/api/v1/pro/bookings/${booking.id}/start`, proUser.token);
    await inject('POST', `/api/v1/pro/bookings/${booking.id}/deliver`, proUser.token);
    await inject('POST', `/api/v1/bookings/${booking.id}/confirm`, customer.token);

    const payable = await accountBalance('professional_payable', proUser.profileId);
    expect(payable).toBeGreaterThan(0n);

    // 1. Force the provider transfer to fail.
    SandboxControl.failNextTransfer = true;
    const fail = await inject('POST', '/api/v1/pro/payouts', proUser.token);
    expect(fail.statusCode).toBe(502);
    expect(fail.json().error.code).toBe('TRANSFER_FAILED');

    // Payout is failed; balance fully restored by the reversal.
    const failed = await prisma.payout.findFirstOrThrow({
      where: { professionalId: proUser.profileId, status: 'failed' },
    });
    const restored = await accountBalance('professional_payable', proUser.profileId);
    expect(restored).toBe(payable);

    // Reversal happened exactly once.
    const reversals = await prisma.ledgerEntry.count({
      where: { payoutId: failed.id, account: 'professional_payable', direction: 'credit' },
    });
    expect(reversals).toBe(1);

    // 2. Admin retry (provider back up) → paid, balance drained.
    const retry = await inject('POST', `/api/v1/admin/payouts/${failed.id}/retry`, adminToken);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().status).toBe('paid');
    expect(await accountBalance('professional_payable', proUser.profileId)).toBe(0n);

    // 3. Retrying an already-recovered payout is a no-op (no duplicate money).
    const again = await inject('POST', `/api/v1/admin/payouts/${failed.id}/retry`, adminToken);
    expect(again.statusCode).toBe(200);
    expect(await accountBalance('professional_payable', proUser.profileId)).toBe(0n);

    // 4. Global ledger stays balanced.
    const entries = await prisma.ledgerEntry.findMany();
    const byTxn = new Map<string, bigint>();
    for (const e of entries) {
      const d = e.direction === 'debit' ? e.amountKobo : -e.amountKobo;
      byTxn.set(e.txnId, (byTxn.get(e.txnId) ?? 0n) + d);
    }
    for (const [txn, sum] of byTxn) expect(sum, `txn ${txn}`).toBe(0n);
  });
});

/* ================= production config validation ================= */

describe('validateProductionConfig', () => {
  const goodProd = {
    NODE_ENV: 'production',
    AUTH_JWT_SECRET: 'x'.repeat(48),
    DATABASE_URL: 'postgresql://u:p@db:5432/servix',
    PAYSTACK_SECRET_KEY: 'sk_live_xxx',
    APP_BASE_URL: 'https://servix.app',
    EMAIL_MODE: 'resend',
    RESEND_API_KEY: 're_xxx',
    ADMIN_EMAIL: 'ops@servix.app',
  } as NodeJS.ProcessEnv;

  it('accepts a complete production configuration', () => {
    expect(validateProductionConfig(goodProd)).toEqual([]);
  });

  it('refuses to bless production with missing/weak configuration', () => {
    const bad = validateProductionConfig({
      NODE_ENV: 'production',
      AUTH_JWT_SECRET: 'short',
      EMAIL_MODE: 'console',
      APP_BASE_URL: 'http://insecure.example',
      SERVIX_REVIEW_KEY: 'dev-review-key',
    } as NodeJS.ProcessEnv);
    expect(bad.join('\n')).toContain('AUTH_JWT_SECRET');
    expect(bad.join('\n')).toContain('DATABASE_URL');
    expect(bad.join('\n')).toContain('PAYSTACK_SECRET_KEY');
    expect(bad.join('\n')).toContain('APP_BASE_URL');
    expect(bad.join('\n')).toContain('EMAIL_MODE=console');
    expect(bad.join('\n')).toContain('SERVIX_REVIEW_KEY');
    expect(bad.join('\n')).toContain('ADMIN_EMAIL');
  });

  it('requires R2 variables when STORAGE_PROVIDER=r2', () => {
    const bad = validateProductionConfig({ ...goodProd, STORAGE_PROVIDER: 'r2' });
    expect(bad.some((p) => p.includes('R2_ACCOUNT_ID'))).toBe(true);
    expect(bad.some((p) => p.includes('R2_SECRET_ACCESS_KEY'))).toBe(true);
  });

  it('development is never blocked', () => {
    expect(validateProductionConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toEqual([]);
  });
});

/* ================= observability ================= */

describe('observability', () => {
  it('security headers + request id on every response', async () => {
    const res = await inject('GET', '/api/v1/categories');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('/readyz reports component checks', async () => {
    const res = await inject('GET', '/readyz');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ready).toBe(true);
    expect(body.checks.database).toBe(true);
    expect(body.checks.queue).toBe(true);
    expect(body.checks.storage).toBe(true);
  });

  it('oversized request bodies are rejected (body limit)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contact',
      payload: { name: 'x', email: 'a@b.c', subject: 's', message: 'y'.repeat(600 * 1024) },
    });
    expect(res.statusCode).toBe(413);
  });
});
