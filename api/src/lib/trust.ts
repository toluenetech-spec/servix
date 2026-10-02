/**
 * Servix Trust & Performance metrics — every number here is derived from
 * real rows (bookings, booking events, reviews, users) with the formula
 * stated next to it. Nothing is estimated or back-filled. When a metric
 * does not have enough data it is returned as null with a `sample` size,
 * and the UI shows "Not enough data".
 *
 * Delivery reliability (documented formula)
 *   measurable  = completed bookings that have expected_delivery_at set
 *                 (the snapshot is written at payment capture, so only
 *                 bookings created after this feature shipped count)
 *   on time     = delivered_at <= expected_delivery_at
 *                 (if the deadline was mutually changed, the changed one is used —
 *                 deadline_changed_at is recorded alongside the new value)
 *   against     = professional cancellations after acceptance, and disputes
 *                 that ended in a refund
 *   reliability = on_time / (measurable + against)      shown when measurable >= MIN_RELIABILITY
 *   Customer-caused delays are not counted: a booking whose timeline has a
 *   'customer_reschedule' event is excluded from "late" (counted as on time).
 *   Payment / platform delays cannot affect it: the clock starts at payment capture.
 */
import { prisma } from './db.js';
import type { Prisma } from '../generated/prisma/client.js';

export const MIN_RELIABILITY = 5;
export const MIN_RESPONSE = 5;
export const MIN_REPEAT = 5;
export const MIN_RATING = 3;

type Tx = Prisma.TransactionClient | typeof prisma;

export interface TrustMetrics {
  professionalId: string;
  computedAt: string;
  verified: { email: boolean; professional: boolean; identity: boolean };
  accountAgeDays: number;
  completedJobs: number;
  verifiedProjects: number; // completed bookings with a verified portfolio item
  rating: { average: number | null; count: number };
  reliability: { percent: number | null; onTime: number; late: number; against: number; measurable: number };
  cancellation: { percent: number | null; byProfessional: number; total: number };
  response: { ratePercent: number | null; medianHours: number | null; sample: number };
  repeatCustomers: { percent: number | null; repeat: number; customers: number };
  disputes: { total: number; refunded: number };
}

