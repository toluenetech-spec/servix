/**
 * SERVIX Phase C — authenticated professional management (/pro/*).
 * Every route requires a server-verified professional (requireProfessional
 * re-reads role + profile from the DB). Ownership is enforced by always
 * scoping queries to req.professionalProfileId.
 *
 * Phase E: uploads presign through the real storage provider (R2 when
 * configured) and are audit-tracked for orphan cleanup.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireProfessional } from '../lib/authGuard.js';
import { ApiError, notFound } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { serializeProfessionalDetail, serializeServiceDetail } from '../lib/serialize.js';
import { ALLOWED_IMAGE_TYPES, getStorage, MAX_UPLOAD_BYTES } from '../lib/storage.js';
import { audit } from '../lib/audit.js';

/* ---------------- schemas ---------------- */

const profileSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  about: z.string().trim().max(2000).optional(),
  locationCity: z.string().trim().max(120).optional(),
  categorySlug: z.string().trim().max(100).optional(),
  availability: z.enum(['available', 'limited', 'unavailable']).optional(),
  responseTimeLabel: z.string().trim().max(60).optional(),
  imageUrl: z.string().trim().max(500).optional(),
});

const skillsSchema = z.object({
  skills: z.array(z.string().trim().min(1).max(60)).max(15),
});

const portfolioItemSchema = z.object({
  title: z.string().trim().min(1, 'Please enter a title.').max(140),
  category: z.string().trim().max(80).optional(),
  description: z.string().trim().max(1000).optional(),
  mediaUrl: z.string().trim().max(500).optional(),
});

const serviceSchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters.').max(140),
  categorySlug: z.string().trim().min(1, 'Please choose a category.'),
  price: z.coerce.number().int().min(1000, 'Minimum price is ₦1,000.').max(100_000_000),
  priceUnit: z.string().trim().min(1).max(40).default('per project'),
  durationLabel: z.string().trim().max(60).optional(),
  locationLabel: z.string().trim().max(120).optional(),
  isRemote: z.boolean().default(true),
  availability: z.enum(['available', 'limited', 'unavailable']).default('available'),
  shortDescription: z.string().trim().min(20, 'Short description must be at least 20 characters.').max(200),
  description: z.string().trim().min(50, 'Description must be at least 50 characters.').max(5000),
  included: z.array(z.string().trim().min(1).max(200)).max(15).default([]),
  requirements: z.array(z.string().trim().min(1).max(200)).max(15).default([]),
  faqs: z
    .array(z.object({ q: z.string().trim().min(1).max(300), a: z.string().trim().min(1).max(1000) }))
    .max(10)
    .default([]),
  gallery: z.array(z.string().trim().max(500)).max(8).default([]),
});

function slugify(base: string): string {
  return base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 70);
}

async function ownedService(idOrSlug: string, professionalId: string) {
  // Accept either the internal UUID or the public slug (the serializer
  // exposes slugs as `id`, so clients naturally send slugs).
  const service = await prisma.service.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
  });
  if (!service || service.status === 'archived') {
    throw notFound('SERVICE_NOT_FOUND', 'Service not found');
  }
  if (service.professionalId !== professionalId) {
    // Ownership breach: report not-found to avoid resource enumeration.
    throw notFound('SERVICE_NOT_FOUND', 'Service not found');
  }
  return service;
}

const serviceInclude = { media: true, faqs: true, category: true, professional: true } as const;

function serializeOwnService(s: Parameters<typeof serializeServiceDetail>[0] & { status: string }) {
  return { ...serializeServiceDetail(s), status: s.status };
}

