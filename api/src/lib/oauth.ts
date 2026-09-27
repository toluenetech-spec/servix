import { randomBytes } from 'node:crypto';
import { prisma } from './db.js';
import { ApiError } from './errors.js';
import { sha256 } from './tokens.js';
import { seal, unseal } from './securityCrypto.js';
import { authorizationUrl, type Provider, type ProviderIdentity } from './oauthProvider.js';
import { beginProviderSecurity } from './securityFlow.js';

type AttemptSecret = { verifier: string; nonce: string; linkUserId?: string; authVersion?: number };
const invalid = () => new ApiError(400, 'OAUTH_INVALID', 'Your provider sign-in expired or could not be verified. Start again.');
export async function startOAuth(provider: Provider, link?: { userId: string; authVersion: number }) {
  const state = randomBytes(32).toString('base64url');
  const browser = randomBytes(32).toString('base64url');
  const secret: AttemptSecret = { verifier: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'),
    ...(link ? { linkUserId: link.userId, authVersion: link.authVersion } : {}) };
  const url = authorizationUrl(provider, state, secret.verifier, secret.nonce);
  await prisma.oAuthAttempt.create({ data: { provider, stateHash: sha256(state), browserHash: sha256(browser), envelope: seal(secret), expiresAt: new Date(Date.now() + 10 * 60_000) } });
  return { url, browser };
}
export async function consumeOAuth(provider: Provider, state: string, browser: string): Promise<AttemptSecret> {
  const where = { stateHash: sha256(state), browserHash: sha256(browser), provider, usedAt: null, expiresAt: { gt: new Date() } };
  return prisma.$transaction(async tx => {
    const attempt = await tx.oAuthAttempt.findFirst({ where });
    if (!attempt?.envelope) throw invalid();
    const changed = await tx.oAuthAttempt.updateMany({ where: { id: attempt.id, ...where }, data: { usedAt: new Date(), envelope: null } });
    if (changed.count !== 1) throw invalid();
    return unseal<AttemptSecret>(attempt.envelope);
  });
}
export async function acceptIdentity(identity: ProviderIdentity, attempt: AttemptSecret) {
  // Matching emails NEVER attach a provider to an existing account.
  if (attempt.linkUserId) {
    return beginProviderSecurity(attempt.linkUserId, { provider: identity.provider, subject: identity.subject }, attempt.authVersion);
  }
  const userId = await prisma.$transaction(async tx => {
    const existing = await tx.oAuthIdentity.findUnique({ where: { provider_subject: { provider: identity.provider, subject: identity.subject } } });
    if (existing) return existing.userId;
    if (await tx.user.findUnique({ where: { email: identity.email } })) {
      throw new ApiError(409, 'OAUTH_LINK_REQUIRED', 'Sign in using your existing method first, then explicitly connect this provider.');
    }
    // Deliberately non-password account. Password verification rejects this marker.
    const user = await tx.user.create({ data: { email: identity.email, fullName: identity.name || 'Servix member', passwordHash: '!oauth-only', emailVerifiedAt: new Date() } });
    await tx.oAuthIdentity.create({ data: { provider: identity.provider, subject: identity.subject, userId: user.id } });
    return user.id;
  });
  return beginProviderSecurity(userId);
}
