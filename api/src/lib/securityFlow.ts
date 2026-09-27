/** Restricted multi-step authentication. Never an application session. */
import { randomBytes, randomUUID } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON, type AuthenticatorTransportFuture } from '@simplewebauthn/server';
import type { Prisma, SecurityFlow, User, AccountSecurity } from '../generated/prisma/client.js';
import { prisma } from './db.js';
import { ApiError, unauthorized } from './errors.js';
import { sha256 } from './tokens.js';
import { emailOtpMail, securityNoticeMail } from './mailer.js';
import { audit } from './audit.js';
import { seal, unseal, securityDigest, equalDigest, randomCode, newTotp, verifyTotp, recoveryCodes, normalizeRecovery } from './securityCrypto.js';

const TTL = 15 * 60_000;
const WINDOW = 60 * 60_000;
type Tx = Prisma.TransactionClient;
type Context = { tx: Tx; flow: SecurityFlow; user: User; security: AccountSecurity };
type Failure = { failure: { status: number; code: string; message: string } };
const fail = (message = 'Verification failed. Use the newest code or restart sign-in.', code = 'SECURITY_INVALID', status = 400): Failure => ({ failure: { status, code, message } });
function assertResult<T>(value: T | Failure): T {
  if (value && typeof value === 'object' && 'failure' in value) {
    const { status, code, message } = (value as Failure).failure;
    throw new ApiError(status, code, message);
  }
  return value as T;
}
const active = (user: User) => !user.deletedAt && !['suspended', 'deactivated'].includes(user.status);
const view = (flow: SecurityFlow, user: User | null, security: AccountSecurity | null) => ({
  next: flow.stage, purpose: flow.purpose, method: flow.purpose === 'reset' && flow.stage === 'email' ? null : security?.method ?? null,
  email: user && !(flow.purpose === 'reset' && flow.stage === 'email') ? user.email.replace(/^(.).+(@.*)$/, '$1•••$2') : 'your email address', expiresAt: flow.expiresAt.toISOString(),
});
export const rpID = () => process.env.AUTH_WEBAUTHN_RP_ID ?? 'servix.name.ng';
export const webauthnOrigins = () => (process.env.AUTH_WEBAUTHN_ORIGINS ?? 'https://servix.name.ng,https://www.servix.name.ng').split(',').map(v => v.trim()).filter(Boolean);
async function budget(tx: Tx, userId: string) {
  const state = await tx.accountSecurity.upsert({ where: { userId }, create: { userId }, update: {} });
  if (Date.now() - state.windowStart.getTime() >= WINDOW) return tx.accountSecurity.update({ where: { userId }, data: { failures: 0, sends: 0, windowStart: new Date() } });
  return state;
}
async function wrong(c: Context, message?: string): Promise<Failure> {
  await c.tx.accountSecurity.update({ where: { userId: c.user.id }, data: { failures: { increment: 1 } } });
  return fail(message);
}
async function locked<T>(raw: string, operation: (c: Context) => Promise<T | Failure>): Promise<T> {
  const result = await prisma.$transaction(async tx => {
    const found = await tx.securityFlow.findUnique({ where: { tokenHash: sha256(raw) } });
    if (found && !found.userId && found.purpose === 'reset' && found.stage === 'email' && found.expiresAt > new Date()) return fail();
    if (!found?.userId) return fail('Your verification session is invalid or expired. Start again.', 'SECURITY_EXPIRED', 401);
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${found.userId} FOR UPDATE`;
    const flow = await tx.securityFlow.findUnique({ where: { id: found.id } });
    const user = await tx.user.findUnique({ where: { id: found.userId } });
    if (!flow || !user || !active(user) || flow.expiresAt <= new Date() || flow.stage === 'complete') return fail('Your verification session expired. Start again.', 'SECURITY_EXPIRED', 401);
    const security = await budget(tx, user.id);
    if (security.failures >= 10 && !(flow.purpose === 'reset' && flow.stage === 'email')) return fail('Too many verification attempts. Wait one hour.', 'SECURITY_LIMIT', 429);
    return operation({ tx, user, flow, security });
  });
  return assertResult<T>(result);
}
async function queueCode(c: Context) {
  const { tx, user, flow, security } = c;
  // Before email proof, never reveal account existence through resend budgets.
  if (flow.purpose === 'reset' && (security.failures >= 10 || security.sends >= 5 || (security.lastSentAt && Date.now() - security.lastSentAt.getTime() < 60_000))) return { ok: true, retryAfterSeconds: 60 };
  if (security.sends >= 5) return fail('Email request limit reached. Wait one hour.', 'SECURITY_LIMIT', 429);
  if (security.lastSentAt && Date.now() - security.lastSentAt.getTime() < 60_000) return fail('Wait 60 seconds before requesting another email.', 'SECURITY_COOLDOWN', 429);
  const code = randomCode();
  const digest = securityDigest('email', flow.id, code);
  const expiry = new Date(Date.now() + 10 * 60_000);
  await tx.securityFlow.update({ where: { id: flow.id }, data: { emailDigest: digest, emailExpiresAt: expiry } });
  await tx.accountSecurity.update({ where: { userId: user.id }, data: { sends: { increment: 1 }, lastSentAt: new Date() } });
  const mail = emailOtpMail(user.email, code, flow.purpose === 'reset' ? 'reset' : flow.purpose === 'login' ? 'login' : 'registration');
  await tx.job.create({ data: { queue: 'email', name: 'email.send', payload: {
    securityMail: seal(mail), flowId: flow.id, emailDigest: digest, expiresAt: expiry.toISOString() }, idempotencyKey: `security-${randomUUID()}` } });
  return { ok: true, retryAfterSeconds: 60 };
}
/** Caller proves password/provider identity first, except for reset requests. */
export async function beginSecurity(userId: string | null, purpose: 'registration' | 'login' | 'reset') {
  const raw = randomBytes(32).toString('base64url');
  const result = await prisma.$transaction(async tx => {
    let user: User | null = null;
    let security: AccountSecurity | null = null;
    if (userId) {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || !active(user)) throw unauthorized();
      security = await budget(tx, userId);
      if (security.failures >= 10) throw new ApiError(429, 'SECURITY_LIMIT', 'Too many attempts. Wait one hour.');
      if (security.sends >= 5 || (security.lastSentAt && Date.now() - security.lastSentAt.getTime() < 60_000)) throw new ApiError(429, 'SECURITY_COOLDOWN', 'Please wait before starting another verification.');
      await tx.securityFlow.updateMany({ where: { userId, ...(purpose === 'reset' ? { purpose: 'reset', stage: 'email' } : { stage: { not: 'complete' } }) }, data: { stage: 'complete', pendingSecret: null, pendingIdentity: null, recoveryEnvelope: null, emailDigest: null, challenge: null } });
    }
    const flow = await tx.securityFlow.create({ data: { tokenHash: sha256(raw), userId, purpose, stage: 'email', expiresAt: new Date(Date.now() + TTL) } });
    if (user && security) assertResult(await queueCode({ tx, user, security, flow }));
    return view(flow, user, security);
  });
  return { raw, ...result };
}
/** Called only after server-side provider identity verification. */
export async function beginProviderSecurity(userId: string, pendingIdentity?: { provider: string; subject: string }, expectedVersion?: number) {
  const raw = randomBytes(32).toString('base64url');
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !active(user)) throw unauthorized();
    const security = await budget(tx, user.id);
    if (security.failures >= 10) throw new ApiError(429, 'SECURITY_LIMIT', 'Too many verification attempts. Wait one hour.');
    if (pendingIdentity && (!security.method || expectedVersion !== user.authVersion)) throw unauthorized('Sign in again before connecting a provider.');
    if (pendingIdentity) {
      const exists = await tx.oAuthIdentity.findFirst({ where: { provider: pendingIdentity.provider, OR: [{ subject: pendingIdentity.subject }, { userId }] } });
      if (exists) throw new ApiError(409, 'OAUTH_LINK_CONFLICT', 'This provider is already connected.');
    }
    await tx.securityFlow.updateMany({ where: { userId, stage: { not: 'complete' } }, data: { stage: 'complete', pendingSecret: null, pendingIdentity: null, recoveryEnvelope: null, emailDigest: null, challenge: null } });
    const flow = await tx.securityFlow.create({ data: { tokenHash: sha256(raw), userId, purpose: pendingIdentity ? 'link' : 'social',
      stage: security.method ? 'factor' : 'enroll', expiresAt: new Date(Date.now() + TTL), pendingIdentity: pendingIdentity ? seal(pendingIdentity) : null } });
    return view(flow, user, security);
  });
  return { raw, ...result };
}
async function dummyReset(raw: string) {
  const flow = await prisma.securityFlow.findUnique({ where: { tokenHash: sha256(raw) } });
  return flow && !flow.userId && flow.purpose === 'reset' && flow.stage === 'email' && flow.expiresAt > new Date() ? flow : null;
}
export async function securityStatus(raw: string) {
  const dummy = await dummyReset(raw);
  if (dummy) return view(dummy, null, null);
  return locked(raw, async c => view(c.flow, c.user, c.security));
}
export async function resendSecurityCode(raw: string) {
  const dummy = await dummyReset(raw);
  if (dummy) return { ok: true, retryAfterSeconds: 60 };
  return locked(raw, async c => c.flow.stage === 'email' ? queueCode(c) : fail('This step is already complete.'));
}
export async function verifySecurityEmail(raw: string, code: string) {
  return locked(raw, async c => {
    const { tx, flow, user, security } = c;
    if (flow.stage !== 'email') return fail('Email verification is not the current step.');
    if (security.failures >= 10) return fail();
    if (!flow.emailDigest || !flow.emailExpiresAt || flow.emailExpiresAt <= new Date() || !equalDigest(flow.emailDigest, securityDigest('email', flow.id, code))) return wrong(c);
    if (flow.purpose === 'reset' && !security.method) return fail('No security method is enrolled. Contact support for account recovery.', 'RECOVERY_REQUIRED', 403);
    const next = security.method ? 'factor' : 'enroll';
    await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    const updated = await tx.securityFlow.update({ where: { id: flow.id }, data: { stage: next, emailDigest: null } });
    return view(updated, user, security);
  });
}
export async function prepareTotp(raw: string) {
  return locked(raw, async c => {
    if (c.flow.stage !== 'enroll' || c.security.method) return fail('Authenticator enrollment is not available for this step.');
    const generated = newTotp(c.user.email);
    await c.tx.securityFlow.update({ where: { id: c.flow.id }, data: { pendingSecret: seal(generated.secret), challenge: null, challengeType: null } });
    return { secret: generated.secret, uri: generated.uri };
  });
}
async function securityNotice(c: Context, action: string, text: string) {
  await audit(c.tx, { actorId: c.user.id, action, entity: 'user', entityId: c.user.id });
  await c.tx.job.create({ data: { queue: 'email', name: 'email.send', payload: { ...securityNoticeMail(c.user.email, action, text) }, idempotencyKey: `security-notice-${randomUUID()}` } });
}
async function enrolled(c: Context, method: 'totp' | 'passkey') {
  await securityNotice(c, 'security.enrolled', `A ${method === 'totp' ? 'Google Authenticator-compatible authenticator' : 'passkey'} was enrolled on your Servix account.`);
  const codes = recoveryCodes();
  await c.tx.recoveryCode.deleteMany({ where: { userId: c.user.id } });
  await c.tx.recoveryCode.createMany({ data: codes.map(code => ({ userId: c.user.id, digest: securityDigest('recovery', c.user.id, normalizeRecovery(code)) })) });
  const security = await c.tx.accountSecurity.update({ where: { userId: c.user.id }, data: { method } });
  const flow = await c.tx.securityFlow.update({ where: { id: c.flow.id }, data: { stage: 'recovery', pendingSecret: null, challenge: null, challengeType: null, recoveryEnvelope: seal(codes) } });
  return { ...view(flow, c.user, security), recoveryCodes: codes };
}
export async function confirmTotpEnrollment(raw: string, code: string) {
  return locked(raw, async c => {
    if (c.flow.stage !== 'enroll' || c.security.method || !c.flow.pendingSecret) return fail('Start authenticator setup first.');
    const secret = unseal<string>(c.flow.pendingSecret);
    const step = verifyTotp(secret, code, -1);
    if (step === null) return wrong(c, 'That authenticator code is incorrect. Check your device time and try the next code.');
    await c.tx.accountSecurity.update({ where: { userId: c.user.id }, data: { totpSecret: seal(secret), lastTotpStep: step } });
    return enrolled(c, 'totp');
  });
}
export async function preparePasskey(raw: string) {
  return locked(raw, async c => {
    const enrolling = c.flow.stage === 'enroll' && !c.security.method;
    if (!enrolling && !(c.flow.stage === 'factor' && c.security.method === 'passkey')) return fail('Passkey verification is not available for this step.');
    const credentials = await c.tx.passkeyCredential.findMany({ where: { userId: c.user.id } });
    const descriptors = credentials.map(key => ({ id: key.id, transports: key.transports as AuthenticatorTransportFuture[] }));
    const options = enrolling ? await generateRegistrationOptions({ rpName: 'Servix', rpID: rpID(), userID: new TextEncoder().encode(c.user.id),
      userName: c.user.email, userDisplayName: c.user.fullName, attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }, excludeCredentials: descriptors }) :
      await generateAuthenticationOptions({ rpID: rpID(), userVerification: 'required', allowCredentials: descriptors });
    await c.tx.securityFlow.update({ where: { id: c.flow.id }, data: { challenge: options.challenge, challengeType: enrolling ? 'register' : 'authenticate', pendingSecret: null } });
    return { options, enrolling };
  });
}
async function factorComplete(c: Context) {
  const stage = c.flow.purpose === 'reset' ? 'reset_password' : 'finish';
  const updated = await c.tx.securityFlow.update({ where: { id: c.flow.id }, data: { stage, challenge: null, challengeType: null } });
  return view(updated, c.user, c.security);
}
export async function confirmPasskey(raw: string, response: RegistrationResponseJSON | AuthenticationResponseJSON) {
  return locked(raw, async c => {
    const { tx, flow, user, security } = c;
    if (!flow.challenge) return fail('Request a new passkey prompt and try again.');
    await tx.securityFlow.update({ where: { id: flow.id }, data: { challenge: null, challengeType: null } });
    // Catch verification/parsing errors only. Database failures must roll back.
    if (flow.stage === 'enroll' && flow.challengeType === 'register' && !security.method) {
      let result;
      try { result = await verifyRegistrationResponse({ response: response as RegistrationResponseJSON, expectedChallenge: flow.challenge,
        expectedOrigin: webauthnOrigins(), expectedRPID: rpID(), requireUserVerification: true }); }
      catch { return wrong(c, 'Passkey setup failed. Request a new prompt and try again.'); }
      if (!result.verified || !result.registrationInfo) return wrong(c);
      const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
      if (await tx.passkeyCredential.findUnique({ where: { id: credential.id } })) return wrong(c);
      await tx.passkeyCredential.create({ data: { id: credential.id, userId: user.id, publicKey: Buffer.from(credential.publicKey), counter: BigInt(credential.counter),
        transports: credential.transports ?? [], deviceType: credentialDeviceType, backedUp: credentialBackedUp } });
      return enrolled(c, 'passkey');
    }
    if (flow.stage === 'factor' && flow.challengeType === 'authenticate' && security.method === 'passkey') {
      const credential = await tx.passkeyCredential.findUnique({ where: { id: response.id } });
      if (!credential || credential.userId !== user.id) return wrong(c);
      let result;
      try { result = await verifyAuthenticationResponse({ response: response as AuthenticationResponseJSON, expectedChallenge: flow.challenge,
        expectedOrigin: webauthnOrigins(), expectedRPID: rpID(), requireUserVerification: true,
        credential: { id: credential.id, publicKey: new Uint8Array(credential.publicKey), counter: Number(credential.counter), transports: credential.transports as AuthenticatorTransportFuture[] } }); }
      catch { return wrong(c, 'Passkey verification failed. Request a new prompt and use your enrolled passkey.'); }
      if (!result.verified) return wrong(c);
      await tx.passkeyCredential.update({ where: { id: credential.id }, data: { counter: BigInt(result.authenticationInfo.newCounter), backedUp: result.authenticationInfo.credentialBackedUp } });
      return factorComplete(c);
    }
    return fail('Passkey is not the enrolled method or current step.');
  });
}
export async function verifySecondFactor(raw: string, code: string, recovery = false) {
  return locked(raw, async c => {
    if (c.flow.stage !== 'factor' || !c.security.method) return fail('Security verification is not the current step.');
    if (recovery) {
      const digest = securityDigest('recovery', c.user.id, normalizeRecovery(code));
      const stored = await c.tx.recoveryCode.findUnique({ where: { userId_digest: { userId: c.user.id, digest } } });
      if (!stored || stored.usedAt) return wrong(c, 'That recovery code is invalid or already used.');
      await c.tx.recoveryCode.update({ where: { id: stored.id }, data: { usedAt: new Date() } });
      await c.tx.user.update({ where: { id: c.user.id }, data: { authVersion: { increment: 1 } } });
      await c.tx.refreshToken.updateMany({ where: { userId: c.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await c.tx.securityFlow.updateMany({ where: { userId: c.user.id, id: { not: c.flow.id } }, data: { stage: 'complete', pendingIdentity: null, pendingSecret: null, recoveryEnvelope: null, emailDigest: null, challenge: null, challengeType: null } });
      await securityNotice(c, 'security.recovery_used', 'A single-use recovery code was used on your account. Existing sessions have been signed out.');
    } else {
      if (c.security.method !== 'totp' || !c.security.totpSecret) return fail('Use your enrolled passkey instead.');
      const step = verifyTotp(unseal<string>(c.security.totpSecret), code, c.security.lastTotpStep);
      if (step === null) return wrong(c, 'Code is incorrect or already used. Wait for the next Google Authenticator code.');
      await c.tx.accountSecurity.update({ where: { userId: c.user.id }, data: { lastTotpStep: step } });
    }
    return factorComplete(c);
  });
}
export const readRecoveryCodes = (raw: string) => locked(raw, async c => {
  if (c.flow.stage !== 'recovery' || !c.flow.recoveryEnvelope) return fail('Recovery codes are no longer available to view.');
  return { recoveryCodes: unseal<string[]>(c.flow.recoveryEnvelope) };
});
export async function finishSecurity(raw: string, savedRecovery = false) {
  return locked(raw, async c => {
    if (!c.security.method || c.flow.purpose === 'reset' || !(c.flow.stage === 'finish' || (c.flow.stage === 'recovery' && savedRecovery))) return fail('Complete every verification step first.');
    if (c.flow.purpose === 'link') {
      if (!c.flow.pendingIdentity) return fail('Provider linking is no longer available.');
      const identity = unseal<{ provider: string; subject: string }>(c.flow.pendingIdentity);
      await c.tx.oAuthIdentity.create({ data: { ...identity, userId: c.user.id } });
      await securityNotice(c, 'security.provider_linked', `A ${identity.provider} sign-in was connected to your Servix account.`);
    }
    await c.tx.securityFlow.update({ where: { id: c.flow.id }, data: { stage: 'complete', recoveryEnvelope: null, pendingIdentity: null } });
    return c.tx.user.update({ where: { id: c.user.id }, data: { status: c.user.status === 'pending_verification' ? 'active' : c.user.status, lastLoginAt: new Date() } });
  });
}
export async function resetSecurityPassword(raw: string, passwordHash: string) {
  return locked(raw, async c => {
    if (c.flow.purpose !== 'reset' || c.flow.stage !== 'reset_password' || !c.security.method) return fail('Verify your email and existing security method before resetting your password.');
    await securityNotice(c, 'security.password_reset', 'Your Servix password was reset. Existing sessions have been signed out.');
    await c.tx.user.update({ where: { id: c.user.id }, data: { passwordHash, authVersion: { increment: 1 } } });
    await c.tx.refreshToken.updateMany({ where: { userId: c.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await c.tx.oneTimeToken.updateMany({ where: { userId: c.user.id, usedAt: null }, data: { usedAt: new Date() } });
    await c.tx.securityFlow.updateMany({ where: { userId: c.user.id }, data: { stage: 'complete', recoveryEnvelope: null, pendingSecret: null, pendingIdentity: null, challenge: null, emailDigest: null } });
    return { ok: true };
  });
}

/** Idempotent cancellation, including expired or rate-limited flows. */
export async function cancelSecurity(raw: string) {
  await prisma.$transaction(async tx => {
    const found = await tx.securityFlow.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!found) return;
    if (found.userId) await tx.$queryRaw`SELECT id FROM users WHERE id = ${found.userId} FOR UPDATE`;
    await tx.securityFlow.updateMany({ where: { id: found.id }, data: { stage: 'complete',
      pendingIdentity: null, pendingSecret: null, recoveryEnvelope: null, challenge: null, challengeType: null, emailDigest: null } });
  });
}
