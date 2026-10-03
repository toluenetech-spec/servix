/**
 * Subscriptions (Free / Go / Pro / Team / Enterprise) for EVERY account.
 *  - Capabilities per plan: `./entitlements/catalog.ts` (code) + operator overrides in `plans.limits`.
 *  - Prices/marketing copy: the `plans` table (seeded; editable by operators).
 *  - An account's plan is `users.plan_slug` + `users.plan_expires_at`; an expired paid plan behaves exactly
 *    like `free` (no silent grace period). Professional profiles mirror the columns for public badges.
 *  - Team / Enterprise plans are shared with an organisation's members through the entitlement engine.
 *  - Purchases go through the SAME payment provider abstraction as bookings: a `plan_subscriptions` row is
 *    created `initiated`, the provider checkout opens, and activation happens only after verification
 *    (return URL or signed webhook) as a compare-and-swap. Switching plans takes effect immediately for a
 *    fresh 30-day term; renewing the same plan extends the current term. Downgrading never deletes data.
 *  - Enterprise is arranged with Servix and assigned by an administrator (`grantPlan`), never bought online.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { ApiError } from './errors.js';
import { getPaymentProvider } from './payments.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import {
  PLAN_LABEL, PLAN_RANK, PLAN_SLUGS, PURCHASABLE, isPlanSlug, loadPlanOverrides, effectivePlanTable, resolveEntitlements,
  assertWithinLimit, type Entitlements, type PlanSlug,
} from './entitlements/index.js';
import { aiMeters, readMeter, periodStart, nextPeriodStart } from './entitlements/usage.js';

export const PLAN_DAYS = 30;
export { PLAN_LABEL };

/** Effective plan of a profile/user row (expired → free). Used for public badges and admin tallies. */
export function effectivePlan(row: { planSlug: string; planExpiresAt: Date | null }, now = new Date()): PlanSlug {
  if (!isPlanSlug(row.planSlug) || row.planSlug === 'free') return 'free';
  if (row.planExpiresAt && row.planExpiresAt <= now) return 'free';
  return row.planSlug;
}

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** Public catalogue with effective limits (defaults + operator overrides). */
export async function planCatalog() {
  const [plans, overrides] = await Promise.all([
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { position: 'asc' } }),
    loadPlanOverrides(),
  ]);
  return plans.filter((p) => isPlanSlug(p.slug)).map((p) => {
    const slug = p.slug as PlanSlug;
    const table = effectivePlanTable(slug, overrides);
    return {
      slug, name: p.name, tagline: p.tagline, price: Number(p.price), currency: p.currency, period: p.period, cta: p.cta, features: p.features, highlighted: p.highlighted,
      limits: table.limits, capabilities: table.features, aiDepartments: table.aiDepartments,
      purchasable: PURCHASABLE.includes(slug) && Number(p.price) > 0, rank: PLAN_RANK[slug],
    };
  });
}

/** Everything the Plan page needs for one account: plan, entitlements, meters, catalogue, history. */
export async function planSummary(userId: string, now = new Date()) {
  const ent = await resolveEntitlements(userId, now);
  return planSummaryFor(ent, now);
}

