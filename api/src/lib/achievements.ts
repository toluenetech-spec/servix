/**
 * Achievement rules — a central registry so new badges are one entry here.
 * Every rule is a pure function of TrustMetrics (real platform records);
 * badges are evaluated server-side and stored with the evidence that
 * earned them. Professionals cannot claim or edit them. A badge whose rule
 * stops holding is revoked (revoked_at), never deleted, so history stays.
 */
import { prisma } from './db.js';
import { computeTrust, type TrustMetrics } from './trust.js';
import { notifySafely } from './notifications.js';

export interface AchievementRule {
  slug: string;
  name: string;
  description: string; // criteria, shown to users
  icon: string;
  test: (m: TrustMetrics) => { earned: boolean; evidence: Record<string, unknown> };
}

export const ACHIEVEMENT_RULES: AchievementRule[] = [
  { slug: 'servix_verified', name: 'Servix Verified', description: 'Approved professional with a verified email and verified identity.', icon: 'shield',
    test: (m) => ({ earned: m.verified.professional && m.verified.email && m.verified.identity, evidence: m.verified }) },
  { slug: 'jobs_10', name: '10 Jobs Completed', description: '10 bookings completed through Servix.', icon: 'briefcase',
    test: (m) => ({ earned: m.completedJobs >= 10, evidence: { completedJobs: m.completedJobs } }) },
  { slug: 'jobs_25', name: '25 Jobs Completed', description: '25 bookings completed through Servix.', icon: 'briefcase',
    test: (m) => ({ earned: m.completedJobs >= 25, evidence: { completedJobs: m.completedJobs } }) },
  { slug: 'jobs_50', name: '50 Jobs Completed', description: '50 bookings completed through Servix.', icon: 'briefcase',
    test: (m) => ({ earned: m.completedJobs >= 50, evidence: { completedJobs: m.completedJobs } }) },
  { slug: 'top_rated', name: 'Top Rated', description: 'Average rating of 4.8 or higher across at least 10 reviews.', icon: 'star',
    test: (m) => ({ earned: m.rating.count >= 10 && (m.rating.average ?? 0) >= 4.8, evidence: m.rating }) },
  { slug: 'five_star', name: '5-Star Professional', description: 'Average rating of 5.0 across at least 5 reviews.', icon: 'star',
    test: (m) => ({ earned: m.rating.count >= 5 && (m.rating.average ?? 0) >= 5, evidence: m.rating }) },
  { slug: 'fast_responder', name: 'Fast Responder', description: 'Responds to at least 90% of paid requests, with a median response under 6 hours (minimum 5 requests).', icon: 'clock',
    test: (m) => ({ earned: m.response.sample >= 5 && (m.response.ratePercent ?? 0) >= 90 && (m.response.medianHours ?? 99) < 6, evidence: m.response }) },
  { slug: 'consistent_delivery', name: 'Consistent Delivery', description: 'Delivery reliability of 95% or higher across at least 5 measurable deliveries.', icon: 'check-circle',
    test: (m) => ({ earned: m.reliability.measurable >= 5 && (m.reliability.percent ?? 0) >= 95, evidence: m.reliability }) },
  { slug: 'repeat_clients', name: 'Repeat Client Professional', description: 'At least 30% of customers booked again (minimum 5 customers).', icon: 'users',
    test: (m) => ({ earned: m.repeatCustomers.customers >= 5 && (m.repeatCustomers.percent ?? 0) >= 30, evidence: m.repeatCustomers }) },
  { slug: 'long_term', name: 'Long-Term Professional', description: 'Active on Servix for over a year with at least 5 completed jobs.', icon: 'calendar',
    test: (m) => ({ earned: m.accountAgeDays >= 365 && m.completedJobs >= 5, evidence: { accountAgeDays: m.accountAgeDays, completedJobs: m.completedJobs } }) },
];

export const achievementCatalog = () => ACHIEVEMENT_RULES.map(({ slug, name, description, icon }) => ({ slug, name, description, icon }));

/** Re-evaluates every rule for one professional; returns newly earned slugs. */
export async function evaluateAchievements(professionalId: string, metrics?: TrustMetrics): Promise<{ earned: string[]; revoked: string[] }> {
  const m = metrics ?? (await computeTrust(professionalId));
  const existing = await prisma.professionalAchievement.findMany({ where: { professionalId } });
  const byslug = new Map(existing.map((a) => [a.slug, a]));
  const earned: string[] = []; const revoked: string[] = [];
  for (const rule of ACHIEVEMENT_RULES) {
    const { earned: ok, evidence } = rule.test(m);
    const row = byslug.get(rule.slug);
    if (ok && (!row || row.revokedAt)) {
      await prisma.professionalAchievement.upsert({ where: { professionalId_slug: { professionalId, slug: rule.slug } }, create: { professionalId, slug: rule.slug, evidence: evidence as object }, update: { revokedAt: null, earnedAt: new Date(), evidence: evidence as object } });
      earned.push(rule.slug);
    } else if (!ok && row && !row.revokedAt) {
      await prisma.professionalAchievement.update({ where: { id: row.id }, data: { revokedAt: new Date(), evidence: evidence as object } });
      revoked.push(rule.slug);
    }
  }
  if (earned.length) {
    const profile = await prisma.professionalProfile.findUnique({ where: { id: professionalId }, select: { userId: true } });
    if (profile?.userId) {
      for (const slug of earned) {
        const rule = ACHIEVEMENT_RULES.find((r) => r.slug === slug)!;
        await notifySafely({ userId: profile.userId, type: 'achievement.earned', title: `Achievement earned: ${rule.name}`, body: rule.description, link: '/dashboard/analytics' });
      }
    }
  }
  return { earned, revoked };
}

export async function listAchievements(professionalId: string) {
  const rows = await prisma.professionalAchievement.findMany({ where: { professionalId, revokedAt: null }, orderBy: { earnedAt: 'asc' } });
  return rows.map((r) => { const rule = ACHIEVEMENT_RULES.find((x) => x.slug === r.slug); return { slug: r.slug, name: rule?.name ?? r.slug, description: rule?.description ?? '', icon: rule?.icon ?? 'star', earnedAt: r.earnedAt.toISOString() }; });
}

/** Fire-and-forget refresh after booking transitions (never throws). */
export function refreshProfessionalStanding(professionalId: string): void {
  evaluateAchievements(professionalId).catch(() => {});
}
