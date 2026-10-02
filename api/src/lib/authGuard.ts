/**
 * Authentication & authorization guards.
 *
 *   requireAuth          — valid Bearer access token
 *   requireProfessional  — token AND server-verified professional role.
 *   requireAdmin         — role re-read from the DATABASE (Phase E).
 *   requireKycVerified   — identity verification approved (users.kyc_status).
 *
 * Roles are re-read from the DATABASE, never trusted from the JWT alone,
 * so a stale or forged claim can never grant professional or admin access.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken, type AccessClaims } from './tokens.js';
import { ApiError, forbidden, unauthorized } from './errors.js';
import { mfaEnabled } from './securityCrypto.js';
import { prisma } from './db.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AccessClaims;
    professionalProfileId?: string;
  }
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const claims = await verifyAccessToken(header.slice(7));
  if (!claims) throw unauthorized('Invalid or expired token');
  if (mfaEnabled() || claims.sid) {
    if (!claims.sid || (mfaEnabled() && !claims.mfaVerified)) throw unauthorized('Complete security verification.');
    const user = await prisma.user.findUnique({ where: { id: claims.sub }, include: { security: true } });
    if (!user || user.deletedAt || ['suspended', 'deactivated'].includes(user.status) ||
        (mfaEnabled() && !user.security?.method) || user.authVersion !== claims.authVersion) {
      throw unauthorized('Session no longer valid.');
    }
    const session = await prisma.refreshToken.findFirst({ where: { userId: user.id, familyId: claims.sid,
      revokedAt: null, expiresAt: { gt: new Date() }, authVersion: user.authVersion,
      ...(mfaEnabled() ? { mfaVerified: true } : {}) }, select: { id: true } });
    if (!session) throw unauthorized('Session has been signed out.');
  }

  req.auth = claims;
}

export async function requireProfessional(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply);
  // Server-side truth: role and profile come from the DB, not the token.
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.sub },
    include: { professionalProfile: { select: { id: true } } },
  });
  if (!user || user.deletedAt || user.status === 'suspended') throw unauthorized();
  if (user.role !== 'professional' || !user.professionalProfile) {
    throw forbidden('Professional access required.');
  }
  req.professionalProfileId = user.professionalProfile.id;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply);
  // Server-side truth only — never trust the JWT's role claim for admin.
  const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
  if (!user || user.deletedAt || user.status === 'suspended') throw unauthorized();
  if (user.role !== 'admin') throw forbidden('Admin access required.');
}

export const KYC_REQUIRED_MESSAGE = 'Verify your identity before using this feature. Go to Dashboard → Identity verification.';

/**
 * Gate for sensitive actions (publishing gigs, requesting payouts). Reads
 * users.kyc_status from the database on every call so an approval or a
 * revocation takes effect immediately. Call after requireAuth/requireProfessional.
 */
export async function requireKycVerified(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.auth) await requireAuth(req, reply);
  const user = await prisma.user.findUnique({ where: { id: req.auth!.sub }, select: { kycStatus: true, role: true } });
  if (!user) throw unauthorized();
  if (user.role === 'admin') return;
  if (user.kycStatus !== 'verified') {
    throw new ApiError(403, 'KYC_REQUIRED', KYC_REQUIRED_MESSAGE, { kycStatus: user.kycStatus });
  }
}