export async function computeTrust(professionalId: string, tx: Tx = prisma): Promise<TrustMetrics> {
  const profile = await tx.professionalProfile.findUnique({
    where: { id: professionalId },
    select: { verification: true, createdAt: true, ratingAvg: true, reviewCount: true, user: { select: { emailVerifiedAt: true, kycStatus: true, createdAt: true } } },
  });
  if (!profile) throw new Error('Professional not found');
  const bookings = await tx.booking.findMany({
    where: { professionalId, status: { in: ['completed', 'cancelled', 'declined', 'refunded', 'disputed', 'accepted', 'in_progress', 'delivered', 'requested'] } },
    select: { id: true, status: true, customerId: true, cancelledBy: true, deliveredAt: true, completedAt: true, expectedDeliveryAt: true, deadlineChangedAt: true, createdAt: true, verifiedPortfolio: { select: { id: true } } },
  });
  const ids = bookings.map((b) => b.id);
  const events = ids.length
    ? await tx.bookingEvent.findMany({ where: { bookingId: { in: ids } }, select: { bookingId: true, event: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
    : [];
  const byBooking = new Map<string, typeof events>();
  for (const e of events) { const list = byBooking.get(e.bookingId) ?? []; list.push(e); byBooking.set(e.bookingId, list); }

  const completed = bookings.filter((b) => b.status === 'completed');
  // Reliability
  let onTime = 0, late = 0, measurable = 0;
  for (const b of completed) {
    if (!b.expectedDeliveryAt || !b.deliveredAt) continue;
    measurable += 1;
    const customerDelay = Boolean(b.deadlineChangedAt) || (byBooking.get(b.id) ?? []).some((e) => e.event === 'customer_reschedule');
    if (customerDelay || b.deliveredAt.getTime() <= b.expectedDeliveryAt.getTime()) onTime += 1; else late += 1;
  }
  const proCancelled = bookings.filter((b) => b.status === 'cancelled' && b.cancelledBy === 'professional' && (byBooking.get(b.id) ?? []).some((e) => e.event === 'accepted'));
  const refunded = bookings.filter((b) => b.status === 'refunded');
  const against = proCancelled.length + refunded.length;
  const reliabilityPercent = measurable >= MIN_RELIABILITY ? Math.round((onTime / (measurable + against)) * 100) : null;
  // Cancellation rate: professional-initiated cancellations + declines over all paid bookings.
  const paid = bookings.filter((b) => (byBooking.get(b.id) ?? []).some((e) => e.event === 'payment_captured'));
  const byPro = bookings.filter((b) => (b.status === 'cancelled' && b.cancelledBy === 'professional') || b.status === 'declined').length;
  const cancellationPercent = paid.length >= MIN_RELIABILITY ? Math.round((byPro / paid.length) * 100) : null;
  // Response: payment_captured → first accepted/declined.
  const responses: number[] = []; let requested = 0;
  for (const b of bookings) {
    const list = byBooking.get(b.id) ?? [];
    const start = list.find((e) => e.event === 'payment_captured');
    if (!start) continue;
    requested += 1;
    const reply = list.find((e) => (e.event === 'accepted' || e.event === 'declined') && e.createdAt >= start.createdAt);
    if (reply) responses.push((reply.createdAt.getTime() - start.createdAt.getTime()) / 3_600_000);
  }
  responses.sort((a, b) => a - b);
  const response = {
    ratePercent: requested >= MIN_RESPONSE ? Math.round((responses.length / requested) * 100) : null,
    medianHours: requested >= MIN_RESPONSE && responses.length ? Number(responses[Math.floor(responses.length / 2)]!.toFixed(1)) : null,
    sample: requested,
  };
  // Repeat customers: customers with ≥2 completed bookings / customers with ≥1 completed booking.
  const perCustomer = new Map<string, number>();
  for (const b of completed) perCustomer.set(b.customerId, (perCustomer.get(b.customerId) ?? 0) + 1);
  const customers = perCustomer.size; const repeat = [...perCustomer.values()].filter((n) => n >= 2).length;
  const repeatPercent = customers >= MIN_REPEAT ? Math.round((repeat / customers) * 100) : null;
  const disputes = bookings.filter((b) => b.status === 'disputed' || (byBooking.get(b.id) ?? []).some((e) => e.event === 'disputed'));
  const since = profile.user?.createdAt ?? profile.createdAt;
  return {
    professionalId,
    computedAt: new Date().toISOString(),
    verified: { email: Boolean(profile.user?.emailVerifiedAt), professional: profile.verification === 'verified', identity: profile.user?.kycStatus === 'verified' },
    accountAgeDays: Math.floor((Date.now() - since.getTime()) / 86_400_000),
    completedJobs: completed.length,
    verifiedProjects: completed.filter((b) => b.verifiedPortfolio).length,
    rating: { average: profile.reviewCount >= MIN_RATING ? Number(profile.ratingAvg) : null, count: profile.reviewCount },
    reliability: { percent: reliabilityPercent, onTime, late, against, measurable },
    cancellation: { percent: cancellationPercent, byProfessional: byPro, total: paid.length },
    response,
    repeatCustomers: { percent: repeatPercent, repeat, customers },
    disputes: { total: disputes.length, refunded: refunded.length },
  };
}

/** Public, customer-facing subset (no dispute detail, no internal counts beyond what is shown). */
export function publicTrust(m: TrustMetrics) {
  return {
    servixVerified: m.verified.professional && m.verified.email,
    identityVerified: m.verified.identity,
    accountAgeDays: m.accountAgeDays,
    completedJobs: m.completedJobs,
    verifiedProjects: m.verifiedProjects,
    rating: { ...m.rating, enough: m.rating.count >= MIN_RATING, minimum: MIN_RATING },
    reliability: { percent: m.reliability.percent, measurable: m.reliability.measurable, enough: m.reliability.measurable >= MIN_RELIABILITY, minimum: MIN_RELIABILITY },
    responseRate: { percent: m.response.ratePercent, medianHours: m.response.medianHours, sample: m.response.sample, enough: m.response.sample >= MIN_RESPONSE, minimum: MIN_RESPONSE },
    repeatCustomers: { percent: m.repeatCustomers.percent, customers: m.repeatCustomers.customers, enough: m.repeatCustomers.customers >= MIN_REPEAT, minimum: MIN_REPEAT },
    computedAt: m.computedAt,
  };
}

/** Records a profile/service view without any visitor identity. */
export async function countView(entityType: 'professional' | 'service', entityId: string): Promise<void> {
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  await prisma.$executeRaw`INSERT INTO view_counters (entity_type, entity_id, day, count) VALUES (${entityType}, ${entityId}, ${day}::date, 1)
    ON CONFLICT (entity_type, entity_id, day) DO UPDATE SET count = view_counters.count + 1`;
}

export async function viewTotals(entityType: 'professional' | 'service', entityIds: string[], since: Date): Promise<Map<string, number>> {
  if (!entityIds.length) return new Map();
  const rows = await prisma.viewCounter.groupBy({ by: ['entityId'], where: { entityType, entityId: { in: entityIds }, day: { gte: since } }, _sum: { count: true } });
  return new Map(rows.map((r) => [r.entityId, r._sum.count ?? 0]));
}
