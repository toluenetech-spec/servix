/**
 * SERVIX Phase C — professional application workflow (Phase E update).
 *
 *   CUSTOMER → APPLICATION → ADMIN REVIEW → APPROVED → PROFESSIONAL
 *   states: pending → under_review → approved | rejected
 *
 * Rules enforced server-side:
 *  - authenticated applicants without a professional profile may apply
 *    (includes legacy professional-role accounts awaiting approval)
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
import { parseBody, parsePatchBody } from '../lib/query.js';
import { assertOwnMediaUrl, storeUpload } from './uploads.js';
import { extractPdfText, parseResumeText } from '../lib/resumeParser.js';
import { getStorage, MAX_DOCUMENT_BYTES } from '../lib/storage.js';

const text = (max: number) => z.string().trim().max(max);
const optionalUrl = z.string().trim().max(500).optional().or(z.literal('').transform(() => undefined));

/** Structured profile details shared by applications and approved profiles. */
export const profileDetailsSchema = z.object({
  occupation: text(120).optional(),
  website: optionalUrl,
  languages: z.array(z.object({ name: text(40).min(1), level: text(40).default('') })).max(8).default([]),
  education: z.array(z.object({ school: text(160).min(1), degree: text(160).default(''), year: text(40).default('') })).max(6).default([]),
  certifications: z.array(z.object({ name: text(160).min(1), issuer: text(120).default(''), year: text(40).default('') })).max(10).default([]),
  experience: z
    .array(z.object({ title: text(120).min(1), company: text(120).default(''), start: text(40).default(''), end: text(40).default(''), description: text(600).default('') }))
    .max(8)
    .default([]),
  source: z.enum(['manual', 'linkedin', 'cv']).optional(),
});
export type ProfileDetails = z.infer<typeof profileDetailsSchema>;

export function normalizeDetails(value: unknown): ProfileDetails {
  const parsed = profileDetailsSchema.safeParse(value && typeof value === 'object' ? value : {});
  return parsed.success ? parsed.data : profileDetailsSchema.parse({});
}

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
        mediaUrl: optionalUrl,
      }),
    )
    .max(10)
    .default([]),
  details: profileDetailsSchema.optional(),
  photoUrl: optionalUrl.nullable(),
  resumeUrl: optionalUrl.nullable(),
  resumeFileName: text(200).optional().nullable(),
});

function checkMediaUrls(data: Partial<z.infer<typeof applicationSchema>>) {
  if (data.photoUrl) assertOwnMediaUrl(data.photoUrl, 'Profile photo');
  if (data.resumeUrl) assertOwnMediaUrl(data.resumeUrl, 'CV');
  for (const item of data.portfolio ?? []) if (item.mediaUrl) assertOwnMediaUrl(item.mediaUrl, 'Portfolio image');
}

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
  details?: unknown;
  photoUrl?: string | null;
  resumeUrl?: string | null;
  resumeFileName?: string | null;
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
    portfolio: a.portfolio as { title: string; category?: string; mediaUrl?: string }[],
    details: normalizeDetails(a.details),
    photoUrl: a.photoUrl ?? null,
    resumeUrl: a.resumeUrl ?? null,
    resumeFileName: a.resumeFileName ?? null,
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
      if (user.professionalProfile) {
        throw new ApiError(409, 'ALREADY_PROFESSIONAL', 'You are already a professional on Servix.');
      }
      const active = await prisma.professionalApplication.findFirst({
        where: { userId: user.id, status: { in: ACTIVE_STATUSES as unknown as ('pending' | 'under_review' | 'approved')[] } },
      });
      if (active) {
        throw new ApiError(409, 'APPLICATION_EXISTS', 'You already have an active application.');
      }
      const data = parseBody(applicationSchema, req.body);
      checkMediaUrls(data);
      const created = await prisma.professionalApplication.create({
        data: {
          userId: user.id,
          title: data.title,
          about: data.about,
          locationCity: data.locationCity,
          categorySlug: data.categorySlug,
          skills: data.skills,
          portfolio: data.portfolio,
          details: data.details ?? {},
          photoUrl: data.photoUrl ?? null,
          resumeUrl: data.resumeUrl ?? null,
          resumeFileName: data.resumeUrl ? data.resumeFileName ?? null : null,
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
      const data = parsePatchBody(applicationSchema, req.body);
      checkMediaUrls(data);
      const updated = await prisma.professionalApplication.update({
        where: { id },
        data: {
          ...data,
          details: data.details === undefined ? undefined : data.details,
          photoUrl: data.photoUrl === undefined ? undefined : data.photoUrl,
          resumeUrl: data.resumeUrl === undefined ? undefined : data.resumeUrl,
          resumeFileName: data.resumeFileName === undefined ? undefined : data.resumeFileName,
        },
      });
      return serializeApplication(updated);
    },
  );

  /* -------- CV / LinkedIn PDF import -------- */
  app.post(
    '/applications/resume',
    {
      preHandler: requireAuth,
      bodyLimit: MAX_DOCUMENT_BYTES + 64 * 1024,
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: { tags: ['professional'], summary: 'Read a LinkedIn PDF or CV and suggest application fields', security: [{ bearerAuth: [] }] },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const body = req.body;
      const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (!Buffer.isBuffer(body) || contentType !== 'application/pdf') {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Upload the PDF file itself (LinkedIn “Save to PDF” or your CV).');
      }
      if (body.byteLength > MAX_DOCUMENT_BYTES) throw new ApiError(422, 'VALIDATION_ERROR', 'PDFs must be 10 MB or smaller.');
      const fileName = String((req.query as { fileName?: string })?.fileName ?? 'resume.pdf').slice(0, 200) || 'resume.pdf';
      const user = await prisma.user.findUnique({ where: { id: req.auth!.sub }, select: { fullName: true } });

      let text = '';
      try {
        text = await extractPdfText(body);
      } catch {
        throw new ApiError(422, 'VALIDATION_ERROR', 'We could not read that PDF. Export it again from LinkedIn or save your CV as a standard PDF.');
      }
      const suggestions = parseResumeText(text, user?.fullName ?? '');

      // Keep the original for the admin review when storage is available; never block the import on it.
      let stored: { url: string; fileName: string } | null = null;
      let storageNote: string | null = null;
      if (getStorage().enabled) {
        try {
          const result = await storeUpload({ userId: req.auth!.sub, kind: 'resume', fileName, contentType, body, ip: req.ip });
          stored = { url: result.url, fileName: result.fileName };
        } catch (err) {
          req.log.warn({ err }, 'resume upload failed; continuing with suggestions only');
          storageNote = 'We read your PDF but could not keep a copy for the review team. You can continue; an admin may ask for it later.';
        }
      } else {
        storageNote = 'File storage is not active in this environment, so the PDF was read but not kept.';
      }
      return {
        resumeUrl: stored?.url ?? null,
        resumeFileName: stored?.fileName ?? null,
        textFound: text.trim().length > 40,
        suggestions,
        note: storageNote,
      };
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
