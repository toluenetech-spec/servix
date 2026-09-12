import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { parseQuery, serviceQuerySchema } from '../lib/query.js';
import {
  serializeReview,
  serializeServiceDetail,
  serializeServiceSummary,
} from '../lib/serialize.js';

function buildWhere(q: ReturnType<typeof serviceQuerySchema.parse>): Prisma.ServiceWhereInput {
  const where: Prisma.ServiceWhereInput = { status: 'active' };
  if (q.q) {
    where.OR = [
      { title: { contains: q.q, mode: 'insensitive' } },
      { shortDescription: { contains: q.q, mode: 'insensitive' } },
      { description: { contains: q.q, mode: 'insensitive' } },
      { category: { name: { contains: q.q, mode: 'insensitive' } } },
    ];
  }
  if (q.category) where.category = { slug: q.category };
  if (q.minPrice != null || q.maxPrice != null) {
    where.price = {};
    if (q.minPrice != null) where.price.gte = q.minPrice;
    if (q.maxPrice != null) where.price.lte = q.maxPrice;
  }
  if (q.minRating != null) where.ratingAvg = { gte: q.minRating };
  if (q.location) where.locationLabel = { contains: q.location, mode: 'insensitive' };
  if (q.availability) where.availability = q.availability;
  return where;
}

function buildOrderBy(sort: string): Prisma.ServiceOrderByWithRelationInput[] {
  switch (sort) {
    case 'price-asc':
      return [{ price: 'asc' }, { id: 'asc' }];
    case 'price-desc':
      return [{ price: 'desc' }, { id: 'asc' }];
    case 'rating':
      return [{ ratingAvg: 'desc' }, { reviewCount: 'desc' }, { id: 'asc' }];
    case 'reviews':
      return [{ reviewCount: 'desc' }, { id: 'asc' }];
    default:
      return [{ ratingAvg: 'desc' }, { reviewCount: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }];
  }
}

export async function serviceRoutes(app: FastifyInstance) {
  app.get(
    '/services',
    { schema: { tags: ['catalogue'], summary: 'Search and list services' } },
    async (req) => {
      const q = parseQuery(serviceQuerySchema, req.query);
      const where = buildWhere(q);
      const [total, rows] = await prisma.$transaction([
        prisma.service.count({ where }),
        prisma.service.findMany({
          where,
          orderBy: buildOrderBy(q.sort),
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { media: true, category: true, professional: true },
        }),
      ]);
      return { items: rows.map(serializeServiceSummary), total, page: q.page, pageSize: q.pageSize };
    },
  );

  app.get(
    '/services/:slug',
    { schema: { tags: ['catalogue'], summary: 'Get a service by slug' } },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const service = await prisma.service.findFirst({
        where: { slug, status: 'active' },
        include: { media: true, faqs: true, category: true, professional: true },
      });
      if (!service) throw notFound('SERVICE_NOT_FOUND', 'Service not found');
      return serializeServiceDetail(service);
    },
  );

  app.get(
    '/services/:slug/reviews',
    { schema: { tags: ['catalogue'], summary: 'List published reviews for a service' } },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const service = await prisma.service.findUnique({ where: { slug } });
      if (!service) throw notFound('SERVICE_NOT_FOUND', 'Service not found');
      const rows = await prisma.review.findMany({
        where: { serviceId: service.id, isPublished: true },
        orderBy: { reviewedAt: 'desc' },
        include: { service: true, professional: true },
      });
      return rows.map(serializeReview);
    },
  );
}
