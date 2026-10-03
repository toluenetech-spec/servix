import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/db.js';
import { featureEnabled } from '../lib/features.js';
import { profileTrustSummary, verifiedPortfolioFields } from './marketplace.js';
import { filterByAvailability } from '../lib/bookingService.js';
import { notFound } from '../lib/errors.js';
import { parseQuery, professionalQuerySchema } from '../lib/query.js';
import {
  serializeProfessionalDetail,
  serializeProfessionalSummary,
  serializeReview,
  serializeServiceSummary,
} from '../lib/serialize.js';

export function buildWhere(
  q: ReturnType<typeof professionalQuerySchema.parse>,
): Prisma.ProfessionalProfileWhereInput {
  const where: Prisma.ProfessionalProfileWhereInput = {};
  if (q.q) {
    where.OR = [
      { name: { contains: q.q, mode: 'insensitive' } },
      { title: { contains: q.q, mode: 'insensitive' } },
      { skills: { some: { skill: { contains: q.q, mode: 'insensitive' } } } },
    ];
  }
  if (q.category) where.category = { slug: q.category };
  if (q.location) where.locationCity = { contains: q.location, mode: 'insensitive' };
  if (q.minRating != null) where.ratingAvg = { gte: q.minRating };
  if (q.maxPrice != null) where.startingPrice = { lte: q.maxPrice };
  if (q.availability) where.availability = q.availability;
  return where;
}

export function buildOrderBy(sort: string): Prisma.ProfessionalProfileOrderByWithRelationInput[] {
  switch (sort) {
    case 'rating':
      return [{ ratingAvg: 'desc' }, { reviewCount: 'desc' }, { id: 'asc' }];
    case 'reviews':
      return [{ reviewCount: 'desc' }, { id: 'asc' }];
    case 'price-asc':
      return [{ startingPrice: 'asc' }, { id: 'asc' }];
    case 'price-desc':
      return [{ startingPrice: 'desc' }, { id: 'asc' }];
    default:
      return [{ verification: 'desc' }, { ratingAvg: 'desc' }, { reviewCount: 'desc' }, { id: 'asc' }];
  }
}

export async function professionalRoutes(app: FastifyInstance) {
  app.get(
    '/professionals',
    { schema: { tags: ['catalogue'], summary: 'Search and list professionals' } },
    async (req) => {
      const q = parseQuery(professionalQuerySchema, req.query);
      const where = buildWhere(q);
      if (q.available) {
        // Availability is computed from real rules/exceptions/bookings, so the
        // narrowing happens after the database filter (bounded candidate set).
        const candidates = await prisma.professionalProfile.findMany({ where, orderBy: buildOrderBy(q.sort), take: 120, include: { category: true } });
        const keep = await filterByAvailability(candidates.map((c) => c.id), q.available);
        const matched = candidates.filter((c) => keep.has(c.id));
        const pageRows = matched.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
        return { items: pageRows.map((p) => ({ ...serializeProfessionalSummary(p), availableNow: true })), total: matched.length, page: q.page, pageSize: q.pageSize };
      }
      const [total, rows] = await prisma.$transaction([
        prisma.professionalProfile.count({ where }),
        prisma.professionalProfile.findMany({
          where,
          orderBy: buildOrderBy(q.sort),
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { category: true },
        }),
      ]);
      return {
        items: rows.map(serializeProfessionalSummary),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );

  app.get(
    '/professionals/:slug',
    { schema: { tags: ['catalogue'], summary: 'Get a professional profile by slug' } },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const pro = await prisma.professionalProfile.findUnique({
        where: { slug },
        include: {
          category: true,
          skills: true,
          portfolio: { include: { booking: { select: { completedAt: true, createdAt: true, review: { select: { rating: true } } } } } },
          services: { where: { status: 'active' } },
        },
      });
      if (!pro) throw notFound('PROFESSIONAL_NOT_FOUND', 'Professional not found');
      const detail = serializeProfessionalDetail(pro);
      const verifiedById = new Map(pro.portfolio.map((i) => [i.id, verifiedPortfolioFields(i)]));
      return {
        ...detail,
        portfolio: detail.portfolio.map((item) => ({ ...item, ...verifiedById.get(item.id) })),
        verifiedProjects: pro.portfolio.filter((i) => i.verifiedAt).length,
        trust: featureEnabled('trust') ? await profileTrustSummary(pro.id) : null,
      };
    },
  );

  app.get(
    '/professionals/:slug/reviews',
    { schema: { tags: ['catalogue'], summary: 'List published reviews for a professional' } },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const pro = await prisma.professionalProfile.findUnique({ where: { slug } });
      if (!pro) throw notFound('PROFESSIONAL_NOT_FOUND', 'Professional not found');
      const rows = await prisma.review.findMany({
        where: { professionalId: pro.id, isPublished: true },
        orderBy: { reviewedAt: 'desc' },
        include: { service: true, professional: true },
      });
      return rows.map(serializeReview);
    },
  );

  app.get(
    '/professionals/:slug/services',
    { schema: { tags: ['catalogue'], summary: 'List active services by a professional' } },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const pro = await prisma.professionalProfile.findUnique({ where: { slug } });
      if (!pro) throw notFound('PROFESSIONAL_NOT_FOUND', 'Professional not found');
      const rows = await prisma.service.findMany({
        where: { professionalId: pro.id, status: 'active' },
        include: { media: true, category: true, professional: true },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(serializeServiceSummary);
    },
  );
}
