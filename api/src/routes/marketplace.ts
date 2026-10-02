/**
 * Next-gen marketplace: feature flags, Trust & Performance, achievements,
 * comparison, availability discovery, verified Servix portfolio, view counters.
 *
 * Everything shown to customers is computed from real rows by lib/trust.ts and
 * lib/achievements.ts. Compare/trust/achievements are behind feature flags.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAdmin, requireAuth, requireProfessional } from '../lib/authGuard.js';
import { ApiError, notFound } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { featureSnapshot, requireFeature } from '../lib/features.js';
import { computeTrust, publicTrust, countView, MIN_RELIABILITY } from '../lib/trust.js';
import { achievementCatalog, evaluateAchievements, listAchievements } from '../lib/achievements.js';
import { availabilitySummary } from '../lib/bookingService.js';
import { serializeProfessionalSummary, serializeServiceSummary, normalizeProfileDetails } from '../lib/serialize.js';
import { mediaUrl } from '../lib/storage.js';
import { audit } from '../lib/audit.js';

const MAX_COMPARE = 4;

export async function marketplaceRoutes(app: FastifyInstance) {
  app.get('/features', { schema: { tags: ['meta'], summary: 'Which optional Servix systems are enabled' } }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return featureSnapshot();
  });

  /* ---------------- trust & achievements (public, read-only) ---------------- */

  app.get<{ Params: { slug: string } }>('/professionals/:slug/trust', { preHandler: requireFeature('trust'), schema: { tags: ['catalogue'], summary: 'Trust & performance metrics computed from real bookings' } }, async (req) => {
    const pro = await prisma.professionalProfile.findUnique({ where: { slug: req.params.slug }, select: { id: true } });
    if (!pro) throw notFound('NOT_FOUND', 'Professional not found');
    const metrics = await computeTrust(pro.id);
    const achievements = await listAchievements(pro.id);
    return { ...publicTrust(metrics), achievements };
  });

  app.get('/achievements/catalog', { schema: { tags: ['catalogue'], summary: 'All achievements and how they are earned' } }, async () => ({ items: achievementCatalog() }));

  app.get<{ Params: { slug: string } }>('/professionals/:slug/achievements', { schema: { tags: ['catalogue'], summary: 'Achievements a professional has earned' } }, async (req) => {
    const pro = await prisma.professionalProfile.findUnique({ where: { slug: req.params.slug }, select: { id: true } });
    if (!pro) throw notFound('NOT_FOUND', 'Professional not found');
    return { items: await listAchievements(pro.id) };
  });

  app.get<{ Params: { slug: string } }>('/professionals/:slug/availability/summary', { schema: { tags: ['catalogue'], summary: 'Next real available slot (today / tomorrow / this week)' } }, async (req) => {
    const pro = await prisma.professionalProfile.findUnique({ where: { slug: req.params.slug }, select: { id: true } });
    if (!pro) throw notFound('NOT_FOUND', 'Professional not found');
    return availabilitySummary(pro.id);
  });

  /* ---------------- view counters (anonymous, rate limited) ---------------- */

  app.post('/views', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, schema: { tags: ['meta'], summary: 'Count a profile/service view (no visitor identity stored)' } }, async (req, reply) => {
    const body = parseBody(z.object({ type: z.enum(['professional', 'service']), slug: z.string().min(1).max(160) }), req.body);
    const row = body.type === 'professional'
      ? await prisma.professionalProfile.findUnique({ where: { slug: body.slug }, select: { id: true } })
      : await prisma.service.findUnique({ where: { slug: body.slug }, select: { id: true } });
    if (row) await countView(body.type, row.id);
    return reply.code(204).send();
  });

  /* ---------------- comparison ---------------- */

  app.get('/compare', { preHandler: requireFeature('compare'), schema: { tags: ['catalogue'], summary: 'Side-by-side comparison of up to 4 professionals or services' } }, async (req) => {
    const q = z.object({ professionals: z.string().optional(), services: z.string().optional() }).parse(req.query ?? {});
    const proSlugs = (q.professionals ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_COMPARE);
    const serviceSlugs = (q.services ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_COMPARE);
    if (!proSlugs.length && !serviceSlugs.length) throw new ApiError(422, 'VALIDATION_ERROR', 'Choose at least one professional or service to compare.');
    const services = serviceSlugs.length ? await prisma.service.findMany({ where: { slug: { in: serviceSlugs }, status: 'active' }, include: { media: true, category: true, professional: true } }) : [];
    const slugs = [...new Set([...proSlugs, ...services.map((s) => s.professional.slug)])];
    const pros = await prisma.professionalProfile.findMany({ where: { slug: { in: slugs } }, include: { category: true, skills: true, portfolio: { orderBy: { position: 'asc' }, take: 4 }, services: { where: { status: 'active' } } } });
    const columns = await Promise.all(pros.map(async (p) => {
      const [metrics, achievements, availability] = await Promise.all([computeTrust(p.id), listAchievements(p.id), availabilitySummary(p.id)]);
      const details = normalizeProfileDetails(p.details);
      return {
        ...serializeProfessionalSummary({ ...p, services: undefined }),
        identityVerified: metrics.verified.identity,
        trust: publicTrust(metrics),
        achievements,
        availabilityNext: availability,
        skills: p.skills.slice().sort((a, b) => a.position - b.position).map((s) => s.skill),
        languages: details.languages,
        services: p.services.map((s) => ({ id: s.slug, title: s.title, price: Number(s.price), priceUnit: s.priceUnit })),
        portfolio: p.portfolio.map((i) => ({ id: i.id, title: i.title, image: mediaUrl(i.mediaUrl), verified: Boolean(i.verifiedAt) })),
      };
    }));
    return {
      max: MAX_COMPARE,
      professionals: columns,
      services: services.map((s) => ({ ...serializeServiceSummary(s), professionalSlug: s.professional.slug, deliveryDays: s.deliveryDays, revisions: s.revisions, included: s.included })),
      notEnoughDataLabel: 'Not enough data',
      minimums: { reliability: MIN_RELIABILITY },
    };
  });

  /* ---------------- verified Servix portfolio ---------------- */

  app.post<{ Params: { bookingId: string } }>('/pro/portfolio/from-booking/:bookingId', { preHandler: requireProfessional, config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['professional'], summary: 'Add a completed Servix booking to the portfolio as a Verified Servix Project', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    const body = parseBody(z.object({ title: z.string().trim().min(3).max(120).optional(), description: z.string().trim().max(1000).optional(), mediaUrl: z.string().url().optional() }), req.body ?? {});
    const booking = await prisma.booking.findFirst({ where: { id: req.params.bookingId, professionalId: req.professionalProfileId!, status: 'completed' }, include: { service: { include: { category: true, media: { orderBy: { position: 'asc' }, take: 1 } } }, review: true, verifiedPortfolio: true } });
    if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Only your own completed bookings can become verified projects.');
    if (booking.verifiedPortfolio) throw new ApiError(409, 'ALREADY_VERIFIED', 'This booking is already in your portfolio.');
    const count = await prisma.portfolioItem.count({ where: { professionalId: req.professionalProfileId! } });
    const item = await prisma.portfolioItem.create({ data: {
      professionalId: req.professionalProfileId!,
      title: body.title ?? booking.serviceTitle,
      category: booking.service.category.name,
      description: body.description ?? null,
      mediaUrl: body.mediaUrl ?? booking.service.media[0]?.url ?? null,
      position: count,
      bookingId: booking.id,
      verifiedAt: new Date(),
    } });
    await audit(prisma, { actorId: req.auth!.sub, action: 'portfolio.verified_from_booking', entity: 'portfolio_item', entityId: item.id, data: { bookingId: booking.id }, ip: req.ip });
    return reply.code(201).send(serializeVerifiedItem(item, booking));
  });

  app.get('/pro/portfolio/verifiable', { preHandler: requireProfessional, schema: { tags: ['professional'], summary: 'Completed bookings not yet shown as verified projects', security: [{ bearerAuth: [] }] } }, async (req) => {
    const rows = await prisma.booking.findMany({ where: { professionalId: req.professionalProfileId!, status: 'completed', verifiedPortfolio: null }, orderBy: { completedAt: 'desc' }, take: 50, select: { id: true, serviceTitle: true, completedAt: true, service: { select: { category: { select: { name: true } } } } } });
    return { items: rows.map((b) => ({ bookingId: b.id, title: b.serviceTitle, category: b.service.category.name, completedAt: b.completedAt?.toISOString() ?? null })) };
  });

  /* ---------------- professional's own view + manual refresh ---------------- */

  app.get('/pro/trust', { preHandler: requireProfessional, schema: { tags: ['professional'], summary: 'Own trust metrics with calculation details', security: [{ bearerAuth: [] }] } }, async (req) => {
    const metrics = await computeTrust(req.professionalProfileId!);
    const { earned } = await evaluateAchievements(req.professionalProfileId!, metrics);
    return { metrics, achievements: await listAchievements(req.professionalProfileId!), newlyEarned: earned, catalog: achievementCatalog() };
  });

  /* ---------------- admin ---------------- */

  app.get<{ Params: { slug: string } }>('/admin/trust/:slug', { preHandler: requireAdmin, schema: { tags: ['admin'], summary: 'Trust metrics, badge history and calculation source for a professional', security: [{ bearerAuth: [] }] } }, async (req) => {
    const pro = await prisma.professionalProfile.findUnique({ where: { slug: req.params.slug }, select: { id: true, name: true, slug: true } });
    if (!pro) throw notFound('NOT_FOUND', 'Professional not found');
    const [metrics, history] = await Promise.all([computeTrust(pro.id), prisma.professionalAchievement.findMany({ where: { professionalId: pro.id }, orderBy: { earnedAt: 'desc' } })]);
    return { professional: pro, metrics, history: history.map((h) => ({ slug: h.slug, earnedAt: h.earnedAt.toISOString(), revokedAt: h.revokedAt?.toISOString() ?? null, evidence: h.evidence })), catalog: achievementCatalog(), source: 'bookings, booking_events, reviews, users (see api/docs/TRUST.md)' };
  });

  app.post<{ Params: { slug: string } }>('/admin/trust/:slug/recompute', { preHandler: requireAdmin, schema: { tags: ['admin'], summary: 'Re-evaluate achievements for a professional', security: [{ bearerAuth: [] }] } }, async (req) => {
    const pro = await prisma.professionalProfile.findUnique({ where: { slug: req.params.slug }, select: { id: true } });
    if (!pro) throw notFound('NOT_FOUND', 'Professional not found');
    const result = await evaluateAchievements(pro.id);
    await audit(prisma, { actorId: req.auth!.sub, action: 'achievements.recomputed', entity: 'professional_profile', entityId: pro.id, data: result, ip: req.ip });
    return result;
  });

  app.get('/admin/trust', { preHandler: requireAdmin, schema: { tags: ['admin'], summary: 'Professionals with achievement counts', security: [{ bearerAuth: [] }] } }, async (req) => {
    const q = z.object({ q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query ?? {});
    const where = q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { slug: { contains: q.q, mode: 'insensitive' as const } }] } : {};
    const [total, rows] = await Promise.all([
      prisma.professionalProfile.count({ where }),
      prisma.professionalProfile.findMany({ where, orderBy: { completedProjects: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { slug: true, name: true, title: true, verification: true, completedProjects: true, ratingAvg: true, reviewCount: true, achievements: { where: { revokedAt: null }, select: { slug: true } }, user: { select: { kycStatus: true } } } }),
    ]);
    return { items: rows.map((r) => ({ slug: r.slug, name: r.name, title: r.title, verification: r.verification, kycStatus: r.user?.kycStatus ?? null, completedProjects: r.completedProjects, rating: Number(r.ratingAvg), reviewCount: r.reviewCount, achievements: r.achievements.map((a) => a.slug) })), total, page: q.page, pageSize: q.pageSize };
  });
}

