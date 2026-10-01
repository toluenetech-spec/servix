/**
 * Professional plans ("Servix Pro").
 *  - Plan catalogue lives in the `plans` table (seeded; editable by operators).
 *  - A profile's plan is `plan_slug` + `plan_expires_at`; an expired paid plan
 *    behaves exactly like `free` (no silent grace period).
 *  - Upgrades are paid through the SAME payment provider abstraction as
 *    bookings: a `plan_subscriptions` row is created `initiated`, the provider
 *    checkout is opened, and activation happens only after verification
 *    (return URL or signed webhook), as a compare-and-swap.
 *  - Limits enforced today: number of service listings. Features that are
 *    not enforced in code are not promised to the user.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { ApiError } from './errors.js';
import { getPaymentProvider } from './payments.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';

export const PLAN_LIMITS: Record<string, { listings: number | null; analytics: boolean; label: string }> = {
  free: { listings: 2, analytics: false, label: 'Free' },
  professional: { listings: 10, analytics: true, label: 'Servix Pro' },
  business: { listings: null, analytics: true, label: 'Business' },
};
const PLAN_DAYS = 30;

export function effectivePlan(profile: { planSlug: string; planExpiresAt: Date | null }, now = new Date()): string {
  if (profile.planSlug === 'free') return 'free';
  if (profile.planExpiresAt && profile.planExpiresAt <= now) return 'free';
  return PLAN_LIMITS[profile.planSlug] ? profile.planSlug : 'free';
}

export async function planSummary(professionalId: string) {
  const profile = await prisma.professionalProfile.findUniqueOrThrow({ where: { id: professionalId }, select: { planSlug: true, planExpiresAt: true } });
  const current = effectivePlan(profile);
  const [listings, plans, subscriptions] = await Promise.all([
    prisma.service.count({ where: { professionalId, status: { not: 'archived' } } }),
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { position: 'asc' } }),
    prisma.planSubscription.findMany({ where: { professionalId }, orderBy: { createdAt: 'desc' }, take: 12 }),
  ]);
  return {
    current, label: PLAN_LIMITS[current]!.label,
    expiresAt: current === 'free' ? null : profile.planExpiresAt?.toISOString() ?? null,
    expired: profile.planSlug !== 'free' && current === 'free',
    limits: PLAN_LIMITS[current], usage: { listings },
    plans: plans.map(p => ({ slug: p.slug, name: p.name, tagline: p.tagline, price: Number(p.price), currency: p.currency, period: p.period, features: p.features, highlighted: p.highlighted, limits: PLAN_LIMITS[p.slug] ?? null, purchasable: Number(p.price) > 0 && p.slug !== 'business' })),
    subscriptions: subscriptions.map(s => ({ id: s.id, plan: s.planSlug, status: s.status, reference: s.reference, amount: Number(s.amountKobo / 100n), currency: s.currency, startsAt: s.startsAt?.toISOString() ?? null, endsAt: s.endsAt?.toISOString() ?? null, createdAt: s.createdAt.toISOString() })),
  };
}

/** Listing cap for the effective plan; throws 403 PLAN_LIMIT when reached. */
export async function assertListingAllowed(professionalId: string): Promise<void> {
  const profile = await prisma.professionalProfile.findUniqueOrThrow({ where: { id: professionalId }, select: { planSlug: true, planExpiresAt: true } });
  const plan = effectivePlan(profile);
  const limit = PLAN_LIMITS[plan]!.listings;
  if (limit === null) return;
  const count = await prisma.service.count({ where: { professionalId, status: { not: 'archived' } } });
  if (count >= limit) {
    throw new ApiError(403, 'PLAN_LIMIT', `Your ${PLAN_LIMITS[plan]!.label} plan allows ${limit} service listing${limit === 1 ? '' : 's'}. Upgrade to add more.`);
  }
}

export async function startPlanCheckout(professionalId: string, userId: string, email: string, planSlug: string, appBase: string) {
  const plan = await prisma.plan.findFirst({ where: { slug: planSlug, isActive: true } });
  if (!plan || Number(plan.price) <= 0 || plan.slug === 'business') throw new ApiError(422, 'VALIDATION_ERROR', 'That plan cannot be purchased online.');
  const open = await prisma.planSubscription.findFirst({ where: { professionalId, status: 'initiated', createdAt: { gte: new Date(Date.now() - 30 * 60_000) } }, orderBy: { createdAt: 'desc' } });
  const provider = getPaymentProvider();
  const amountKobo = BigInt(plan.price) * 100n;
  const callbackUrl = `${appBase}/dashboard/plan`;
  if (open && open.planSlug === plan.slug) {
    const init = await provider.initialize({ reference: open.reference, amountKobo: open.amountKobo, email, callbackUrl: `${callbackUrl}?reference=${encodeURIComponent(open.reference)}` });
    return { authorizationUrl: init.authorizationUrl, reference: open.reference };
  }
  const reference = `sub-${randomUUID()}`;
  await prisma.planSubscription.create({ data: { professionalId, planSlug: plan.slug, reference, amountKobo, currency: plan.currency, provider: provider.name } });
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

export async function activateSubscription(reference: string): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const now = new Date();
    const sub = await tx.planSubscription.findUniqueOrThrow({ where: { reference } });
    const cas = await tx.planSubscription.updateMany({ where: { id: sub.id, status: 'initiated' }, data: { status: 'active', verifiedAt: now, startsAt: now } });
    if (cas.count === 0) return false;
    const profile = await tx.professionalProfile.findUniqueOrThrow({ where: { id: sub.professionalId }, select: { userId: true, planSlug: true, planExpiresAt: true } });
    const base = profile.planSlug === sub.planSlug && profile.planExpiresAt && profile.planExpiresAt > now ? profile.planExpiresAt : now;
    const endsAt = new Date(base.getTime() + PLAN_DAYS * 86_400_000);
    await tx.planSubscription.update({ where: { id: sub.id }, data: { endsAt } });
    await tx.professionalProfile.update({ where: { id: sub.professionalId }, data: { planSlug: sub.planSlug, planExpiresAt: endsAt } });
    await audit(tx, { actorId: profile.userId, action: 'plan.activated', entity: 'plan_subscription', entityId: sub.id, data: { plan: sub.planSlug, endsAt: endsAt.toISOString() } });
    if (profile.userId) {
      await notify(tx, { userId: profile.userId, type: 'plan.activated', title: `${PLAN_LIMITS[sub.planSlug]?.label ?? sub.planSlug} is active`, body: `Your plan is active until ${endsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`, link: '/dashboard/plan' });
    }
    return true;
  });
}
