/**
 * SERVIX Phase C — professional application workflow (Phase E update).
 *
 *   CUSTOMER → APPLICATION → ADMIN REVIEW → APPROVED → PROFESSIONAL
 *   states: pending → under_review → approved | rejected
 *
 * Rules enforced server-side:
 *  - only authenticated customers may apply
 *  - one active (pending/under_review/approved) application per user
 *  - applications are editable only while status = pending
 *  - approval is SERVER-controlled: role promotion happens exclusively in
 *    the admin approval transaction — no client-writable role field anywhere
 *  - rejected applicants may re-apply (new application), but never edit
 *    the rejected record
 *
 * Phase E: the temporary X-Servix-Review-Key review endpoint is REMOVED.
 * Review now happens exclusively through the authenticated, audited
 * admin endpoints in routes/admin.ts.
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

export function serializeApplication(a: {
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

export function slugify(base: string): string {
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
}
