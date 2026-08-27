import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { parseQuery, professionalQuerySchema } from '../lib/query.js';
import {
  serializeProfessionalDetail,
  serializeProfessionalSummary,
  serializeReview,
  serializeServiceSummary,
} from '../lib/serialize.js';

function buildWhere(
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

function buildOrderBy(sort: string): Prisma.ProfessionalProfileOrderByWithRelationInput[] {
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
          portfolio: true,
          services: { where: { status: 'active' } },
        },
      });
      if (!pro) throw notFound('PROFESSIONAL_NOT_FOUND', 'Professional not found');
      return serializeProfessionalDetail(pro);
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
