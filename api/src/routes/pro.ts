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
import { requireProfessional, requireKycVerified } from '../lib/authGuard.js';
import { ApiError, notFound } from '../lib/errors.js';
import { parseBody, parsePatchBody } from '../lib/query.js';
import { serializeProfessionalDetail, serializeServiceDetail } from '../lib/serialize.js';
import { ALLOWED_IMAGE_TYPES, getStorage, MAX_UPLOAD_BYTES, mediaUrl } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { assertListingAllowed } from '../lib/plans.js';
import { entitlementsFor, assertWithinLimit } from '../lib/entitlements/index.js';
import { assertOwnMediaUrl } from './uploads.js';
import { profileDetailsSchema } from './applications.js';

/* ---------------- schemas ---------------- */

const profileSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  about: z.string().trim().max(2000).optional(),
  locationCity: z.string().trim().max(120).optional(),
  categorySlug: z.string().trim().max(100).optional(),
  availability: z.enum(['available', 'limited', 'unavailable']).optional(),
  responseTimeLabel: z.string().trim().max(60).optional(),
  imageUrl: z.string().trim().max(500).optional().nullable(),
  details: profileDetailsSchema.optional(),
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

/* Gig wizard (Fiverr-style): Overview → Pricing → Description & FAQ →
 * Requirements → Gallery → Publish. Drafts may be saved with only the
 * Overview fields; publishing enforces completeness (see publishProblems). */
const requirementSchema = z.union([
  z.string().trim().min(1).max(300).transform((question) => ({ question, type: 'text' as const, options: [] as string[], required: false })),
  z.object({
    question: z.string().trim().min(1, 'Enter the question.').max(300),
    type: z.enum(['text', 'choice', 'file']).default('text'),
    options: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
    required: z.boolean().default(false),
  }),
]);
const mediaSchema = z.union([
  z.string().trim().min(1).max(500).transform((url) => ({ url, kind: 'image' as const, fileName: '' })),
  z.object({
    url: z.string().trim().min(1).max(500),
    kind: z.enum(['image', 'video', 'document']).default('image'),
    fileName: z.string().trim().max(200).default(''),
  }),
]);
const serviceSchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters.').max(140),
  categorySlug: z.string().trim().min(1, 'Please choose a category.'),
  serviceType: z.string().trim().max(80).optional(),
  searchTags: z.array(z.string().trim().min(2, 'Tags need at least 2 characters.').max(20, 'Tags can be 20 characters at most.')).max(5, 'Up to 5 tags.').default([]),
  price: z.coerce.number().int().min(1000, 'Minimum price is ₦1,000.').max(100_000_000),
  priceUnit: z.string().trim().min(1).max(40).default('per project'),
  deliveryDays: z.coerce.number().int().min(1, 'Delivery takes at least 1 day.').max(90, 'Delivery can be 90 days at most.').optional(),
  revisions: z.coerce.number().int().min(0).max(20).optional(),
  durationLabel: z.string().trim().max(60).optional(),
  locationLabel: z.string().trim().max(120).optional(),
  isRemote: z.boolean().default(true),
  availability: z.enum(['available', 'limited', 'unavailable']).default('available'),
  shortDescription: z.string().trim().max(200, 'Keep the short description under 200 characters.').default(''),
  description: z.string().trim().max(5000).default(''),
  included: z.array(z.string().trim().min(1).max(200)).max(15).default([]),
  requirements: z.array(requirementSchema).max(15, 'Up to 15 requirements.').default([]),
  faqs: z
    .array(z.object({ q: z.string().trim().min(1).max(300), a: z.string().trim().min(1).max(1000) }))
    .max(10)
    .default([]),
  gallery: z.array(mediaSchema).max(8).default([]),
});
type ServiceInput = z.infer<typeof serviceSchema>;

function checkGallery(gallery: ServiceInput['gallery'] | undefined) {
  if (!gallery) return;
  const counts = { image: 0, video: 0, document: 0 };
  for (const item of gallery) {
    assertOwnMediaUrl(item.url, 'Gallery file');
    counts[item.kind] += 1;
  }
  if (counts.image > 5) throw new ApiError(422, 'VALIDATION_ERROR', 'A gig can have up to 5 images.');
  if (counts.video > 1) throw new ApiError(422, 'VALIDATION_ERROR', 'A gig can have one video.');
  if (counts.document > 2) throw new ApiError(422, 'VALIDATION_ERROR', 'A gig can have up to 2 PDF documents.');
}

