/**
 * Manual KYC / identity verification.
 *
 * User side
 *   POST /kyc/upload?part=document|selfie&documentType=…   raw file body → private key
 *   POST /kyc/submit                                          JSON metadata → pending review
 *   GET  /kyc/status
 *   GET  /kyc/files/:name?t=<token>                           signed, short-lived read (admins only
 *                                                             can mint tokens; no auth header needed
 *                                                             so <img> tags can load them)
 * Admin side (role re-read from the database)
 *   GET  /admin/kyc/pending?status=&page=&pageSize=
 *   GET  /admin/kyc/:id                                       details + signed URLs
 *   POST /admin/kyc/:id/review                                { action, rejectionReason? }
 *
 * Privacy: files live under private object-storage keys that /media never
 * serves; the ID number is AES-256-GCM encrypted at rest; every review is
 * audited; outcomes are delivered in-app and by email.
 */
import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAuth, requireAdmin } from '../lib/authGuard.js';
import { ApiError, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { getStorage } from '../lib/storage.js';
import { enqueueMail } from '../lib/jobs.js';
import { kycOutcomeMail } from '../lib/mailer.js';
import { notify, notifySafely } from '../lib/notifications.js';
import {
  KYC_DOCUMENT_LABELS, KYC_DOCUMENT_TYPES, KYC_DOCUMENT_TYPES_ALLOWING_PDF, KYC_IMAGE_TYPES, KYC_MAX_BYTES, KYC_PARTS,
  KYC_REJECTION_REASONS, KYC_SIGNED_URL_TTL_SECONDS, decryptIdNumber, encryptIdNumber, idNumberDigest, kycFileKey,
  maskIdNumber, normalizeIdNumber, ownsKycKey, signKycFileToken, sniffMime, verifyKycFileToken,
  type KycDocumentType, type KycPart,
} from '../lib/kyc.js';

const uploadQuery = z.object({
  part: z.enum(KYC_PARTS),
  documentType: z.enum(KYC_DOCUMENT_TYPES).optional(),
});

const submitSchema = z.object({
  documentType: z.enum(KYC_DOCUMENT_TYPES),
  idNumber: z.string().trim().min(6, 'Enter the number exactly as printed on the document.').max(40),
  documentFileKey: z.string().trim().min(1, 'Upload a photo or PDF of the document.').max(300),
  selfieFileKey: z.string().trim().min(1, 'Upload your selfie.').max(300),
  consentGiven: z.literal(true, { message: 'You must confirm the documents are yours and consent to processing.' }),
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.').optional().or(z.literal('')),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
});

const reviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  rejectionReason: z.string().trim().max(500).optional(),
});

const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || 'body';
    if (!errors[path]) errors[path] = issue.message;
  }
  throw new ApiError(422, 'VALIDATION_ERROR', 'Please check the highlighted fields.', errors);
}

const activeStatuses = ['pending', 'approved'] as const;

function serializeOwn(row: {
  status: string; documentType: string; rejectionReason: string | null; createdAt: Date; updatedAt: Date; reviewedAt: Date | null;
} | null, kycStatus: string) {
  if (!row) return { status: 'not_submitted', kycStatus, documentType: null, documentTypeLabel: null, rejectionReason: null, submittedAt: null, reviewedAt: null, canSubmit: true };
  return {
    status: row.status,
    kycStatus,
    documentType: row.documentType,
    documentTypeLabel: KYC_DOCUMENT_LABELS[row.documentType as KycDocumentType] ?? row.documentType,
    rejectionReason: row.status === 'rejected' ? row.rejectionReason : null,
    submittedAt: row.updatedAt.toISOString(),
    firstSubmittedAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    canSubmit: row.status === 'rejected',
  };
}

