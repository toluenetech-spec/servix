/** Opt-in integration tests for manual KYC / identity verification.
 *  Creates its own loopback PostgreSQL (embedded-postgres); never touches Neon.
 *  Object storage is an in-memory fake behind the R2 provider (fetch is stubbed).
 *  Run: RUN_LOCAL_KYC_TESTS=1 npx vitest run tests/kyc-local.test.ts */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const origin = 'https://www.servix.name.ng';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const PDF = Buffer.from('%PDF-1.4\n%fake\n', 'latin1');

describe.skipIf(process.env.RUN_LOCAL_KYC_TESTS !== '1')('manual KYC, isolated local PostgreSQL + fake bucket', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  const bucket = new Map<string, { type: string; bytes: Buffer }>();
  const realFetch = globalThis.fetch;
  let ip = 1;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-kyc-test-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55451/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'false';
    process.env.PAYMENT_MODE = 'sandbox';
    process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10';
    process.env.APP_BASE_URL = origin;
    process.env.STORAGE_PROVIDER = 'r2';
    process.env.R2_ACCOUNT_ID = 'acct123'; process.env.R2_ACCESS_KEY_ID = 'ak'; process.env.R2_SECRET_ACCESS_KEY = 'sk';
    process.env.R2_BUCKET = 'servix-storage'; process.env.R2_PUBLIC_BASE_URL = 'https://api.servix.test/media';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const key = decodeURIComponent(url.pathname.replace(/^\/servix-storage\//, ''));
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        const body = init?.body as ArrayBuffer | Uint8Array | Buffer;
        bucket.set(key, { type: String((init?.headers as Record<string, string>)?.['content-type'] ?? ''), bytes: Buffer.from(body as Uint8Array) });
        return new Response(null, { status: 200, headers: { etag: '"x"' } });
      }
      if (method === 'DELETE') { bucket.delete(key); return new Response(null, { status: 204 }); }
      const hit = bucket.get(key);
      if (!hit) return new Response('<Error>NoSuchKey</Error>', { status: 404 });
      return new Response(hit.bytes, { status: 200, headers: { 'content-type': hit.type, 'content-length': String(hit.bytes.length) } });
    }) as typeof fetch;

    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55451, user: 'postgres', password: dbPassword,
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
    /* Plans (free/go/pro/team/enterprise) are inserted by the subscriptions migration itself. */
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function account(role: 'customer' | 'professional' | 'admin' = 'customer', fullName = 'Adaeze Okafor') {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, fullName, role, status: 'active', emailVerifiedAt: new Date(), passwordHash: 'test-only' } });
    if (role === 'professional') await prisma.professionalProfile.create({ data: { userId: user.id, name: fullName, title: 'Developer', slug: randomUUID() } });
    const token = await (await import('../src/lib/tokens.js')).signAccessToken({ sub: user.id, role: user.role, status: 'active' });
    return { user, token };
  }
  function call(token: string, path: string, body?: object, method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') {
    return app.inject({ method: method ?? (body ? 'POST' : 'GET'), url: `/api/v1/${path}`, payload: body, headers: { authorization: `Bearer ${token}`, origin }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });
  }
  function raw(token: string, path: string, contentType: string, body: Buffer) {
    return app.inject({ method: 'POST', url: `/api/v1/${path}`, payload: body, headers: { authorization: `Bearer ${token}`, origin, 'content-type': contentType }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });
  }
  async function uploadBoth(token: string, documentType = 'nin_slip', doc: Buffer = JPEG, docType = 'image/jpeg') {
    const d = await raw(token, `kyc/upload?part=document&documentType=${documentType}`, docType, doc);
    const s = await raw(token, 'kyc/upload?part=selfie', 'image/png', PNG);
    expect(d.statusCode).toBe(201); expect(s.statusCode).toBe(201);
    return { documentFileKey: d.json().fileKey as string, selfieFileKey: s.json().fileKey as string };
  }
  const submission = (keys: { documentFileKey: string; selfieFileKey: string }, extra: object = {}) => ({ documentType: 'nin_slip', idNumber: '1234 5678 901', consentGiven: true, ...keys, ...extra });

  it('upload: auth, size, real MIME sniffing, PDF only for NIN slip, private keys', async () => {
    const me = await account();
    expect((await raw('', 'kyc/upload?part=document', 'image/png', PNG)).statusCode).toBe(401);
    expect((await raw(me.token, 'kyc/upload?part=nope', 'image/png', PNG)).statusCode).toBe(422);
    const tooBig = await raw(me.token, 'kyc/upload?part=document&documentType=nin_slip', 'image/png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]));
    expect(tooBig.statusCode).toBe(422); expect(tooBig.json().error.code).toBe('FILE_TOO_LARGE');
    // Declared PNG but the bytes are text → rejected by the server even if the client lied.
    const spoof = await raw(me.token, 'kyc/upload?part=document&documentType=nin_slip', 'image/png', Buffer.from('<script>alert(1)</script>'));
    expect(spoof.statusCode).toBe(422); expect(spoof.json().error.code).toBe('UNSUPPORTED_FILE');
    // PDF selfie and PDF passport are refused; PDF NIN slip is fine.
    expect((await raw(me.token, 'kyc/upload?part=selfie', 'application/pdf', PDF)).statusCode).toBe(422);
    expect((await raw(me.token, 'kyc/upload?part=document&documentType=international_passport', 'application/pdf', PDF)).statusCode).toBe(422);
    const pdfOk = await raw(me.token, 'kyc/upload?part=document&documentType=nin_slip', 'application/pdf', PDF);
    expect(pdfOk.statusCode).toBe(201);
    expect(pdfOk.json().fileKey).toMatch(new RegExp(`^kyc/${me.user.id}/document-[0-9a-f-]{36}\\.pdf$`));
    expect(bucket.has(pdfOk.json().fileKey)).toBe(true);
    // Private keys are NOT reachable through the public media proxy.
    const viaMedia = await app.inject({ method: 'GET', url: `/media/${pdfOk.json().fileKey}` });
    expect(viaMedia.statusCode).toBe(404);
  });

  it('submit: validation, consent, key ownership, status flow, no resubmit while pending', async () => {
    const me = await account();
    const other = await account();
    expect((await call(me.token, 'kyc/status')).json()).toMatchObject({ status: 'not_submitted', kycStatus: 'unverified', canSubmit: true });

    const keys = await uploadBoth(me.token);
    const noConsent = await call(me.token, 'kyc/submit', submission(keys, { consentGiven: false }));
    expect(noConsent.statusCode).toBe(422); expect(noConsent.json().error.errors.consentGiven).toBeTruthy();
    const shortId = await call(me.token, 'kyc/submit', submission(keys, { idNumber: '12' }));
    expect(shortId.statusCode).toBe(422); expect(shortId.json().error.errors.idNumber).toBeTruthy();
    // Keys uploaded by someone else cannot be attached.
    const theirs = await uploadBoth(other.token);
    const stolen = await call(me.token, 'kyc/submit', submission({ documentFileKey: theirs.documentFileKey, selfieFileKey: keys.selfieFileKey }));
    expect(stolen.statusCode).toBe(422); expect(stolen.json().error.errors.documentFileKey).toBeTruthy();

    const ok = await call(me.token, 'kyc/submit', submission(keys, { dateOfBirth: '1990-05-14', phone: '+2348012345678' }));
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ status: 'pending', kycStatus: 'pending', canSubmit: false, documentTypeLabel: 'NIN slip' });
    const row = await prisma.kycVerification.findUniqueOrThrow({ where: { userId: me.user.id } });
    expect(row.idNumberEncrypted).not.toContain('12345678901');
    expect(row.consentAt).toBeInstanceOf(Date);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: me.user.id } })).kycStatus).toBe('pending');
    expect((await call(me.token, 'account/overview')).json().kycStatus).toBe('pending');

    // While pending: no second submission and no new uploads.
    const again = await call(me.token, 'kyc/submit', submission(keys));
    expect(again.statusCode).toBe(409); expect(again.json().error.code).toBe('KYC_ALREADY_SUBMITTED');
    expect((await raw(me.token, 'kyc/upload?part=selfie', 'image/png', PNG)).statusCode).toBe(409);

    // Same document number on another account is refused.
    const dup = await call(other.token, 'kyc/submit', submission(theirs, { idNumber: '12345678901' }));
    expect(dup.statusCode).toBe(409); expect(dup.json().error.code).toBe('KYC_DOCUMENT_IN_USE');
  });

  it('admin: role gate, queue, signed URLs, approve/reject, resubmission after rejection, feature guards', async () => {
    const admin = await account('admin', 'Servix Admin');
    const pro = await account('professional', 'Tunde Bakare');
    const customer = await account();

    // Non-admins get 403 on every admin route.
    expect((await call(customer.token, 'admin/kyc/pending')).statusCode).toBe(403);
    expect((await call(pro.token, 'admin/kyc/pending')).statusCode).toBe(403);
    expect((await call(pro.token, 'admin/kyc/00000000-0000-0000-0000-000000000000/review', { action: 'approve' })).statusCode).toBe(403);

    // Sensitive features are blocked before verification.
    const payout = await call(pro.token, 'pro/payouts', {});
    expect(payout.statusCode).toBe(403); expect(payout.json().error.code).toBe('KYC_REQUIRED');

    const keys = await uploadBoth(pro.token, 'drivers_license');
    const submitted = await call(pro.token, 'kyc/submit', submission(keys, { documentType: 'drivers_license', idNumber: 'ABC-123456-XY' }));
    expect(submitted.statusCode).toBe(201);
    // Admins were told in-app.
    expect(await prisma.notification.count({ where: { userId: admin.user.id, type: 'kyc.pending' } })).toBe(1);

    const queue = await call(admin.token, 'admin/kyc/pending');
    expect(queue.statusCode).toBe(200);
    const item = queue.json().items.find((i: { user: { id: string } }) => i.user.id === pro.user.id);
    expect(item).toMatchObject({ status: 'pending', documentTypeLabel: "Driver's licence", idNumber: 'ABC123456XY', user: { fullName: 'Tunde Bakare' } });
    expect(queue.json().counts.pending).toBeGreaterThanOrEqual(1);

    const detail = await call(admin.token, `admin/kyc/${item.id}`);
    expect(detail.statusCode).toBe(200);
    const d = detail.json();
    expect(d.idNumber).toBe('ABC123456XY');
    expect(d.user.professional.title).toBe('Developer');
    expect(d.files.document.url).toMatch(/\/api\/v1\/kyc\/files\//);
    expect(new Date(d.files.expiresAt).getTime() - Date.now()).toBeGreaterThan(15 * 60 * 1000);
    expect(new Date(d.files.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
    // Signed link streams the file; tampering or a bogus token is refused; no auth header needed.
    const signed = new URL(d.files.selfie.url); const path = signed.pathname + signed.search;
    const file = await app.inject({ method: 'GET', url: path });
    expect(file.statusCode).toBe(200); expect(file.headers['content-type']).toBe('image/png'); expect(file.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(file.rawPayload).equals(PNG)).toBe(true);
    expect((await app.inject({ method: 'GET', url: `${path}x` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: signed.pathname })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/kyc/files/selfie.png?t=not-a-token' })).statusCode).toBe(401);
    const { signKycFileToken } = await import('../src/lib/kyc.js');
    const expired = signKycFileToken({ key: keys.selfieFileKey, exp: Math.floor(Date.now() / 1000) - 1, by: admin.user.id });
    expect((await app.inject({ method: 'GET', url: `/api/v1/kyc/files/selfie.png?t=${expired}` })).statusCode).toBe(401);
    const forgedBy = signKycFileToken({ key: keys.selfieFileKey, exp: Math.floor(Date.now() / 1000) + 60, by: customer.user.id });
    expect((await app.inject({ method: 'GET', url: `/api/v1/kyc/files/selfie.png?t=${forgedBy}` })).statusCode).toBe(401);

    // Reject needs a reason.
    expect((await call(admin.token, `admin/kyc/${item.id}/review`, { action: 'reject' })).statusCode).toBe(422);
    const rejected = await call(admin.token, `admin/kyc/${item.id}/review`, { action: 'reject', rejectionReason: 'Document blurry' });
    expect(rejected.statusCode).toBe(200); expect(rejected.json()).toMatchObject({ status: 'rejected', userKycStatus: 'rejected' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: pro.user.id } })).kycStatus).toBe('rejected');
    expect((await call(pro.token, 'kyc/status')).json()).toMatchObject({ status: 'rejected', rejectionReason: 'Document blurry', canSubmit: true });
    expect(await prisma.notification.count({ where: { userId: pro.user.id, type: 'kyc.rejected' } })).toBe(1);
    expect(await prisma.job.count({ where: { name: 'email.send', idempotencyKey: { startsWith: `kyc-${item.id}` } } })).toBe(1);
    // Cannot review twice.
    expect((await call(admin.token, `admin/kyc/${item.id}/review`, { action: 'approve' })).statusCode).toBe(409);

    // Rejected users can re-upload and re-submit; old files are removed from the bucket.
    const keys2 = await uploadBoth(pro.token, 'drivers_license');
    const resubmitted = await call(pro.token, 'kyc/submit', submission(keys2, { documentType: 'drivers_license', idNumber: 'ABC-123456-XY' }));
    expect(resubmitted.statusCode).toBe(201); expect(resubmitted.json().status).toBe('pending');
    await new Promise((r) => setTimeout(r, 20));
    expect(bucket.has(keys.documentFileKey)).toBe(false); expect(bucket.has(keys2.documentFileKey)).toBe(true);
    expect(await prisma.kycVerification.count({ where: { userId: pro.user.id } })).toBe(1);

    const approved = await call(admin.token, `admin/kyc/${item.id}/review`, { action: 'approve' });
    expect(approved.statusCode).toBe(200); expect(approved.json()).toMatchObject({ status: 'approved', userKycStatus: 'verified' });
    expect((await call(pro.token, 'kyc/status')).json()).toMatchObject({ status: 'approved', kycStatus: 'verified', canSubmit: false });
    expect((await call(pro.token, 'account/me')).json().kycStatus ?? (await call(pro.token, 'account/overview')).json().kycStatus).toBe('verified');
    // Payout guard now lets the request through to the normal business rule (no balance → 4xx but not KYC_REQUIRED).
    const payoutAfter = await call(pro.token, 'pro/payouts', {});
    expect(payoutAfter.json().error?.code).not.toBe('KYC_REQUIRED');
    // Approved users cannot submit again.
    expect((await call(pro.token, 'kyc/submit', submission(keys2, { documentType: 'drivers_license' }))).statusCode).toBe(409);
    const history = await call(admin.token, 'admin/kyc/pending?status=all');
    expect(history.json().items.some((i: { id: string; status: string }) => i.id === item.id && i.status === 'approved')).toBe(true);
  });
});
