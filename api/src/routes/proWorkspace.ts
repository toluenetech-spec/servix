/**
 * Professional workspace extensions: plan (Servix Pro), analytics, weekly
 * availability, days off and received reviews. Every figure is computed from
 * the professional's own bookings, ledger entries and reviews — nothing is
 * estimated or invented. Access is re-checked server-side on each request.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireProfessional } from '../lib/authGuard.js';
import { ApiError } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { audit } from '../lib/audit.js';
import { planSummary, startPlanCheckout, verifySubscription } from '../lib/plans.js';

const guard = { preHandler: requireProfessional };
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function proWorkspaceRoutes(app: FastifyInstance) {
  /* ---------------- plan ---------------- */
  app.get('/pro/plan', { ...guard, schema: { tags: ['professional'], summary: 'Current plan, limits, usage and catalogue', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return planSummary(req.professionalProfileId!);
  });
  app.post('/pro/plan/checkout', { ...guard, config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags: ['professional'], summary: 'Start a plan upgrade checkout', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { plan } = parseBody(z.object({ plan: z.string().min(1).max(40) }).strict(), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
    if (!user.emailVerifiedAt) throw new ApiError(403, 'EMAIL_UNVERIFIED', 'Verify your email before upgrading.');
    const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
    return startPlanCheckout(req.professionalProfileId!, user.id, user.email, plan, appBase);
  });
  app.post('/pro/plan/verify', { ...guard, config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['professional'], summary: 'Verify a plan payment after returning from checkout', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { reference } = parseBody(z.object({ reference: z.string().min(1).max(120) }).strict(), req.body);
    const owned = await prisma.planSubscription.findFirst({ where: { reference, professionalId: req.professionalProfileId! } });
    if (!owned) throw new ApiError(404, 'NOT_FOUND', 'Unknown plan reference.');
    const status = await verifySubscription(reference);
    return { status, plan: await planSummary(req.professionalProfileId!) };
  });

  /* ---------------- analytics ---------------- */
  app.get('/pro/analytics', { ...guard, schema: { tags: ['professional'], summary: 'Own performance metrics from real records', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const proId = req.professionalProfileId!;
    const { days } = parseBody(z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }), req.query);
    const since = new Date(Date.now() - days * 86_400_000); since.setUTCHours(0, 0, 0, 0);
    const [bookings, credits, reviews, profile, services, events] = await Promise.all([
      prisma.booking.findMany({ where: { professionalId: proId, createdAt: { gte: since } }, select: { id: true, status: true, createdAt: true, amountKobo: true, platformFeeKobo: true, serviceId: true, serviceTitle: true, customerId: true } }),
      prisma.ledgerEntry.findMany({ where: { account: 'professional_payable', subjectId: proId, direction: 'credit', createdAt: { gte: since } }, select: { amountKobo: true, createdAt: true } }),
      prisma.review.findMany({ where: { professionalId: proId, isPublished: true }, select: { rating: true, reviewedAt: true } }),
      prisma.professionalProfile.findUniqueOrThrow({ where: { id: proId }, select: { ratingAvg: true, reviewCount: true, completedProjects: true } }),
      prisma.service.findMany({ where: { professionalId: proId, status: { not: 'archived' } }, select: { id: true, title: true, status: true, ratingAvg: true, reviewCount: true } }),
      prisma.bookingEvent.findMany({ where: { booking: { professionalId: proId }, event: { in: ['payment_captured', 'accepted', 'declined'] }, createdAt: { gte: since } }, select: { bookingId: true, event: true, createdAt: true } }),
    ]);
    const series: Record<string, { bookings: number; earnings: number }> = {};
    for (let i = days - 1; i >= 0; i--) series[dayKey(new Date(Date.now() - i * 86_400_000))] = { bookings: 0, earnings: 0 };
    for (const b of bookings) { const k = dayKey(b.createdAt); if (series[k]) series[k].bookings += 1; }
    for (const c of credits) { const k = dayKey(c.createdAt); if (series[k]) series[k].earnings += Number(c.amountKobo) / 100; }
    // Response time: payment_captured → first accept/decline on the same booking.
    const captured = new Map<string, Date>(); const responses: number[] = [];
    for (const e of events) if (e.event === 'payment_captured') captured.set(e.bookingId, e.createdAt);
    for (const e of events) { const start = captured.get(e.bookingId); if (e.event !== 'payment_captured' && start && e.createdAt >= start) { responses.push((e.createdAt.getTime() - start.getTime()) / 3_600_000); captured.delete(e.bookingId); } }
    const responded = responses.length; const requested = events.filter(e => e.event === 'payment_captured').length;
    const byService = new Map<string, { title: string; bookings: number; revenue: number }>();
    for (const b of bookings) { const cur = byService.get(b.serviceId) ?? { title: b.serviceTitle, bookings: 0, revenue: 0 }; cur.bookings += 1; if (['completed'].includes(b.status)) cur.revenue += Number(b.amountKobo - b.platformFeeKobo) / 100; byService.set(b.serviceId, cur); }
    const statusCounts: Record<string, number> = {}; for (const b of bookings) statusCounts[b.status] = (statusCounts[b.status] ?? 0) + 1;
    const ratingBreakdown = [5, 4, 3, 2, 1].map(stars => ({ stars, count: reviews.filter(r => r.rating === stars).length }));
    return {
      days, since: since.toISOString(),
      totals: {
        bookings: bookings.length, completed: statusCounts.completed ?? 0, cancelled: (statusCounts.cancelled ?? 0) + (statusCounts.declined ?? 0),
        earnings: credits.reduce((sum, c) => sum + Number(c.amountKobo) / 100, 0), uniqueClients: new Set(bookings.map(b => b.customerId)).size,
        ratingAvg: Number(profile.ratingAvg), reviewCount: profile.reviewCount, completedProjects: profile.completedProjects,
        responseRate: requested ? Math.round((responded / requested) * 100) : null,
        medianResponseHours: responded ? Number(responses.sort((a, b) => a - b)[Math.floor(responded / 2)]!.toFixed(1)) : null,
        activeServices: services.filter(s => s.status === 'active').length, totalServices: services.length,
      },
      series: Object.entries(series).map(([date, v]) => ({ date, ...v })), statusCounts, ratingBreakdown,
      services: [...byService.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.bookings - a.bookings).slice(0, 8),
    };
  });

  /* ---------------- availability ---------------- */
  const ruleSchema = z.object({ weekday: z.number().int().min(0).max(6), startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(1).max(24) }).refine(r => r.endHour > r.startHour, 'End must be after start.');
  app.get('/pro/availability', { ...guard, schema: { tags: ['professional'], summary: 'Weekly rules and days off', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); const proId = req.professionalProfileId!;
    const [rules, exceptions] = await Promise.all([
      prisma.availabilityRule.findMany({ where: { professionalId: proId }, orderBy: { weekday: 'asc' } }),
      prisma.availabilityException.findMany({ where: { professionalId: proId, date: { gte: new Date(new Date().toDateString()) } }, orderBy: { date: 'asc' }, take: 100 }),
    ]);
    return { usingDefaults: rules.length === 0, rules: rules.map(r => ({ weekday: r.weekday, startHour: r.startHour, endHour: r.endHour })), exceptions: exceptions.map(e => ({ id: e.id, date: dayKey(e.date), reason: e.reason })) };
  });
  app.put('/pro/availability', { ...guard, config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['professional'], summary: 'Replace weekly availability rules', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); const proId = req.professionalProfileId!;
    const { rules } = parseBody(z.object({ rules: z.array(ruleSchema).max(7) }).strict(), req.body);
    if (new Set(rules.map(r => r.weekday)).size !== rules.length) throw new ApiError(422, 'VALIDATION_ERROR', 'One rule per weekday.');
    await prisma.$transaction(async tx => {
      await tx.availabilityRule.deleteMany({ where: { professionalId: proId } });
      if (rules.length) await tx.availabilityRule.createMany({ data: rules.map(r => ({ professionalId: proId, ...r })) });
      await audit(tx, { actorId: req.auth!.sub, action: 'availability.update', entity: 'professional_profile', entityId: proId, data: { rules } });
    });
    return { ok: true, usingDefaults: rules.length === 0 };
  });
  app.post('/pro/availability/exceptions', { ...guard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['professional'], summary: 'Add a day off', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); const proId = req.professionalProfileId!;
    const { date, reason } = parseBody(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().max(120).optional() }).strict(), req.body);
    const day = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime()) || day < new Date(new Date().toDateString())) throw new ApiError(422, 'VALIDATION_ERROR', 'Choose today or a future date.');
    const row = await prisma.availabilityException.upsert({ where: { professionalId_date: { professionalId: proId, date: day } }, create: { professionalId: proId, date: day, reason: reason || null }, update: { reason: reason || null } });
    return { id: row.id, date, reason: row.reason };
  });
  app.delete('/pro/availability/exceptions/:id', { ...guard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['professional'], summary: 'Remove a day off', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id } = req.params as { id: string };
    const result = await prisma.availabilityException.deleteMany({ where: { id, professionalId: req.professionalProfileId! } });
    return { removed: result.count };
  });

  /* ---------------- reviews received ---------------- */
  app.get('/pro/reviews', { ...guard, schema: { tags: ['professional'], summary: 'Reviews received, newest first', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); const proId = req.professionalProfileId!;
    const rows = await prisma.review.findMany({ where: { professionalId: proId }, orderBy: { reviewedAt: 'desc' }, take: 100, include: { service: { select: { slug: true, title: true } }, booking: { select: { id: true, reference: true } } } });
    return rows.map(r => ({ id: r.id, author: r.author, rating: r.rating, text: r.text, reviewedAt: r.reviewedAt, isPublished: r.isPublished, service: r.service, booking: r.booking }));
  });
}