function serializeVerifiedItem(item: { id: string; title: string; category: string | null; description: string | null; mediaUrl: string | null; verifiedAt: Date | null }, booking: { completedAt: Date | null; createdAt: Date; review: { rating: number } | null }) {
  return { id: item.id, title: item.title, category: item.category ?? '', description: item.description ?? '', image: mediaUrl(item.mediaUrl), verified: true, verifiedAt: item.verifiedAt?.toISOString() ?? null, completedAt: booking.completedAt?.toISOString() ?? null, customerRating: booking.review?.rating ?? null };
}

/* Portfolio serializer addition used by serializeProfessionalDetail via the extra fields below. */
export const verifiedPortfolioFields = (i: { verifiedAt: Date | null; booking?: { completedAt: Date | null; createdAt: Date; service?: { deliveryDays: number | null } | null; review?: { rating: number } | null } | null }) => ({
  verified: Boolean(i.verifiedAt),
  completedAt: i.booking?.completedAt?.toISOString() ?? null,
  customerRating: i.booking?.review?.rating ?? null,
  deliveryDays: i.booking?.completedAt && i.booking?.createdAt ? Math.max(1, Math.round((i.booking.completedAt.getTime() - i.booking.createdAt.getTime()) / 86_400_000)) : null,
});

/** Trust facts included on the public profile payload when the flag is on. */
export async function profileTrustSummary(professionalId: string) {
  const metrics = await computeTrust(professionalId);
  return { ...publicTrust(metrics), achievements: await listAchievements(professionalId) };
}

export { requireAuth };
