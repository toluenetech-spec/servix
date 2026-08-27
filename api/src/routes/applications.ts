/**
 * SERVIX Phase C — professional application workflow.
 *
 *   CUSTOMER → APPLICATION → REVIEW → APPROVED → PROFESSIONAL
 *   states: pending → under_review → approved | rejected
 *
 * Rules enforced server-side:
 *  - only authenticated customers may apply
 *  - one active (pending/under_review/approved) application per user
 *  - applications are editable only while status = pending
 *  - approval is SERVER-controlled: role promotion happens exclusively in
 *    the approval transaction — no client-writable role field anywhere
 *  - rejected applicants may re-apply (new application), but never edit
 *    the rejected record
 *
 * Review endpoints: the admin dashboard is out of scope for Phase C, so
 * approval/rejection is exposed ONLY as an internal, non-public route
 * guarded by X-Servix-Review-Key (SERVIX_REVIEW_KEY env). It exists so
 * the lifecycle is real and testable end-to-end without faking states.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAuth } from '../lib/authGuard.js';
import { ApiError, forbidden, notFound } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';

const applicationSchema = z.object({
  title: z.string().trim().min(3, 'Please enter your professional title.').max(120),
  about: z.string().trim().max(2000).optional(),
  locationCity: z.string().trim().max(120).optional(),
  categorySlug: z.string().trim().max(100).optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  portfolio: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(140),
        category: z.string().trim().max(80).optional(),
      }),
    )
    .max(10)
    .default([]),
});

const ACTIVE_STATUSES = ['pending', 'under_review', 'approved'] as const;

function serializeApplication(a: {
  id: string;
  status: string;
  title: string;
  about: string | null;
  locationCity: string | null;
  categorySlug: string | null;
  skills: unknown;
  portfolio: unknown;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: a.id,
    status: a.status,
    title: a.title,
    about: a.about ?? '',
    locationCity: a.locationCity ?? '',
    categorySlug: a.categorySlug ?? '',
    skills: a.skills as string[],
    portfolio: a.portfolio as { title: string; category?: string }[],
    submittedAt: a.submittedAt?.toISOString() ?? null,
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    rejectionReason: a.rejectionReason,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function slugify(base: string): string {
  return base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

export async function applicationRoutes(app: FastifyInstance) {
  /* -------- create (draft) -------- */
  app.post(
    '/applications',
    { preHandler: requireAuth, schema: { tags: ['professional'], summary: 'Create a professional application (draft)', security: [{ bearerAuth: [] }] } },
    async (req, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: req.auth!.sub },
        include: { professionalProfile: { select: { id: true } } },
      });
      if (!user || user.deletedAt) throw forbidden();
      if (user.role === 'professional' || user.professionalProfile) {
        throw new ApiError(409, 'ALREADY_PROFESSIONAL', 'You are already a professional on Servix.');
      }
      const active = await prisma.professionalApplication.findFirst({
        where: { userId: user.id, status: { in: ACTIVE_STATUSES as unknown as ('pending' | 'under_review' | 'approved')[] } },
      });
      if (active) {
        throw new ApiError(409, 'APPLICATION_EXISTS', 'You already have an active application.');
      }
      const data = parseBody(applicationSchema, req.body);
      const created = await prisma.professionalApplication.create({
        data: {
          userId: user.id,
          title: data.title,
          about: data.about,
          locationCity: data.locationCity,
          categorySlug: data.categorySlug,
          skills: data.skills,
          portfolio: data.portfolio,
        },
      });
      return reply.code(201).send(serializeApplication(created));
    },
  );

  /* -------- read own (current/latest) -------- */
  app.get(
    '/applications/me',
    { preHandler: requireAuth, schema: { tags: ['professional'], summary: "Current user's latest application", security: [{ bearerAuth: [] }] } },
    async (req) => {
      const latest = await prisma.professionalApplication.findFirst({
        where: { userId: req.auth!.sub },
        orderBy: { createdAt: 'desc' },
      });
      if (!latest) throw notFound('APPLICATION_NOT_FOUND', 'No application found.');
      return serializeApplication(latest);
    },
  );

  /* -------- update (only while pending) -------- */
  app.patch(
    '/applications/:id',
    { preHandler: requireAuth, schema: { tags: ['professional'], summary: 'Update a pending application', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const existing = await prisma.professionalApplication.findUnique({ where: { id } });
      if (!existing) throw notFound('APPLICATION_NOT_FOUND', 'No application found.');
      if (existing.userId !== req.auth!.sub) throw forbidden('Not your application.');
      if (existing.status !== 'pending') {
        throw new ApiError(409, 'APPLICATION_LOCKED', 'This application can no longer be edited.');
      }
      const data = parseBody(applicationSchema.partial(), req.body);
      const updated = await prisma.professionalApplication.update({
        where: { id },
        data,
      });
      return serializeApplication(updated);
    },
  );

  /* -------- submit (pending → under_review) -------- */
  app.post(
    '/applications/:id/submit',
    { preHandler: requireAuth, schema: { tags: ['professional'], summary: 'Submit an application for review', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const existing = await prisma.professionalApplication.findUnique({ where: { id } });
      if (!existing) throw notFound('APPLICATION_NOT_FOUND', 'No application found.');
      if (existing.userId !== req.auth!.sub) throw forbidden('Not your application.');
      if (existing.status !== 'pending') {
        throw new ApiError(409, 'INVALID_TRANSITION', 'Only pending applications can be submitted.');
      }
      if (!existing.title || existing.title.trim().length < 3) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Complete your application before submitting.');
      }
      const updated = await prisma.professionalApplication.update({
        where: { id },
        data: { status: 'under_review', submittedAt: new Date() },
      });
      return serializeApplication(updated);
    },
  );

  /* -------- internal review (admin dashboard is Phase E) --------
     Guarded by a server-side key; not part of the public API surface. */
  app.post(
    '/applications/:id/review',
    { schema: { hide: true } },
    async (req) => {
      const key = req.headers['x-servix-review-key'];
      const expected = process.env.SERVIX_REVIEW_KEY ?? 'dev-review-key';
      if (!key || key !== expected) throw forbidden('Review access denied.');

      const { id } = req.params as { id: string };
      const body = parseBody(
        z.object({
          decision: z.enum(['approved', 'rejected']),
          reason: z.string().trim().max(1000).optional(),
        }),
        req.body,
      );

      const application = await prisma.professionalApplication.findUnique({
        where: { id },
        include: { user: true },
      });
      if (!application) throw notFound('APPLICATION_NOT_FOUND', 'No application found.');
      if (application.status !== 'under_review') {
        throw new ApiError(409, 'INVALID_TRANSITION', 'Only submitted applications can be reviewed.');
      }

      if (body.decision === 'rejected') {
        const updated = await prisma.professionalApplication.update({
          where: { id },
          data: { status: 'rejected', reviewedAt: new Date(), rejectionReason: body.reason ?? null },
        });
        return serializeApplication(updated);
      }

      /* APPROVAL — the only place role promotion happens. Transactional:
         application → approved, user → professional, profile created. */
      const category = application.categorySlug
        ? await prisma.category.findUnique({ where: { slug: application.categorySlug } })
        : null;

      // Unique slug from the user's name.
      const base = slugify(application.user.fullName) || `pro-${application.userId.slice(0, 8)}`;
      let slug = base;
      for (let i = 2; await prisma.professionalProfile.findUnique({ where: { slug } }); i += 1) {
        slug = `${base}-${i}`;
      }

      const skills = (application.skills as string[]) ?? [];
      const portfolio = (application.portfolio as { title: string; category?: string }[]) ?? [];

      const [updated] = await prisma.$transaction([
        prisma.professionalApplication.update({
          where: { id },
          data: { status: 'approved', reviewedAt: new Date() },
        }),
        prisma.user.update({
          where: { id: application.userId },
          data: { role: 'professional' },
        }),
        prisma.professionalProfile.create({
          data: {
            userId: application.userId,
            slug,
            name: application.user.fullName,
            title: application.title,
            about: application.about,
            locationCity: application.locationCity,
            categoryId: category?.id ?? null,
            memberSince: String(new Date().getFullYear()),
            skills: { create: skills.map((skill, i) => ({ skill, position: i })) },
            portfolio: {
              create: portfolio.map((item, i) => ({
                title: item.title,
                category: item.category,
                position: i,
              })),
            },
          },
        }),
      ]);
      return serializeApplication(updated);
    },
  );
}
