/**
 * Authentication & authorization guards.
 *
 *   requireAuth          — valid Bearer access token
 *   requireProfessional  — token AND server-verified professional role.
 *   requireAdmin         — role re-read from the DATABASE (Phase E).
 *
 * Roles are re-read from the DATABASE, never trusted from the JWT alone,
 * so a stale or forged claim can never grant professional or admin access.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken, type AccessClaims } from './tokens.js';
import { forbidden, unauthorized } from './errors.js';
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
