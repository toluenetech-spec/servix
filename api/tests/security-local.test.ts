/** Opt-in integration tests; creates its own loopback DB, never uses Neon. */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
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
describe.skipIf(process.env.RUN_LOCAL_SECURITY_TESTS !== '1')('restricted MFA flow, isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let service: typeof import('../src/lib/securityFlow.js');
  let crypto: typeof import('../src/lib/securityCrypto.js');
  let ip = 1;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-security-test-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55440/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'true';
    process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10';
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55440, user: 'postgres', password: dbPassword,
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
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  const post = (path: string, cookie = '', body?: object, extra: Record<string, string> = {}) => app.inject({
    method: 'POST', url: `/api/v1/auth/${path}`, payload: body, headers: { origin, cookie, ...extra }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });
  const account = async () => prisma.user.create({ data: { email: `${randomUUID()}@example.test`, fullName: 'Security Test',
    passwordHash: await (await import('../src/lib/password.js')).hashPassword(password), status: 'pending_verification' } });
  const advance = (userId: string) => prisma.accountSecurity.update({ where: { userId }, data: { lastSentAt: new Date(Date.now() - 61_000) } });
  async function emailCode(raw: string) {
    const flow = await prisma.securityFlow.findUniqueOrThrow({ where: { tokenHash: createHash('sha256').update(raw).digest('hex') } });
    const jobs = await prisma.job.findMany({ where: { name: 'email.send' }, orderBy: { createdAt: 'desc' } });
    const payload = jobs.map(j => j.payload as { flowId?: string; emailDigest?: string; securityMail?: string }).find(p => p.flowId === flow.id && p.emailDigest === flow.emailDigest)!;
    return crypto.unseal<{ text: string }>(payload.securityMail!).text.match(/\b\d{6}\b/)![0];
  }
  const totpCode = (secret: string, timestamp = Date.now()) => new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp });
  async function enroll() {
    const user = await account(); const flow = await service.beginSecurity(user.id, 'registration');
    await service.verifySecurityEmail(flow.raw, await emailCode(flow.raw));
    const setup = await service.prepareTotp(flow.raw);
    // Previous window permits the next login to use a fresh current code without sleeping.
    const enrolled = await service.confirmTotpEnrollment(flow.raw, totpCode(setup.secret, Date.now() - 30_000));
    return { user, flow, setup, enrolled };
  }
  it('registration returns only a restricted cookie; cannot skip to a full session', async () => {
    const res = await post('register', '', { fullName: 'Test', email: `${randomUUID()}@example.test`, password });
    expect(res.statusCode).toBe(201); expect(res.json().security.next).toBe('email'); expect(res.json().accessToken).toBeUndefined();
    expect(res.cookies.find(c => c.name === 'servix_refresh')?.value).toBeFalsy();
    const flowCookie = res.cookies.find(c => c.name === 'servix_security')!;
    const finish = await post('security/finish', `servix_security=${flowCookie.value}`, { savedRecovery: true });
    expect(finish.statusCode).toBe(400);
    const setup = await post('security/totp/setup', `servix_security=${flowCookie.value}`);
    expect(setup.statusCode).toBe(400);
  });
  it('requires an allowed browser origin on credential entry and cookie actions', async () => {
    const res = await post('login', '', { email: 'unit@example.test', password }, { origin: 'https://attacker.example' });
    expect(res.statusCode).toBe(403);
    const flow = await service.beginSecurity((await account()).id, 'registration');
    const status = await post('security/status', `servix_security=${flow.raw}`, undefined, { origin: 'https://attacker.example' });
    expect(status.statusCode).toBe(403);
  });
  it('enrolls authenticator, requires recovery acknowledgment, then issues MFA session', async () => {
    const { user, flow, enrolled } = await enroll();
    expect(enrolled.method).toBe('totp'); expect(enrolled.recoveryCodes).toHaveLength(8);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('pending_verification');
    await expect(service.finishSecurity(flow.raw)).rejects.toMatchObject({ status: 400 });
    const res = await post('security/finish', `servix_security=${flow.raw}`, { savedRecovery: true });
    expect(res.statusCode).toBe(200); expect(res.json().user.status).toBe('active');
    const refresh = res.cookies.find(c => c.name === 'servix_refresh')!;
    expect(refresh.httpOnly).toBe(true);
    const me = await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${res.json().accessToken}` } });
    expect(me.statusCode).toBe(200);
    await expect(service.readRecoveryCodes(flow.raw)).rejects.toBeDefined();
    const retryFinish = await post('security/finish', `servix_security=${flow.raw}`, { savedRecovery: true });
    expect(retryFinish.statusCode).toBe(401);
  });
  it('password login requires email and the saved factor, not a replacement', async () => {
    const { user, flow, setup } = await enroll(); await service.finishSecurity(flow.raw, true); await advance(user.id);
    const result = await post('login', '', { email: user.email, password });
    expect(result.json().accessToken).toBeUndefined(); const raw = result.cookies.find(c => c.name === 'servix_security')!.value;
    await expect(service.verifySecondFactor(raw, totpCode(setup.secret))).rejects.toMatchObject({ status: 400 });
    expect((await service.verifySecurityEmail(raw, await emailCode(raw))).next).toBe('factor');
    await expect(service.prepareTotp(raw)).rejects.toBeDefined(); await expect(service.preparePasskey(raw)).rejects.toBeDefined();
    expect((await service.verifySecondFactor(raw, totpCode(setup.secret))).next).toBe('finish');
    await service.finishSecurity(raw);
  });
  it('recovery is single-use, reset revokes old access and refresh sessions', async () => {
    const { user, flow, enrolled } = await enroll();
    const session = await post('security/finish', `servix_security=${flow.raw}`, { savedRecovery: true });
    await advance(user.id); const reset = await service.beginSecurity(user.id, 'reset');
    await expect(service.resetSecurityPassword(reset.raw, 'not-a-real-hash')).rejects.toBeDefined();
    await service.verifySecurityEmail(reset.raw, await emailCode(reset.raw));
    await service.verifySecondFactor(reset.raw, enrolled.recoveryCodes[0], true);
    expect((await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${session.json().accessToken}` } })).statusCode).toBe(401);
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: 'security.recovery_used' } })).toBe(1);
    const response = await post('security/reset-password', `servix_security=${reset.raw}`, { password: 'Brand-New-Password123!' });
    expect(response.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${session.json().accessToken}` } })).statusCode).toBe(401);
    const refresh = session.cookies.find(c => c.name === 'servix_refresh')!.value;
    expect((await post('refresh', `servix_refresh=${refresh}`)).statusCode).toBe(401);
    await advance(user.id); const login = await service.beginSecurity(user.id, 'login');
    await service.verifySecurityEmail(login.raw, await emailCode(login.raw));
    await expect(service.verifySecondFactor(login.raw, enrolled.recoveryCodes[0], true)).rejects.toMatchObject({ status: 400 });
    expect((await prisma.accountSecurity.findUniqueOrThrow({ where: { userId: user.id } })).method).toBe('totp');
  });
  it('old non-MFA access and refresh sessions cannot bypass activation', async () => {
    const { user, flow } = await enroll(); await service.finishSecurity(flow.raw, true);
    const tokens = await import('../src/lib/tokens.js');
    const old = await tokens.signAccessToken({ sub: user.id, role: user.role, status: 'active' });
    expect((await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${old}` } })).statusCode).toBe(401);
    const token = tokens.newOpaqueToken();
    await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: token.hash, familyId: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
    expect((await post('refresh', `servix_refresh=${token.raw}`)).statusCode).toBe(401);
    expect((await post('reset-password', '', { token: 'old-link-token', password })).statusCode).toBe(400);
  });
  it('persists global failure limits across challenge restarts', async () => {
    const user = await account(); const flow = await service.beginSecurity(user.id, 'registration'); const correct = await emailCode(flow.raw);
    for (let n = 0; n < 10; n++) await expect(service.verifySecurityEmail(flow.raw, correct === '000000' ? '111111' : '000000')).rejects.toBeDefined();
    expect((await prisma.accountSecurity.findUniqueOrThrow({ where: { userId: user.id } })).failures).toBe(10);
    await advance(user.id); await expect(service.beginSecurity(user.id, 'login')).rejects.toMatchObject({ status: 429 });
  });
  it('returns generic reset metadata for missing and real accounts before proof', async () => {
    const known = await service.beginSecurity((await account()).id, 'reset'); const missing = await service.beginSecurity(null, 'reset');
    const a = await service.securityStatus(known.raw); const b = await service.securityStatus(missing.raw);
    expect({ ...a, expiresAt: '' }).toEqual({ ...b, expiresAt: '' });
    await expect(service.verifySecurityEmail(missing.raw, '123456')).rejects.toMatchObject({ status: 400, code: 'SECURITY_INVALID' });
  });

  it('expires both email codes and the restricted flow', async () => {
    const user = await account(); const flow = await service.beginSecurity(user.id, 'registration');
    const code = await emailCode(flow.raw);
    const where = { tokenHash: createHash('sha256').update(flow.raw).digest('hex') };
    await prisma.securityFlow.update({ where, data: { emailExpiresAt: new Date(Date.now() - 1) } });
    await expect(service.verifySecurityEmail(flow.raw, code)).rejects.toMatchObject({ status: 400 });
    await prisma.securityFlow.update({ where, data: { expiresAt: new Date(Date.now() - 1) } });
    await expect(service.securityStatus(flow.raw)).rejects.toMatchObject({ status: 401 });
    await expect(service.prepareTotp(flow.raw)).rejects.toMatchObject({ status: 401 });
  });
  it('enforces resend cooldown, invalidates earlier codes and limits sends across flows', async () => {
    const user = await account(); const flow = await service.beginSecurity(user.id, 'registration');
    const old = await emailCode(flow.raw);
    await expect(service.resendSecurityCode(flow.raw)).rejects.toMatchObject({ status: 429 });
    await advance(user.id); await service.resendSecurityCode(flow.raw);
    const latest = await emailCode(flow.raw);
    if (old !== latest) await expect(service.verifySecurityEmail(flow.raw, old)).rejects.toMatchObject({ status: 400 });
    await prisma.accountSecurity.update({ where: { userId: user.id }, data: { sends: 5 } });
    await advance(user.id);
    await expect(service.beginSecurity(user.id, 'login')).rejects.toMatchObject({ status: 429 });
    expect((await service.verifySecurityEmail(flow.raw, latest)).next).toBe('enroll');
    await expect(service.verifySecurityEmail(flow.raw, latest)).rejects.toMatchObject({ status: 400 });
  });
  it('consumes email and finish steps only once under concurrent requests', async () => {
    const user = await account(); const flow = await service.beginSecurity(user.id, 'registration');
    const code = await emailCode(flow.raw);
    const emailResults = await Promise.allSettled([service.verifySecurityEmail(flow.raw, code), service.verifySecurityEmail(flow.raw, code)]);
    expect(emailResults.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const setup = await service.prepareTotp(flow.raw);
    await service.confirmTotpEnrollment(flow.raw, totpCode(setup.secret));
    const results = await Promise.allSettled([service.finishSecurity(flow.raw, true), service.finishSecurity(flow.raw, true)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('rejects authenticator replay across login flows', async () => {
    const { user, flow, setup } = await enroll(); await service.finishSecurity(flow.raw, true);
    const code = totpCode(setup.secret);
    await advance(user.id); const first = await service.beginSecurity(user.id, 'login');
    await service.verifySecurityEmail(first.raw, await emailCode(first.raw));
    await service.verifySecondFactor(first.raw, code); await service.finishSecurity(first.raw);
    await advance(user.id); const second = await service.beginSecurity(user.id, 'login');
    await service.verifySecurityEmail(second.raw, await emailCode(second.raw));
    await expect(service.verifySecondFactor(second.raw, code)).rejects.toMatchObject({ status: 400 });
  });
  it('does not expose reset account existence via cooldown or exhausted budgets', async () => {
    const user = await account(); const known = await service.beginSecurity(user.id, 'reset');
    const unknown = await service.beginSecurity(null, 'reset');
    expect(await service.resendSecurityCode(known.raw)).toEqual(await service.resendSecurityCode(unknown.raw));
    await prisma.accountSecurity.update({ where: { userId: user.id }, data: { failures: 10, sends: 5 } });
    expect(await service.resendSecurityCode(known.raw)).toEqual(await service.resendSecurityCode(unknown.raw));
    expect((await service.securityStatus(known.raw)).next).toBe('email');
    await expect(service.verifySecurityEmail(known.raw, await emailCode(known.raw))).rejects.toMatchObject({ status: 400, code: 'SECURITY_INVALID' });
  });
  it('rejects a suspended account even with an existing restricted flow', async () => {
    const user = await account(); const flow = await service.beginSecurity(user.id, 'registration');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });
    await expect(service.verifySecurityEmail(flow.raw, await emailCode(flow.raw))).rejects.toMatchObject({ status: 401 });
  });

  it('attack: knowing an email must not let a reset request cancel verified enrollment', async () => {
    const { user, flow } = await enroll();
    await advance(user.id);
    await service.beginSecurity(user.id, 'reset');
    expect((await service.securityStatus(flow.raw)).next).toBe('recovery');
  });
  async function fullSession() {
    const { user, flow } = await enroll();
    const response = await post('security/finish', `servix_security=${flow.raw}`, { savedRecovery: true });
    expect(response.statusCode).toBe(200);
    return { user, access: response.json().accessToken as string, cookie: `servix_refresh=${response.cookies.find(c => c.name === 'servix_refresh')!.value}` };
  }
  const accessStatus = async (access: string) => (await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${access}` } })).statusCode;
  it('attack: stolen access token cannot outlive logout of its session', async () => {
    const session = await fullSession(); expect(await accessStatus(session.access)).toBe(200);
    expect((await post('logout', session.cookie)).statusCode).toBe(200);
    expect(await accessStatus(session.access)).toBe(401);
  });
  it('attack: refresh replay kills issued access tokens as well as refresh tokens', async () => {
    const session = await fullSession();
    const rotated = await post('refresh', session.cookie); expect(rotated.statusCode).toBe(200);
    expect((await post('refresh', session.cookie)).statusCode).toBe(401);
    expect(await accessStatus(rotated.json().accessToken)).toBe(401);
  });
  it('attack: concurrent use of one refresh cookie cannot create sibling sessions', async () => {
    const session = await fullSession();
    const results = await Promise.all(Array.from({ length: 6 }, () => post('refresh', session.cookie)));
    expect(results.filter(r => r.statusCode === 200)).toHaveLength(1);
    expect(await prisma.refreshToken.count({ where: { userId: session.user.id, revokedAt: null } })).toBe(0);
  });
  it('attack: foreign-origin refresh and logout are rejected', async () => {
    const session = await fullSession();
    expect((await post('refresh', session.cookie, undefined, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await post('logout', session.cookie, undefined, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect(await accessStatus(session.access)).toBe(200);
  });
  it('attack: cancelled restricted cookie cannot be replayed', async () => {
    const { flow } = await enroll();
    expect((await post('security/cancel', `servix_security=${flow.raw}`)).statusCode).toBe(200);
    expect((await post('security/finish', `servix_security=${flow.raw}`, { savedRecovery: true })).statusCode).toBe(401);
  });

  it('attack: unsigned and payload-modified JWTs cannot become admin sessions', async () => {
    const session = await fullSession();
    const parts = session.access.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const modified = Buffer.from(JSON.stringify({ ...payload, role: 'admin' })).toString('base64url');
    expect(await accessStatus(`${parts[0]}.${modified}.${parts[2]}`)).toBe(401);
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(await accessStatus(`${none}.${modified}.`)).toBe(401);
    const admin = await app.inject({ url: '/api/v1/admin/users', headers: { authorization: `Bearer ${session.access}` } });
    expect(admin.statusCode).toBe(403);
  });
  it('attack: logging out one device does not revoke a different session family', async () => {
    const first = await fullSession(); await advance(first.user.id);
    const flow = await service.beginSecurity(first.user.id, 'login');
    await service.verifySecurityEmail(flow.raw, await emailCode(flow.raw));
    const stored = await prisma.accountSecurity.findUniqueOrThrow({ where: { userId: first.user.id } });
    await service.verifySecondFactor(flow.raw, totpCode(crypto.unseal<string>(stored.totpSecret!)));
    const second = await post('security/finish', `servix_security=${flow.raw}`);
    expect(second.statusCode).toBe(200);
    await post('logout', first.cookie);
    expect(await accessStatus(first.access)).toBe(401);
    expect(await accessStatus(second.json().accessToken)).toBe(200);
  });
  it('attack: refresh racing logout cannot leave a live descendant session', async () => {
    const session = await fullSession();
    await Promise.all([post('refresh', session.cookie), post('logout', session.cookie)]);
    expect(await accessStatus(session.access)).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: session.user.id, revokedAt: null } })).toBe(0);
  });
  it('attack: recovery-code concurrent redemption succeeds only once', async () => {
    const { user, flow, enrolled } = await enroll(); await service.finishSecurity(flow.raw, true);
    await advance(user.id); const login = await service.beginSecurity(user.id, 'login');
    await service.verifySecurityEmail(login.raw, await emailCode(login.raw));
    const results = await Promise.allSettled([service.verifySecondFactor(login.raw, enrolled.recoveryCodes[0], true), service.verifySecondFactor(login.raw, enrolled.recoveryCodes[0], true)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('documents bearer limitation: a copied unrevoked access token is usable until revocation', async () => {
    const session = await fullSession();
    const attacker = await app.inject({ url: '/api/v1/me', remoteAddress: '198.51.100.20', headers: { authorization: `Bearer ${session.access}`, 'user-agent': 'different-client' } });
    expect(attacker.statusCode).toBe(200);
    await post('logout', session.cookie);
    expect(await accessStatus(session.access)).toBe(401);
  });

  function virtualPasskey() {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    const id = randomBytes(32); const rpHash = createHash('sha256').update('servix.name.ng').digest();
    const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))]]));
    return {
      registration(challenge: string, expectedOrigin = origin) {
        const length = Buffer.alloc(2); length.writeUInt16BE(id.length);
        const auth = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), length, id, cose]);
        const attestation = isoCBOR.encode(new Map<string, any>([['fmt', 'none'], ['authData', new Uint8Array(auth)], ['attStmt', new Map()]]));
        return { id: id.toString('base64url'), rawId: id.toString('base64url'), type: 'public-key' as const, clientExtensionResults: {}, response: {
          clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: expectedOrigin })).toString('base64url'),
          attestationObject: Buffer.from(attestation).toString('base64url'), transports: ['internal' as const] } };
      },
      assertion(challenge: string, counter = 1, expectedOrigin = origin, userVerified = true) {
        const count = Buffer.alloc(4); count.writeUInt32BE(counter);
        const auth = Buffer.concat([rpHash, Buffer.from([userVerified ? 0x05 : 0x01]), count]);
        const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: expectedOrigin }));
        const signature = sign('sha256', Buffer.concat([auth, createHash('sha256').update(client).digest()]), privateKey);
        return { id: id.toString('base64url'), rawId: id.toString('base64url'), type: 'public-key' as const, clientExtensionResults: {}, response: {
          clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'), signature: signature.toString('base64url') } };
      },
    };
  }
  it('verifies real WebAuthn signatures and rejects origin mismatch, replay and missing UV', async () => {
    const user = await account(); const flow = await service.beginSecurity(user.id, 'registration');
    await service.verifySecurityEmail(flow.raw, await emailCode(flow.raw)); const key = virtualPasskey();
    const enrollOptions = await service.preparePasskey(flow.raw);
    const registered = await service.confirmPasskey(flow.raw, key.registration(enrollOptions.options.challenge));
    expect(registered.method).toBe('passkey'); await service.finishSecurity(flow.raw, true); await advance(user.id);
    const login = await service.beginSecurity(user.id, 'login'); await service.verifySecurityEmail(login.raw, await emailCode(login.raw));
    let challenge = (await service.preparePasskey(login.raw)).options.challenge;
    await expect(service.confirmPasskey(login.raw, key.assertion(challenge, 1, 'https://evil.example'))).rejects.toMatchObject({ status: 400 });
    // One-use challenge: cannot reuse after a rejected response.
    await expect(service.confirmPasskey(login.raw, key.assertion(challenge))).rejects.toMatchObject({ status: 400 });
    challenge = (await service.preparePasskey(login.raw)).options.challenge;
    await expect(service.confirmPasskey(login.raw, key.assertion(challenge, 1, origin, false))).rejects.toMatchObject({ status: 400 });
    challenge = (await service.preparePasskey(login.raw)).options.challenge;
    expect((await service.confirmPasskey(login.raw, key.assertion(challenge))).next).toBe('finish');
    await service.finishSecurity(login.raw);
    await advance(user.id); const next = await service.beginSecurity(user.id, 'login'); await service.verifySecurityEmail(next.raw, await emailCode(next.raw));
    challenge = (await service.preparePasskey(next.raw)).options.challenge;
    await expect(service.confirmPasskey(next.raw, key.assertion(challenge, 1))).rejects.toMatchObject({ status: 400 });
  });
});
