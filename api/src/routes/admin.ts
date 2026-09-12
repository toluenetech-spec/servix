/**
 * SERVIX Phase E — administration.
 *
 * Replaces the X-Servix-Review-Key bridge with real authenticated admin
 * access. Authorization is SERVER-SIDE ONLY: `requireAdmin` re-reads the
 * role from the database on every request — a forged JWT role claim, a
 * suspended admin or a deleted account are all rejected. Every mutation
 * writes an audit_log row inside the same DB transaction.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAdmin } from '../lib/authGuard.js';
import { ApiError, notFound } from '../lib/errors.js';
import { parseBody, parseQuery, paginationSchema } from '../lib/query.js';
import { audit } from '../lib/audit.js';
import { serializeUser } from '../lib/serialize.js';
import { serializeApplication, slugify } from './applications.js';
import { transition } from '../lib/bookingService.js';
import { postTransaction, refundLegs, releaseLegs } from '../lib/ledger.js';
import { refundAmount } from '../lib/refundPolicy.js';
import { retryPayout } from '../lib/payoutService.js';
import { enqueueMail } from '../lib/jobs.js';
import { disputeResolvedMail } from '../lib/mailer.js';

export async function adminRoutes(app: FastifyInstance) {
  const guard = { preHandler: requireAdmin };
  const adminLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };

  /* ================= overview ================= */

  app.get('/admin/stats', { ...guard, schema: { tags: ['admin'], summary: 'Operational counters', security: [{ bearerAuth: [] }] } }, async () => {
    const [users, professionals, pendingApplications, activeServices, bookings, openDisputes, failedPayouts, deadJobs] =
      await prisma.$transaction([
        prisma.user.count({ where: { deletedAt: null } }),
        prisma.professionalProfile.count(),
        prisma.professionalApplication.count({ where: { status: 'under_review' } }),
        prisma.service.count({ where: { status: 'active' } }),
        prisma.booking.count(),
        prisma.booking.count({ where: { status: 'disputed' } }),
        prisma.payout.count({ where: { status: 'failed' } }),
        prisma.job.count({ where: { status: 'dead' } }),
      ]);
    return { users, professionals, pendingApplications, activeServices, bookings, openDisputes, failedPayouts, deadJobs };
  });

  /* ================= application review ================= */

  app.get(
    '/admin/applications',
    { ...guard, schema: { tags: ['admin'], summary: 'List applications by status', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const q = parseQuery(
        paginationSchema.extend({ status: z.enum(['pending', 'under_review', 'approved', 'rejected']).optional() }),
        req.query,
      );
      const where = q.status ? { status: q.status } : {};
      const [total, rows] = await prisma.$transaction([
        prisma.professionalApplication.count({ where }),
        prisma.professionalApplication.findMany({
          where,
          include: { user: { select: { email: true, fullName: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: rows.map((a) => ({ ...serializeApplication(a), applicant: a.user.fullName, email: a.user.email })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );

  app.post(
    '/admin/applications/:id/approve',
    { ...guard, config: adminLimit, schema: { tags: ['admin'], summary: 'Approve an application (promotes role, creates profile)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const application = await prisma.professionalApplication.findUnique({
        where: { id },
        include: { user: true },
      });
      if (!application) throw notFound('APPLICATION_NOT_FOUND', 'No application found.');
      if (application.status !== 'under_review') {
        throw new ApiError(409, 'INVALID_TRANSITION', 'Only submitted applications can be reviewed.');
      }
      const category = application.categorySlug
        ? await prisma.category.findUnique({ where: { slug: application.categorySlug } })
        : null;
      const base = slugify(application.user.fullName) || `pro-${application.userId.slice(0, 8)}`;
      let slug = base;
      for (let i = 2; await prisma.professionalProfile.findUnique({ where: { slug } }); i += 1) {
        slug = `${base}-${i}`;
      }
      const skills = (application.skills as string[]) ?? [];
      const portfolio = (application.portfolio as { title: string; category?: string }[]) ?? [];

      const updated = await prisma.$transaction(async (tx) => {
        const app2 = await tx.professionalApplication.update({
          where: { id },
          data: { status: 'approved', reviewedAt: new Date() },
        });
        await tx.user.update({ where: { id: application.userId }, data: { role: 'professional' } });
        await tx.professionalProfile.create({
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
              create: portfolio.map((item, i) => ({ title: item.title, category: item.category, position: i })),
            },
          },
        });
        await audit(tx, {
          actorId: req.auth!.sub,
          action: 'application.approve',
          entity: 'professional_application',
          entityId: id,
          data: { userId: application.userId, slug },
          ip: req.ip,
        });
        return app2;
      });
      return serializeApplication(updated);
    },
  );

  app.post(
    '/admin/applications/:id/reject',
    { ...guard, config: adminLimit, schema: { tags: ['admin'], summary: 'Reject an application', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = parseBody(z.object({ reason: z.string().trim().max(1000).optional() }), req.body ?? {});
      const application = await prisma.professionalApplication.findUnique({ where: { id } });
      if (!application) throw notFound('APPLICATION_NOT_FOUND', 'No application found.');
      if (application.status !== 'under_review') {
        throw new ApiError(409, 'INVALID_TRANSITION', 'Only submitted applications can be reviewed.');
      }
      const updated = await prisma.$transaction(async (tx) => {
        const app2 = await tx.professionalApplication.update({
          where: { id },
          data: { status: 'rejected', reviewedAt: new Date(), rejectionReason: body.reason ?? null },
        });
        await audit(tx, {
          actorId: req.auth!.sub,
          action: 'application.reject',
          entity: 'professional_application',
          entityId: id,
          data: { reason: body.reason ?? null },
          ip: req.ip,
        });
        return app2;
      });
      return serializeApplication(updated);
    },
  );

  /* ================= service moderation ================= */

  app.get(
    '/admin/services',
    { ...guard, schema: { tags: ['admin'], summary: 'List services incl. drafts/paused', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const q = parseQuery(
        paginationSchema.extend({ status: z.enum(['draft', 'pending_review', 'active', 'paused', 'archived']).optional() }),
        req.query,
      );
      const where = q.status ? { status: q.status } : {};
      const [total, rows] = await prisma.$transaction([
        prisma.service.count({ where }),
        prisma.service.findMany({
          where,
          include: { professional: { select: { name: true, slug: true } } },
          orderBy: { updatedAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: rows.map((s) => ({
          id: s.slug,
          title: s.title,
          status: s.status,
          price: Number(s.price),
          professional: s.professional.name,
          professionalId: s.professional.slug,
          updatedAt: s.updatedAt.toISOString(),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );

  const moderateService = (path: 'pause' | 'unpause', from: 'active' | 'paused', to: 'paused' | 'active') => {
    app.post(
      `/admin/services/:slug/${path}`,
      { ...guard, config: adminLimit, schema: { tags: ['admin'], summary: `Moderation: ${path} a service`, security: [{ bearerAuth: [] }] } },
      async (req) => {
        const { slug } = req.params as { slug: string };
        const updated = await prisma.$transaction(async (tx) => {
          const cas = await tx.service.updateMany({ where: { slug, status: from }, data: { status: to } });
          if (cas.count === 0) throw new ApiError(409, 'INVALID_TRANSITION', `Service is not ${from}.`);
          await audit(tx, {
            actorId: req.auth!.sub,
            action: `service.${path}`,
            entity: 'service',
            entityId: slug,
            ip: req.ip,
          });
          return tx.service.findUniqueOrThrow({ where: { slug } });
        });
        return { id: updated.slug, status: updated.status };
      },
    );
  };
  moderateService('pause', 'active', 'paused');
  moderateService('unpause', 'paused', 'active');

  /* ================= user management ================= */

  app.get(
    '/admin/users',
    { ...guard, schema: { tags: ['admin'], summary: 'List/search users', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const q = parseQuery(paginationSchema.extend({ q: z.string().trim().max(200).optional() }), req.query);
      const where = q.q
        ? {
            OR: [
              { email: { contains: q.q, mode: 'insensitive' as const } },
              { fullName: { contains: q.q, mode: 'insensitive' as const } },
            ],
          }
        : {};
      const [total, rows] = await prisma.$transaction([
        prisma.user.count({ where }),
        prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]);
      return { items: rows.map(serializeUser), total, page: q.page, pageSize: q.pageSize };
    },
  );

  const setUserStatus = (path: 'suspend' | 'reinstate', to: 'suspended' | 'active') => {
    app.post(
      `/admin/users/:id/${path}`,
      { ...guard, config: adminLimit, schema: { tags: ['admin'], summary: `${path} a user`, security: [{ bearerAuth: [] }] } },
      async (req) => {
        const { id } = req.params as { id: string };
        if (id === req.auth!.sub) throw new ApiError(409, 'SELF_ACTION', 'You cannot change your own status.');
        const target = await prisma.user.findUnique({ where: { id } });
        if (!target) throw notFound('USER_NOT_FOUND', 'User not found');
        if (target.role === 'admin') throw new ApiError(409, 'ADMIN_PROTECTED', 'Admins cannot be suspended here.');
        const updated = await prisma.$transaction(async (tx) => {
          const u = await tx.user.update({ where: { id }, data: { status: to } });
          if (to === 'suspended') {
            await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
          }
          await audit(tx, { actorId: req.auth!.sub, action: `user.${path}`, entity: 'user', entityId: id, ip: req.ip });
          return u;
        });
        return serializeUser(updated);
      },
    );
  };
  setUserStatus('suspend', 'suspended');
  setUserStatus('reinstate', 'active');

  /* ================= booking monitoring & disputes ================= */

  app.get(
    '/admin/bookings',
    { ...guard, schema: { tags: ['admin'], summary: 'List bookings (filterable)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const q = parseQuery(
        paginationSchema.extend({
          status: z
            .enum(['pending_payment', 'requested', 'accepted', 'in_progress', 'delivered', 'completed', 'declined', 'cancelled', 'disputed', 'refunded'])
            .optional(),
        }),
        req.query,
      );
      const where = q.status ? { status: q.status } : {};
      const [total, rows] = await prisma.$transaction([
        prisma.booking.count({ where }),
        prisma.booking.findMany({
          where,
          include: {
            customer: { select: { fullName: true, email: true } },
            professional: { select: { name: true } },
          },
          orderBy: { updatedAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: rows.map((b) => ({
          id: b.id,
          reference: b.reference,
          status: b.status,
          serviceTitle: b.serviceTitle,
          amount: Number(b.amountKobo / 100n),
          customer: b.customer.fullName,
          professional: b.professional.name,
          scheduledAt: b.scheduledAt.toISOString(),
          disputeReason: b.disputeReason,
          updatedAt: b.updatedAt.toISOString(),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );

  app.get(
    '/admin/bookings/:id',
    { ...guard, schema: { tags: ['admin'], summary: 'Booking detail incl. event timeline', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const b = await prisma.booking.findUnique({
        where: { id },
        include: {
          customer: { select: { fullName: true, email: true } },
          professional: { select: { name: true } },
          events: { orderBy: { createdAt: 'asc' } },
          payments: true,
        },
      });
      if (!b) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
      return {
        id: b.id,
        reference: b.reference,
        status: b.status,
        serviceTitle: b.serviceTitle,
        amount: Number(b.amountKobo / 100n),
        customer: b.customer.fullName,
        customerEmail: b.customer.email,
        professional: b.professional.name,
        disputeReason: b.disputeReason,
        events: b.events.map((e) => ({ event: e.event, at: e.createdAt.toISOString(), data: e.data })),
        payments: b.payments.map((p) => ({ reference: p.reference, status: p.status, amount: Number(p.amountKobo / 100n) })),
      };
    },
  );

  app.post(
    '/admin/bookings/:id/resolve',
    { ...guard, config: adminLimit, schema: { tags: ['admin'], summary: 'Resolve a dispute (release or refund)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = parseBody(
        z.object({ decision: z.enum(['release', 'refund']), note: z.string().max(1000).optional() }),
        req.body,
      );
      const booking = await prisma.booking.findUnique({
        where: { id },
        include: { customer: { select: { email: true } } },
      });
      if (!booking) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');

      let updated;
      if (body.decision === 'release') {
        updated = await transition({
          bookingId: id,
          from: ['disputed'],
          to: 'completed',
          actorId: req.auth!.sub,
          event: 'dispute_released',
          data: { note: body.note ?? null },
          extra: { completedAt: new Date() },
          sideEffects: async (tx) => {
            await postTransaction(tx, releaseLegs(booking.amountKobo, booking.platformFeeKobo, booking.professionalId), {
              bookingId: id,
              memo: 'dispute resolved: release',
            });
            await audit(tx, { actorId: req.auth!.sub, action: 'dispute.release', entity: 'booking', entityId: id, data: { note: body.note ?? null }, ip: req.ip });
          },
        });
      } else {
        const refund = refundAmount(booking.amountKobo, 100);
        updated = await transition({
          bookingId: id,
          from: ['disputed'],
          to: 'refunded',
          actorId: req.auth!.sub,
          event: 'dispute_refunded',
          data: { note: body.note ?? null },
          sideEffects: async (tx) => {
            await postTransaction(tx, refundLegs(refund), { bookingId: id, memo: 'dispute resolved: refund' });
            await tx.payment.updateMany({ where: { bookingId: id, status: 'captured' }, data: { status: 'refunded' } });
            await audit(tx, { actorId: req.auth!.sub, action: 'dispute.refund', entity: 'booking', entityId: id, data: { note: body.note ?? null }, ip: req.ip });
          },
        });
      }
      await enqueueMail(
        disputeResolvedMail(booking.customer.email, booking.reference, body.decision === 'release' ? 'released' : 'refunded'),
        `dispute-resolved-${id}`,
      );
      return { id: updated.id, status: updated.status };
    },
  );

  /* ================= payouts ================= */

  app.get(
    '/admin/payouts',
    { ...guard, schema: { tags: ['admin'], summary: 'List payouts', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const q = parseQuery(paginationSchema.extend({ status: z.enum(['processing', 'paid', 'failed']).optional() }), req.query);
      const where = q.status ? { status: q.status } : {};
      const [total, rows] = await prisma.$transaction([
        prisma.payout.count({ where }),
        prisma.payout.findMany({
          where,
          include: { professional: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: rows.map((p) => ({
          id: p.id,
          reference: p.reference,
          amount: Number(p.amountKobo / 100n),
          status: p.status,
          providerRef: p.providerRef,
          professional: p.professional.name,
          createdAt: p.createdAt.toISOString(),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );

  app.post(
    '/admin/payouts/:id/retry',
    { ...guard, config: adminLimit, schema: { tags: ['admin'], summary: 'Retry a failed payout', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const result = await retryPayout(id);
      await audit(prisma, { actorId: req.auth!.sub, action: 'payout.retry', entity: 'payout', entityId: id, ip: req.ip });
      return { id: result.id, status: result.status, reference: result.reference };
    },
  );

  /* ================= audit log ================= */

  app.get(
    '/admin/audit',
    { ...guard, schema: { tags: ['admin'], summary: 'Audit log (read-only)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const q = parseQuery(paginationSchema.extend({ entity: z.string().trim().max(60).optional() }), req.query);
      const where = q.entity ? { entity: q.entity } : {};
      const [total, rows] = await prisma.$transaction([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          include: { actor: { select: { email: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          actor: r.actor?.email ?? 'system',
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          data: r.data,
          ip: r.ip,
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );
}
