import { prisma } from './db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { unauthorized } from './errors.js';
import { effectivePlan } from './plans.js';
export const ONBOARDING_ACTION = 'account.onboarding_selected';
export async function accountOverview(userId: string, tx: Prisma.TransactionClient = prisma) {
  const user = await tx.user.findUnique({ where: { id: userId }, include: {
    professionalProfile: { select: { id: true, planSlug: true, planExpiresAt: true } },
    applications: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
    oauthIdentities: { select: { provider: true } },
  } });
  if (!user || user.deletedAt || ['suspended', 'deactivated'].includes(user.status)) throw unauthorized();
  const record = await tx.auditLog.findFirst({ where: { actorId: userId, entity: 'user', entityId: userId, action: ONBOARDING_ACTION }, orderBy: { createdAt: 'desc' } });
  const saved = (record?.data as { intent?: string } | null)?.intent;
  const application = user.applications[0]?.status ?? null;
  const canManageServices = user.role === 'professional' && Boolean(user.professionalProfile);
  const intent = application || user.role === 'professional' || saved === 'professional' ? 'professional' : 'customer';
  return {
    kind: user.role === 'admin' ? 'admin' : canManageServices ? 'professional' : intent === 'professional' ? 'applicant' : 'customer',
    intent, applicationStatus: application, canManageServices,
    emailVerified: Boolean(user.emailVerifiedAt),
    kycStatus: user.kycStatus,
    plan: canManageServices && user.professionalProfile ? effectivePlan(user.professionalProfile) : null,
    needsChoice: user.role === 'customer' && user.oauthIdentities.length > 0 && !record && !application,
  };
}