export async function planSummaryFor(ent: Entitlements, now = new Date()) {
  const userId = ent.userId;
  const [profile, plans, subscriptions, ai, exportsMeter, savedPros, savedSearches, orgMembers] = await Promise.all([
    prisma.professionalProfile.findUnique({ where: { userId }, select: { id: true } }),
    planCatalog(),
    prisma.planSubscription.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 12 }),
    aiMeters(ent, now),
    readMeter({ type: 'user', id: userId }, 'exports', ent.limits.monthly_exports, now),
    prisma.savedProfessional.count({ where: { userId } }),
    prisma.savedSearch.count({ where: { userId } }),
    ent.organization ? prisma.organizationMember.count({ where: { organizationId: ent.organization.id } }) : Promise.resolve(0),
  ]);
  const monthStart = periodStart(now);
  const usage: Record<string, number> = { saved_professionals: savedPros, saved_searches: savedSearches, monthly_exports: exportsMeter.used, team_members: orgMembers };
  if (profile) {
    const pid = profile.id;
    const [listings, portfolio, proposalsMonth, proposalsActive, versions] = await Promise.all([
      prisma.service.count({ where: { professionalId: pid, status: { not: 'archived' } } }),
      prisma.portfolioItem.count({ where: { professionalId: pid } }),
      prisma.proposal.count({ where: { professionalId: pid, createdAt: { gte: monthStart } } }),
      prisma.proposal.count({ where: { professionalId: pid, status: 'submitted' } }),
      prisma.profileVersion.count({ where: { professionalId: pid } }),
    ]);
    Object.assign(usage, { listings, portfolio_items: portfolio, monthly_proposals: proposalsMonth, active_proposals: proposalsActive, profile_versions: versions });
  }
  const [requestsMonth, requestsActive] = await Promise.all([
    prisma.serviceRequest.count({ where: { customerId: userId, createdAt: { gte: monthStart } } }),
    prisma.serviceRequest.count({ where: { customerId: userId, status: { in: ['draft', 'open', 'paused'] } } }),
  ]);
  Object.assign(usage, { monthly_requests: requestsMonth, active_requests: requestsActive });

  return {
    current: ent.plan, label: ent.planLabel, source: ent.source,
    own: { plan: ent.own.plan, label: PLAN_LABEL[ent.own.plan], expiresAt: ent.own.plan === 'free' ? null : ent.own.expiresAt?.toISOString() ?? null, expired: ent.own.expired },
    expiresAt: ent.own.plan === 'free' ? null : ent.own.expiresAt?.toISOString() ?? null,
    expired: ent.own.expired,
    organization: ent.organization,
    features: ent.features, limits: ent.limits, aiDepartments: ent.aiDepartments,
    usage,
    ai: { ...ai.pool, member: ai.member, subject: ent.aiSubject.type },
    period: { start: monthStart.toISOString(), resetAt: nextPeriodStart(now).toISOString() },
    plans,
    subscriptions: subscriptions.map((s) => ({ id: s.id, plan: s.planSlug, status: s.status, reference: s.reference, amount: Number(s.amountKobo / 100n), currency: s.currency, startsAt: s.startsAt?.toISOString() ?? null, endsAt: s.endsAt?.toISOString() ?? null, createdAt: s.createdAt.toISOString() })),
  };
}

/** Listing cap for the effective plan; throws 403 PLAN_LIMIT when reached. */
export async function assertListingAllowed(professionalId: string, ent: Entitlements): Promise<void> {
  const count = await prisma.service.count({ where: { professionalId, status: { not: 'archived' } } });
  assertWithinLimit(ent, 'listings', count, 1);
}

export async function startPlanCheckout(userId: string, email: string, planSlug: string, appBase: string) {
  if (!isPlanSlug(planSlug) || !PURCHASABLE.includes(planSlug)) throw new ApiError(422, 'VALIDATION_ERROR', 'That plan cannot be purchased online.');
  const plan = await prisma.plan.findFirst({ where: { slug: planSlug, isActive: true } });
  if (!plan || Number(plan.price) <= 0) throw new ApiError(422, 'VALIDATION_ERROR', 'That plan cannot be purchased online.');
  const open = await prisma.planSubscription.findFirst({ where: { userId, status: 'initiated', createdAt: { gte: new Date(Date.now() - 30 * 60_000) } }, orderBy: { createdAt: 'desc' } });
  const provider = getPaymentProvider();
  const amountKobo = BigInt(plan.price) * 100n;
  const callbackUrl = `${appBase}/dashboard/plan`;
  if (open && open.planSlug === plan.slug) {
    const init = await provider.initialize({ reference: open.reference, amountKobo: open.amountKobo, email, callbackUrl: `${callbackUrl}?reference=${encodeURIComponent(open.reference)}` });
    return { authorizationUrl: init.authorizationUrl, reference: open.reference };
  }
  const profile = await prisma.professionalProfile.findUnique({ where: { userId }, select: { id: true } });
  const reference = `sub-${randomUUID()}`;
  await prisma.planSubscription.create({ data: { userId, professionalId: profile?.id ?? null, planSlug: plan.slug, reference, amountKobo, currency: plan.currency, provider: provider.name } });
  await audit(prisma, { actorId: userId, action: 'plan.checkout_started', entity: 'plan_subscription', entityId: reference, data: { plan: plan.slug, amountKobo: amountKobo.toString() } });
  const init = await provider.initialize({ reference, amountKobo, email, callbackUrl: `${callbackUrl}?reference=${encodeURIComponent(reference)}` });
  return { authorizationUrl: init.authorizationUrl, reference };
}