/** What still blocks publishing — surfaced as a checklist to the professional. */
export function publishProblems(s: {
  title: string; shortDescription: string; description: string; price: bigint | number; deliveryDays: number | null;
  media?: { kind: string }[];
}): Record<string, string> {
  const problems: Record<string, string> = {};
  if (!s.title || s.title.trim().length < 5) problems.title = 'Add a title of at least 5 characters.';
  if (!s.shortDescription || s.shortDescription.trim().length < 20) problems.shortDescription = 'Write a short description of at least 20 characters.';
  if (!s.description || s.description.trim().length < 50) problems.description = 'Describe the gig in at least 50 characters.';
  if (Number(s.price) < 1000) problems.price = 'Set a price of at least ₦1,000.';
  if (!s.deliveryDays) problems.deliveryDays = 'Choose a delivery time.';
  if (!(s.media ?? []).some((m) => m.kind === 'image')) problems.gallery = 'Add at least one image to the gallery.';
  return problems;
}

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

function deliveryLabel(days: number) {
  return days === 1 ? '1 day delivery' : `${days} days delivery`;
}

function serializeOwnService(s: Parameters<typeof serializeServiceDetail>[0] & { status: string; media?: { kind: string }[] }) {
  return { ...serializeServiceDetail(s), status: s.status, publishProblems: publishProblems(s) };
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
      if (data.imageUrl) assertOwnMediaUrl(data.imageUrl, 'Profile photo');
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
          imageUrl: data.imageUrl === undefined ? undefined : data.imageUrl || null,
          details: data.details,
          ...(categoryId !== undefined ? { categoryId } : {}),
        },
        include: { category: true, skills: true, portfolio: true, services: { where: { status: 'active' } } },
      });
      // Keep the account avatar (navbar, messages) in step with the professional photo,
      // the same way PATCH /account/profile pushes the account avatar down to the profile.
      if (data.imageUrl !== undefined) {
        await prisma.user.update({ where: { id: req.auth!.sub }, data: { avatarUrl: data.imageUrl || null } });
      }
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
      if (data.mediaUrl) assertOwnMediaUrl(data.mediaUrl, 'Portfolio image');
      const count = await prisma.portfolioItem.count({
        where: { professionalId: req.professionalProfileId! },
      });
      assertWithinLimit(await entitlementsFor(req), 'portfolio_items', count, 1);
      const item = await prisma.portfolioItem.create({
        data: { ...data, professionalId: req.professionalProfileId!, position: count },
      });
      return reply.code(201).send({ id: item.id, title: item.title, category: item.category ?? '', description: item.description ?? '', image: mediaUrl(item.mediaUrl) });
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
      checkGallery(data.gallery);
      await assertListingAllowed(req.professionalProfileId!, await entitlementsFor(req));
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
          durationLabel: data.durationLabel ?? (data.deliveryDays ? deliveryLabel(data.deliveryDays) : undefined),
          locationLabel: data.locationLabel ?? (data.isRemote ? 'Remote' : undefined),
          isRemote: data.isRemote,
          availability: data.availability,
          status: 'draft',
          included: data.included,
          requirements: data.requirements,
          searchTags: data.searchTags,
          serviceType: data.serviceType,
          deliveryDays: data.deliveryDays,
          revisions: data.revisions,
          media: {
            create: data.gallery.map((m, i) => ({
              url: m.url,
              kind: m.kind,
              fileName: m.fileName || null,
              position: i,
              isCover: i === data.gallery.findIndex((x) => x.kind === 'image'),
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
      const data = parsePatchBody(serviceSchema, req.body);
      checkGallery(data.gallery);

      let categoryId: string | undefined;
      if (data.categorySlug) {
        const cat = await prisma.category.findUnique({ where: { slug: data.categorySlug } });
        if (!cat) throw new ApiError(422, 'VALIDATION_ERROR', 'Unknown category.');
        categoryId = cat.id;
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (data.gallery) {
          await tx.serviceMedia.deleteMany({ where: { serviceId: service.id } });
          const gallery = data.gallery;
          await tx.serviceMedia.createMany({
            data: gallery.map((m, i) => ({
              serviceId: service.id,
              url: m.url,
              kind: m.kind,
              fileName: m.fileName || null,
              position: i,
              isCover: i === gallery.findIndex((x) => x.kind === 'image'),
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
            durationLabel: data.durationLabel ?? (data.deliveryDays ? deliveryLabel(data.deliveryDays) : undefined),
            locationLabel: data.locationLabel,
            isRemote: data.isRemote,
            availability: data.availability,
            included: data.included,
            requirements: data.requirements,
            searchTags: data.searchTags,
            serviceType: data.serviceType,
            deliveryDays: data.deliveryDays,
            revisions: data.revisions,
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
    { preHandler: [requireProfessional, requireKycVerified], schema: { tags: ['professional'], summary: 'Publish a service (identity verification required)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const service = await ownedService(id, req.professionalProfileId!);
      if (service.status === 'active') return { ok: true, status: 'active' };
      const media = await prisma.serviceMedia.findMany({ where: { serviceId: service.id }, select: { kind: true } });
      const problems = publishProblems({ ...service, media });
      if (Object.keys(problems).length > 0) {
        throw new ApiError(422, 'GIG_INCOMPLETE', 'Finish these before publishing.', problems);
      }
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