export async function proRoutes(app: FastifyInstance) {
  const guard = { preHandler: requireProfessional };

  /* ================= profile ================= */

  app.get(
    '/pro/profile',
    { ...guard, schema: { tags: ['professional'], summary: 'Get own professional profile', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const profile = await prisma.professionalProfile.findUniqueOrThrow({
        where: { id: req.professionalProfileId! },
        include: {
          category: true,
          skills: true,
          portfolio: true,
          services: { where: { status: 'active' } },
        },
      });
      return serializeProfessionalDetail(profile);
    },
  );

  app.patch(
    '/pro/profile',
    { ...guard, schema: { tags: ['professional'], summary: 'Update own professional profile', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const data = parseBody(profileSchema, req.body);
      let categoryId: string | null | undefined;
      if (data.categorySlug !== undefined) {
        if (data.categorySlug === '') categoryId = null;
        else {
          const cat = await prisma.category.findUnique({ where: { slug: data.categorySlug } });
          if (!cat) throw new ApiError(422, 'VALIDATION_ERROR', 'Unknown category.');
          categoryId = cat.id;
        }
      }
      const updated = await prisma.professionalProfile.update({
        where: { id: req.professionalProfileId! },
        data: {
          title: data.title,
          about: data.about,
          locationCity: data.locationCity,
          availability: data.availability,
          responseTimeLabel: data.responseTimeLabel,
          imageUrl: data.imageUrl,
          ...(categoryId !== undefined ? { categoryId } : {}),
        },
        include: { category: true, skills: true, portfolio: true, services: { where: { status: 'active' } } },
      });
      return serializeProfessionalDetail(updated);
    },
  );

  /* ================= skills ================= */

  app.put(
    '/pro/skills',
    { ...guard, schema: { tags: ['professional'], summary: 'Replace own skills list', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { skills } = parseBody(skillsSchema, req.body);
      const unique = [...new Set(skills)];
      await prisma.$transaction([
        prisma.professionalSkill.deleteMany({ where: { professionalId: req.professionalProfileId! } }),
        prisma.professionalSkill.createMany({
          data: unique.map((skill, i) => ({
            professionalId: req.professionalProfileId!,
            skill,
            position: i,
          })),
        }),
      ]);
      return { skills: unique };
    },
  );

  /* ================= portfolio ================= */

  app.post(
    '/pro/portfolio',
    { ...guard, schema: { tags: ['professional'], summary: 'Add a portfolio item', security: [{ bearerAuth: [] }] } },
    async (req, reply) => {
      const data = parseBody(portfolioItemSchema, req.body);
      const count = await prisma.portfolioItem.count({
        where: { professionalId: req.professionalProfileId! },
      });
      if (count >= 20) throw new ApiError(409, 'PORTFOLIO_FULL', 'Portfolio limit reached (20 items).');
      const item = await prisma.portfolioItem.create({
        data: { ...data, professionalId: req.professionalProfileId!, position: count },
      });
      return reply.code(201).send({ id: item.id, title: item.title, category: item.category ?? '' });
    },
  );

  app.delete(
    '/pro/portfolio/:itemId',
    { ...guard, schema: { tags: ['professional'], summary: 'Remove a portfolio item', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { itemId } = req.params as { itemId: string };
      const item = await prisma.portfolioItem.findUnique({ where: { id: itemId } });
      if (!item || item.professionalId !== req.professionalProfileId!) {
        throw notFound('PORTFOLIO_ITEM_NOT_FOUND', 'Portfolio item not found');
      }
      await prisma.portfolioItem.delete({ where: { id: itemId } });
      return { ok: true };
    },
  );

  /* ---------------- uploads (Phase E: real presign via R2) ---------------- */

  app.post(
    '/pro/uploads',
    { ...guard, schema: { tags: ['professional'], summary: 'Request a presigned upload (R2)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const body = parseBody(
        z.object({
          kind: z.enum(['profile', 'portfolio', 'service']),
          fileName: z.string().trim().min(1).max(200),
          contentType: z.string().trim(),
          size: z.coerce.number().int().min(1),
        }),
        req.body,
      );
      if (!ALLOWED_IMAGE_TYPES.includes(body.contentType)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Only JPEG, PNG or WebP images are allowed.');
      }
      if (body.size > MAX_UPLOAD_BYTES) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Images must be 5 MB or smaller.');
      }
      const result = await getStorage().presign(body.kind, body.fileName, body.contentType);
      // Track for orphan cleanup (upload requested, not yet attached).
      await audit(prisma, {
        actorId: req.auth!.sub,
        action: 'upload.presigned',
        entity: 'storage',
        entityId: result.key,
        data: { key: result.key, publicUrl: result.publicUrl, kind: body.kind },
      });
      return result;
    },
  );

  /* ================= services ================= */

  app.get(
    '/pro/services',
    { ...guard, schema: { tags: ['professional'], summary: 'List own services (all statuses)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const rows = await prisma.service.findMany({
        where: { professionalId: req.professionalProfileId!, status: { not: 'archived' } },
        include: serviceInclude,
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(serializeOwnService);
    },
  );

  app.post(
    '/pro/services',
    { ...guard, schema: { tags: ['professional'], summary: 'Create a service (draft)', security: [{ bearerAuth: [] }] } },
    async (req, reply) => {
      const data = parseBody(serviceSchema, req.body);
      const category = await prisma.category.findUnique({ where: { slug: data.categorySlug } });
      if (!category) throw new ApiError(422, 'VALIDATION_ERROR', 'Unknown category.');

      const base = slugify(data.title);
      let slug = base;
      for (let i = 2; await prisma.service.findUnique({ where: { slug } }); i += 1) {
        slug = `${base}-${i}`;
      }

      const created = await prisma.service.create({
        data: {
          slug,
          professionalId: req.professionalProfileId!,
          categoryId: category.id,
          title: data.title,
          shortDescription: data.shortDescription,
          description: data.description,
          price: BigInt(data.price),
          priceUnit: data.priceUnit,
          durationLabel: data.durationLabel,
          locationLabel: data.locationLabel ?? (data.isRemote ? 'Remote' : undefined),
          isRemote: data.isRemote,
          availability: data.availability,
          status: 'draft',
          included: data.included,
          requirements: data.requirements,
          media: {
            create: data.gallery.map((url, i) => ({
              url,
              position: i,
              isCover: i === 0,
              altText: data.title,
            })),
          },
          faqs: { create: data.faqs.map((f, i) => ({ question: f.q, answer: f.a, position: i })) },
        },
        include: serviceInclude,
      });
      return reply.code(201).send(serializeOwnService(created));
    },
  );

  app.get(
    '/pro/services/:id',
    { ...guard, schema: { tags: ['professional'], summary: 'Get one of your services', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const service = await ownedService(id, req.professionalProfileId!);
      const full = await prisma.service.findUniqueOrThrow({
        where: { id: service.id },
        include: serviceInclude,
      });
      return serializeOwnService(full);
    },
  );

  app.patch(
    '/pro/services/:id',
    { ...guard, schema: { tags: ['professional'], summary: 'Update one of your services', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const service = await ownedService(id, req.professionalProfileId!);
      const data = parseBody(serviceSchema.partial(), req.body);

      let categoryId: string | undefined;
      if (data.categorySlug) {
        const cat = await prisma.category.findUnique({ where: { slug: data.categorySlug } });
        if (!cat) throw new ApiError(422, 'VALIDATION_ERROR', 'Unknown category.');
        categoryId = cat.id;
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (data.gallery) {
          await tx.serviceMedia.deleteMany({ where: { serviceId: service.id } });
          await tx.serviceMedia.createMany({
            data: data.gallery.map((url, i) => ({
              serviceId: service.id,
              url,
              position: i,
              isCover: i === 0,
              altText: data.title ?? service.title,
            })),
          });
        }
        if (data.faqs) {
          await tx.serviceFaq.deleteMany({ where: { serviceId: service.id } });
          await tx.serviceFaq.createMany({
            data: data.faqs.map((f, i) => ({
              serviceId: service.id,
              question: f.q,
              answer: f.a,
              position: i,
            })),
          });
        }
        return tx.service.update({
          where: { id: service.id },
          data: {
            title: data.title,
            shortDescription: data.shortDescription,
            description: data.description,
            price: data.price != null ? BigInt(data.price) : undefined,
            priceUnit: data.priceUnit,
            durationLabel: data.durationLabel,
            locationLabel: data.locationLabel,
            isRemote: data.isRemote,
            availability: data.availability,
            included: data.included,
            requirements: data.requirements,
            ...(categoryId ? { categoryId } : {}),
          },
          include: serviceInclude,
        });
      });
      return serializeOwnService(updated);
    },
  );

  app.post(
    '/pro/services/:id/publish',
    { ...guard, schema: { tags: ['professional'], summary: 'Publish a service', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const service = await ownedService(id, req.professionalProfileId!);
      if (service.status === 'active') return { ok: true, status: 'active' };
      const updated = await prisma.service.update({
        where: { id: service.id },
        data: { status: 'active' },
        include: serviceInclude,
      });
      // Keep the profile's startingPrice aggregate honest.
      const min = await prisma.service.aggregate({
        where: { professionalId: req.professionalProfileId!, status: 'active' },
        _min: { price: true },
      });
      await prisma.professionalProfile.update({
        where: { id: req.professionalProfileId! },
        data: { startingPrice: min._min.price },
      });
      return serializeOwnService(updated);
    },
  );

  app.post(
    '/pro/services/:id/unpublish',
    { ...guard, schema: { tags: ['professional'], summary: 'Unpublish a service (back to draft)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const service = await ownedService(id, req.professionalProfileId!);
      const updated = await prisma.service.update({
        where: { id: service.id },
        data: { status: 'paused' },
        include: serviceInclude,
      });
      const min = await prisma.service.aggregate({
        where: { professionalId: req.professionalProfileId!, status: 'active' },
        _min: { price: true },
      });
      await prisma.professionalProfile.update({
        where: { id: req.professionalProfileId! },
        data: { startingPrice: min._min.price },
      });
      return serializeOwnService(updated);
    },
  );

  app.delete(
    '/pro/services/:id',
    { ...guard, schema: { tags: ['professional'], summary: 'Archive (delete) a service', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const service = await ownedService(id, req.professionalProfileId!);
      await prisma.service.update({ where: { id: service.id }, data: { status: 'archived' } });
      return { ok: true };
    },
  );
}