/** Verify with the provider and activate (idempotent). Returns the subscription status. */
export async function verifySubscription(reference: string): Promise<'active' | 'failed' | 'initiated'> {
  const sub = await prisma.planSubscription.findUnique({ where: { reference } });
  if (!sub) throw new ApiError(404, 'NOT_FOUND', 'Unknown plan reference.');
  if (sub.status === 'active') return 'active';
  if (sub.status !== 'initiated') return 'failed';
  const verification = await getPaymentProvider().verify(reference);
  if (verification.status === 'failed') { await failSubscription(reference); return 'failed'; }
  if (verification.status !== 'success') return 'initiated';
  if (verification.amountKobo !== sub.amountKobo || verification.currency !== sub.currency) throw new Error(`Plan amount mismatch for ${reference}`);
  await activateSubscription(reference);
  return 'active';
}

export async function failSubscription(reference: string): Promise<void> {
  await prisma.planSubscription.updateMany({ where: { reference, status: 'initiated' }, data: { status: 'failed' } });
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Writes the plan onto the user (and the professional profile mirror) inside a transaction. */
async function applyPlan(tx: Tx, userId: string, planSlug: PlanSlug, expiresAt: Date | null): Promise<void> {
  await tx.user.update({ where: { id: userId }, data: { planSlug, planExpiresAt: expiresAt } });
  await tx.professionalProfile.updateMany({ where: { userId }, data: { planSlug, planExpiresAt: expiresAt } });
}

export async function activateSubscription(reference: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const sub = await tx.planSubscription.findUniqueOrThrow({ where: { reference }, include: { professional: { select: { userId: true } } } });
    const cas = await tx.planSubscription.updateMany({ where: { id: sub.id, status: 'initiated' }, data: { status: 'active', verifiedAt: now, startsAt: now } });
    if (cas.count === 0) return false;
    const userId = sub.userId ?? sub.professional?.userId ?? null;
    if (!userId) throw new Error(`Plan subscription ${reference} has no account`);
    if (!isPlanSlug(sub.planSlug)) throw new Error(`Plan subscription ${reference} has unknown plan ${sub.planSlug}`);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { planSlug: true, planExpiresAt: true } });
    // Renewing the same plan extends the current term; switching plans starts a fresh term now.
    const base = user.planSlug === sub.planSlug && user.planExpiresAt && user.planExpiresAt > now ? user.planExpiresAt : now;
    const endsAt = new Date(base.getTime() + PLAN_DAYS * 86_400_000);
    await tx.planSubscription.update({ where: { id: sub.id }, data: { endsAt, userId } });
    await applyPlan(tx, userId, sub.planSlug, endsAt);
    await audit(tx, { actorId: userId, action: 'plan.activated', entity: 'plan_subscription', entityId: sub.id, data: { plan: sub.planSlug, previous: user.planSlug, endsAt: endsAt.toISOString() } });
    await notify(tx, { userId, type: 'plan.activated', title: `Servix ${PLAN_LABEL[sub.planSlug]} is active`, body: `Your plan is active until ${fmtDate(endsAt)}.`, link: '/dashboard/plan' });
    return true;
  });
}

/** Self-service downgrade to Free. Data is kept; only new items above the Free limits are blocked. */
export async function downgradeToFree(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { planSlug: true, planExpiresAt: true } });
    if (user.planSlug === 'free') return;
    await applyPlan(tx, userId, 'free', null);
    await audit(tx, { actorId: userId, action: 'plan.downgraded', entity: 'user', entityId: userId, data: { from: user.planSlug, expiresAt: user.planExpiresAt?.toISOString() ?? null } });
    await notify(tx, { userId, type: 'plan.downgraded', title: 'You are now on Servix Free', body: 'Everything you created is still here. Items above the Free limits stay visible; you can add more again whenever you upgrade.', link: '/dashboard/plan' });
  });
}

/** Administrator assigns a plan directly (enterprise deals, goodwill, support). */
export async function grantPlan(adminId: string, userId: string, planSlug: PlanSlug, expiresAt: Date | null, note?: string): Promise<void> {
  if (!PLAN_SLUGS.includes(planSlug)) throw new ApiError(422, 'VALIDATION_ERROR', 'Unknown plan.');
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { planSlug: true } });
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found.');
    await applyPlan(tx, userId, planSlug, planSlug === 'free' ? null : expiresAt);
    await audit(tx, { actorId: adminId, action: 'plan.granted', entity: 'user', entityId: userId, data: { plan: planSlug, previous: user.planSlug, expiresAt: expiresAt?.toISOString() ?? null, note: note ?? null } });
    await notify(tx, { userId, type: 'plan.activated', title: `Servix ${PLAN_LABEL[planSlug]} is active`, body: expiresAt && planSlug !== 'free' ? `Your plan is active until ${fmtDate(expiresAt)}.` : 'Your plan has been updated by Servix.', link: '/dashboard/plan' });
  });
}