export async function kycRoutes(app: FastifyInstance) {
  const userGuard = { preHandler: requireAuth };
  const adminGuard = { preHandler: requireAdmin };

  /* ================= user: upload one part ================= */

  app.post(
    '/kyc/upload',
    {
      ...userGuard,
      bodyLimit: KYC_MAX_BYTES + 64 * 1024,
      config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
      schema: { tags: ['kyc'], summary: 'Upload an identity document or selfie (private storage)', security: [{ bearerAuth: [] }] },
    },
    async (req, reply) => {
      const { part, documentType } = parse(uploadQuery, req.query);
      const userId = req.auth!.sub;
      const existing = await prisma.kycVerification.findUnique({ where: { userId }, select: { status: true } });
      if (existing && (activeStatuses as readonly string[]).includes(existing.status)) {
        throw new ApiError(409, 'KYC_ALREADY_SUBMITTED', existing.status === 'approved' ? 'Your identity is already verified.' : 'Your verification is already under review.');
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'Send the file as the request body.');
      if (body.length > KYC_MAX_BYTES) throw new ApiError(422, 'FILE_TOO_LARGE', 'That file is too large. Maximum size is 5 MB.');
      const declared = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      const actual = sniffMime(body);
      if (!actual || actual !== declared) {
        throw new ApiError(422, 'UNSUPPORTED_FILE', 'Only JPEG or PNG images are accepted (PDF for an NIN slip). The file contents did not match its type.');
      }
      if (actual === 'application/pdf') {
        if (part !== 'document') throw new ApiError(422, 'UNSUPPORTED_FILE', 'Your selfie must be a JPEG or PNG photo.');
        if (!documentType || !KYC_DOCUMENT_TYPES_ALLOWING_PDF.includes(documentType)) {
          throw new ApiError(422, 'UNSUPPORTED_FILE', 'PDF is only accepted for an NIN slip. Upload a JPEG or PNG photo of this document.');
        }
      } else if (!(KYC_IMAGE_TYPES as readonly string[]).includes(actual)) {
        throw new ApiError(422, 'UNSUPPORTED_FILE', 'Only JPEG or PNG images are accepted.');
      }
      const storage = getStorage();
      if (!storage.enabled) throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Secure file storage is not available right now. Please try again later.');
      const key = kycFileKey(userId, part as KycPart, actual);
      try {
        await storage.putObjectAt(key, actual, body);
      } catch (err) {
        req.log.error({ err }, 'kyc upload failed');
        throw new ApiError(502, 'STORAGE_ERROR', 'We could not store the file securely. Please try again.');
      }
      return reply.code(201).send({ fileKey: key, part, contentType: actual, size: body.length });
    },
  );

  /* ================= user: submit ================= */

  app.post(
    '/kyc/submit',
    { ...userGuard, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } }, schema: { tags: ['kyc'], summary: 'Submit identity documents for manual review', security: [{ bearerAuth: [] }] } },
    async (req, reply) => {
      const data = parse(submitSchema, req.body);
      const userId = req.auth!.sub;
      const errors: Record<string, string> = {};
      if (!ownsKycKey(data.documentFileKey, userId, 'document')) errors.documentFileKey = 'Upload the document again.';
      if (!ownsKycKey(data.selfieFileKey, userId, 'selfie')) errors.selfieFileKey = 'Upload the selfie again.';
      if (data.documentFileKey.endsWith('.pdf') && !KYC_DOCUMENT_TYPES_ALLOWING_PDF.includes(data.documentType)) errors.documentFileKey = 'PDF is only accepted for an NIN slip.';
      let dob: Date | null = null;
      if (data.dateOfBirth) {
        dob = new Date(`${data.dateOfBirth}T00:00:00Z`);
        const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
        if (Number.isNaN(dob.getTime()) || age < 16 || age > 120) errors.dateOfBirth = 'Enter a valid date of birth.';
      }
      if (Object.keys(errors).length) throw new ApiError(422, 'VALIDATION_ERROR', 'Please check the highlighted fields.', errors);

      const normalized = normalizeIdNumber(data.idNumber);
      const digest = idNumberDigest(data.documentType, normalized);
      const storage = getStorage();

      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.kycVerification.findUnique({ where: { userId } });
        if (existing && (activeStatuses as readonly string[]).includes(existing.status)) {
          throw new ApiError(409, 'KYC_ALREADY_SUBMITTED', existing.status === 'approved' ? 'Your identity is already verified.' : 'Your verification is already under review. You cannot submit another request until it is reviewed.');
        }
        const clash = await tx.kycVerification.findFirst({ where: { idNumberDigest: digest, userId: { not: userId }, status: { in: ['pending', 'approved'] } }, select: { id: true } });
        if (clash) throw new ApiError(409, 'KYC_DOCUMENT_IN_USE', 'This document number is already linked to another Servix account. Contact support if you believe this is a mistake.');

        const payload = {
          documentType: data.documentType,
          idNumberEncrypted: encryptIdNumber(normalized),
          idNumberDigest: digest,
          dateOfBirth: dob,
          phone: data.phone?.trim() || null,
          documentFileKey: data.documentFileKey,
          selfieFileKey: data.selfieFileKey,
          status: 'pending' as const,
          rejectionReason: null,
          reviewedById: null,
          reviewedAt: null,
          consentAt: new Date(),
        };
        const row = existing
          ? await tx.kycVerification.update({ where: { id: existing.id }, data: payload })
          : await tx.kycVerification.create({ data: { userId, ...payload } });
        const user = await tx.user.update({ where: { id: userId }, data: { kycStatus: 'pending' }, select: { kycStatus: true, fullName: true } });
        await audit(tx, { actorId: userId, action: existing ? 'kyc.resubmitted' : 'kyc.submitted', entity: 'kyc_verification', entityId: row.id, data: { documentType: data.documentType }, ip: req.ip });
        // Old files from a rejected attempt are no longer referenced.
        const stale = existing ? [existing.documentFileKey, existing.selfieFileKey].filter((k) => k !== row.documentFileKey && k !== row.selfieFileKey) : [];
        return { row, user, stale };
      });

      for (const key of result.stale) void storage.deleteObject(key);
      // Tell admins there is something to review (best effort, outside the transaction).
      const admins = await prisma.user.findMany({ where: { role: 'admin', deletedAt: null, status: 'active' }, select: { id: true }, take: 20 });
      for (const admin of admins) {
        await notifySafely({ userId: admin.id, type: 'kyc.pending', title: 'New identity verification to review', body: `${result.user.fullName} submitted a ${KYC_DOCUMENT_LABELS[data.documentType]} for verification.`, link: `/admin?tab=identity&kyc=${result.row.id}` });
      }
      return reply.code(201).send(serializeOwn(result.row, result.user.kycStatus));
    },
  );

  /* ================= user: status ================= */

  app.get(
    '/kyc/status',
    { ...userGuard, schema: { tags: ['kyc'], summary: 'Current identity verification state', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const userId = req.auth!.sub;
      const [row, user] = await Promise.all([
        prisma.kycVerification.findUnique({ where: { userId } }),
        prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } }),
      ]);
      return serializeOwn(row, user?.kycStatus ?? 'unverified');
    },
  );

  /* ================= signed file read ================= */

  app.get<{ Params: { name: string }; Querystring: { t?: string } }>(
    '/kyc/files/:name',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, schema: { tags: ['kyc'], summary: 'Read a KYC file with a short-lived signed token (?t=…)' } },
    async (req, reply) => {
      const payload = verifyKycFileToken(typeof req.query.t === 'string' ? req.query.t : '');
      if (!payload) throw new ApiError(401, 'INVALID_SIGNATURE', 'This link is invalid or has expired.');
      // The admin who minted the link must still be an active admin.
      const admin = await prisma.user.findUnique({ where: { id: payload.by }, select: { role: true, status: true, deletedAt: true } });
      if (!admin || admin.role !== 'admin' || admin.deletedAt || admin.status !== 'active') throw new ApiError(401, 'INVALID_SIGNATURE', 'This link is invalid or has expired.');
      const storage = getStorage();
      if (!storage.enabled) throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Secure file storage is not available right now.');
      const upstream = await storage.fetchObject(payload.key);
      if (!upstream || !upstream.body) throw notFound('NOT_FOUND', 'File not found.');
      const type = upstream.headers.get('content-type') || (payload.key.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
      reply.header('content-type', type);
      const length = upstream.headers.get('content-length');
      if (length) reply.header('content-length', length);
      reply.header('cache-control', 'private, no-store');
      reply.header('content-disposition', 'inline');
      reply.header('x-content-type-options', 'nosniff');
      reply.header('cross-origin-resource-policy', 'cross-origin');
      return reply.send(Readable.fromWeb(upstream.body as never));
    },
  );

  /* ================= admin: queue ================= */

  app.get(
    '/admin/kyc/pending',
    { ...adminGuard, schema: { tags: ['admin'], summary: 'Identity verifications awaiting review', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const q = parse(listQuery, req.query);
      const where = q.status === 'all' ? {} : { status: q.status };
      const [total, rows, counts] = await Promise.all([
        prisma.kycVerification.count({ where }),
        prisma.kycVerification.findMany({
          where,
          orderBy: [{ status: 'asc' }, { updatedAt: q.status === 'pending' ? 'asc' : 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { user: { select: { id: true, fullName: true, email: true, role: true, avatarUrl: true } } },
        }),
        prisma.kycVerification.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          status: r.status,
          user: { id: r.user.id, fullName: r.user.fullName, email: r.user.email, role: r.user.role },
          documentType: r.documentType,
          documentTypeLabel: KYC_DOCUMENT_LABELS[r.documentType],
          idNumber: decryptIdNumber(r.idNumberEncrypted),
          idNumberMasked: maskIdNumber(decryptIdNumber(r.idNumberEncrypted)),
          submittedAt: r.updatedAt.toISOString(),
          firstSubmittedAt: r.createdAt.toISOString(),
          reviewedAt: r.reviewedAt?.toISOString() ?? null,
          rejectionReason: r.rejectionReason,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
        counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
        reasons: KYC_REJECTION_REASONS,
      };
    },
  );

  /* ================= admin: one case with signed URLs ================= */

  app.get<{ Params: { id: string } }>(
    '/admin/kyc/:id',
    { ...adminGuard, schema: { tags: ['admin'], summary: 'Identity verification details with short-lived file links', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const row = await prisma.kycVerification.findUnique({
        where: { id: req.params.id },
        include: {
          user: { select: { id: true, fullName: true, email: true, role: true, status: true, createdAt: true, emailVerifiedAt: true, avatarUrl: true, kycStatus: true, professionalProfile: { select: { title: true, locationCity: true, slug: true } } } },
          reviewedBy: { select: { id: true, fullName: true, email: true } },
        },
      });
      if (!row) throw notFound('NOT_FOUND', 'Verification not found.');
      const exp = Math.floor(Date.now() / 1000) + KYC_SIGNED_URL_TTL_SECONDS;
      const base = `${req.protocol}://${req.hostname}`;
      const urlFor = (key: string) => `${base}/api/v1/kyc/files/${key.split('/').pop()}?t=${signKycFileToken({ key, exp, by: req.auth!.sub })}`;
      await audit(prisma, { actorId: req.auth!.sub, action: 'kyc.viewed', entity: 'kyc_verification', entityId: row.id, ip: req.ip });
      return {
        id: row.id,
        status: row.status,
        documentType: row.documentType,
        documentTypeLabel: KYC_DOCUMENT_LABELS[row.documentType],
        idNumber: decryptIdNumber(row.idNumberEncrypted),
        dateOfBirth: row.dateOfBirth ? row.dateOfBirth.toISOString().slice(0, 10) : null,
        phone: row.phone,
        consentAt: row.consentAt.toISOString(),
        submittedAt: row.updatedAt.toISOString(),
        firstSubmittedAt: row.createdAt.toISOString(),
        rejectionReason: row.rejectionReason,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        reviewedBy: row.reviewedBy ? { id: row.reviewedBy.id, fullName: row.reviewedBy.fullName } : null,
        user: {
          id: row.user.id,
          fullName: row.user.fullName,
          email: row.user.email,
          role: row.user.role,
          status: row.user.status,
          kycStatus: row.user.kycStatus,
          emailVerified: Boolean(row.user.emailVerifiedAt),
          memberSince: row.user.createdAt.toISOString(),
          professional: row.user.professionalProfile ? { title: row.user.professionalProfile.title, location: row.user.professionalProfile.locationCity, slug: row.user.professionalProfile.slug } : null,
        },
        files: {
          document: { url: urlFor(row.documentFileKey), contentType: row.documentFileKey.endsWith('.pdf') ? 'application/pdf' : 'image/*' },
          selfie: { url: urlFor(row.selfieFileKey), contentType: 'image/*' },
          expiresAt: new Date(exp * 1000).toISOString(),
        },
        reasons: KYC_REJECTION_REASONS,
      };
    },
  );

  /* ================= admin: review ================= */

  app.post<{ Params: { id: string } }>(
    '/admin/kyc/:id/review',
    { ...adminGuard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['admin'], summary: 'Approve or reject an identity verification', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const body = parse(reviewSchema, req.body);
      const reason = body.rejectionReason?.trim() ?? '';
      if (body.action === 'reject' && reason.length < 3) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Give the person a reason so they can fix it.', { rejectionReason: 'Choose or type a reason.' });
      }
      const adminId = req.auth!.sub;
      const outcome = await prisma.$transaction(async (tx) => {
        const row = await tx.kycVerification.findUnique({ where: { id: req.params.id }, include: { user: { select: { id: true, email: true, fullName: true } } } });
        if (!row) throw notFound('NOT_FOUND', 'Verification not found.');
        if (row.status !== 'pending') throw new ApiError(409, 'KYC_ALREADY_REVIEWED', `This verification was already ${row.status}.`);
        if (row.userId === adminId) throw new ApiError(403, 'FORBIDDEN', 'You cannot review your own verification.');
        const approved = body.action === 'approve';
        const updated = await tx.kycVerification.update({
          where: { id: row.id },
          data: { status: approved ? 'approved' : 'rejected', rejectionReason: approved ? null : reason, reviewedById: adminId, reviewedAt: new Date() },
        });
        await tx.user.update({ where: { id: row.userId }, data: { kycStatus: approved ? 'verified' : 'rejected' } });
        await audit(tx, { actorId: adminId, action: approved ? 'kyc.approved' : 'kyc.rejected', entity: 'kyc_verification', entityId: row.id, data: approved ? {} : { reason }, ip: req.ip });
        await notify(tx, {
          userId: row.userId,
          type: approved ? 'kyc.approved' : 'kyc.rejected',
          title: approved ? 'Your identity is verified' : 'Identity verification not approved',
          body: approved ? 'Thanks — your documents checked out. Verified features are now open to you.' : `Reason: ${reason}. You can submit fresh documents from Identity verification.`,
          link: '/dashboard/identity',
        });
        return { updated, user: row.user, approved };
      });
      try {
        await enqueueMail(kycOutcomeMail(outcome.user.email, outcome.approved ? 'approved' : 'rejected', reason), `kyc-${outcome.updated.id}-${outcome.updated.reviewedAt?.getTime()}`);
      } catch (err) {
        req.log.error({ err }, 'kyc outcome mail not queued');
      }
      return { id: outcome.updated.id, status: outcome.updated.status, rejectionReason: outcome.updated.rejectionReason, reviewedAt: outcome.updated.reviewedAt?.toISOString() ?? null, userKycStatus: outcome.approved ? 'verified' : 'rejected' };
    },
  );
}
