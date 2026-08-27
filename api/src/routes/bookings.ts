/**
 * SERVIX Phase D — booking routes.
 * Customer + professional actions; every transition server-validated.
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAuth, requireProfessional } from '../lib/authGuard.js';
import { ApiError, forbidden, notFound } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import {
  assertSlotAvailable,
  availableSlots,
  bookingRef,
  cancelBooking,
  completeBooking,
  transition,
} from '../lib/bookingService.js';
import { platformFeeKobo, refundAmount } from '../lib/refundPolicy.js';
import { getPaymentProvider } from '../lib/payments.js';
import { postTransaction, refundLegs, releaseLegs } from '../lib/ledger.js';

const createSchema = z.object({
  serviceId: z.string().min(1), // public slug
  scheduledAt: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
});

const reasonSchema = z.object({ reason: z.string().trim().max(1000).optional() });
const disputeSchema = z.object({ reason: z.string().trim().min(10, 'Please describe the problem (at least 10 characters).').max(2000) });
const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().trim().max(2000).optional(),
});

function serializeBooking(b: {
  id: string;
  reference: string;
  status: string;
  scheduledAt: Date;
  amountKobo: bigint;
  platformFeeKobo: bigint;
  currency: string;
  serviceTitle: string;
  priceUnit: string;
  notes: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  disputeReason: string | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  autoConfirmed: boolean;
  createdAt: Date;
  service?: { slug: string } | null;
  professional?: { slug: string; name: string } | null;
  customer?: { fullName: string } | null;
  review?: { id: string } | null;
}) {
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    scheduledAt: b.scheduledAt.toISOString(),
    amount: Number(b.amountKobo / 100n),
    currency: b.currency,
    serviceTitle: b.serviceTitle,
    priceUnit: b.priceUnit,
    serviceId: b.service?.slug ?? null,
    professionalId: b.professional?.slug ?? null,
    professionalName: b.professional?.name ?? null,
    customerName: b.customer?.fullName ?? null,
    notes: b.notes ?? '',
    cancelledBy: b.cancelledBy,
    cancelReason: b.cancelReason,
    disputeReason: b.disputeReason,
    deliveredAt: b.deliveredAt?.toISOString() ?? null,
    completedAt: b.completedAt?.toISOString() ?? null,
    autoConfirmed: b.autoConfirmed,
    hasReview: Boolean(b.review),
    createdAt: b.createdAt.toISOString(),
  };
}

const includeAll = {
  service: { select: { slug: true } },
  professional: { select: { slug: true, name: true } },
  customer: { select: { fullName: true } },
  review: { select: { id: true } },
} as const;

async function ownBookingAsCustomer(id: string, userId: string) {
  const b = await prisma.booking.findUnique({ where: { id }, include: includeAll });
  if (!b) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
  if (b.customerId !== userId) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
  return b;
}

async function ownBookingAsPro(id: string, professionalProfileId: string) {
  const b = await prisma.booking.findUnique({ where: { id }, include: includeAll });
  if (!b) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
  if (b.professionalId !== professionalProfileId) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
  return b;
}

export async function bookingRoutes(app: FastifyInstance) {
  /* ============ public availability ============ */

  app.get(
    '/services/:slug/availability',
    { schema: { tags: ['bookings'], summary: 'Real bookable slots for a service' } },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const q = z.object({ days: z.coerce.number().int().min(1).max(30).default(14) }).parse(req.query ?? {});
      const service = await prisma.service.findFirst({ where: { slug, status: 'active' } });
      if (!service) throw notFound('SERVICE_NOT_FOUND', 'Service not found');
      const slots = await availableSlots(service.professionalId, q.days);
      return { slots: slots.map((s) => s.startsAt.toISOString()) };
    },
  );

  /* ============ customer: create + pay ============ */

  app.post(
    '/bookings',
    { preHandler: requireAuth, schema: { tags: ['bookings'], summary: 'Create a booking (pending payment)', security: [{ bearerAuth: [] }] } },
    async (req, reply) => {
      const data = parseBody(createSchema, req.body);
      const idempotencyKey = (req.headers['idempotency-key'] as string | undefined)?.slice(0, 100) ?? null;

      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });

      // Idempotent replay: return the existing booking.
      if (idempotencyKey) {
        const existing = await prisma.booking.findUnique({
          where: { customerId_idempotencyKey: { customerId: user.id, idempotencyKey } },
          include: includeAll,
        });
        if (existing) return reply.code(200).send(serializeBooking(existing));
      }

      const service = await prisma.service.findFirst({
        where: { slug: data.serviceId, status: 'active' },
        include: { professional: true },
      });
      if (!service) throw notFound('SERVICE_NOT_FOUND', 'Service not found');
      if (service.professional.userId === user.id) {
        throw new ApiError(409, 'OWN_SERVICE', 'You cannot book your own service.');
      }

      await assertSlotAvailable(service.professionalId, data.scheduledAt);

      // Immutable price snapshot — server-side only. Client price ignored.
      const amountKobo = service.price * 100n;
      const fee = platformFeeKobo(amountKobo);

      try {
        const booking = await prisma.booking.create({
          data: {
            reference: bookingRef(),
            customerId: user.id,
            professionalId: service.professionalId,
            serviceId: service.id,
            scheduledAt: data.scheduledAt,
            amountKobo,
            platformFeeKobo: fee,
            serviceTitle: service.title,
            priceUnit: service.priceUnit,
            notes: data.notes,
            idempotencyKey,
            events: { create: { actorId: user.id, event: 'created', data: {} } },
          },
          include: includeAll,
        });
        return reply.code(201).send(serializeBooking(booking));
      } catch (err) {
        // DB-level slot race (partial unique index) → friendly conflict.
        if ((err as { code?: string }).code === 'P2002') {
          throw new ApiError(409, 'SLOT_TAKEN', 'This time slot has just been booked.');
        }
        throw err;
      }
    },
  );

  app.post(
    '/bookings/:id/pay',
    { preHandler: requireAuth, schema: { tags: ['bookings'], summary: 'Initialize payment (idempotent)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const booking = await ownBookingAsCustomer(id, req.auth!.sub);
      if (booking.status !== 'pending_payment') {
        throw new ApiError(409, 'ALREADY_PAID', 'This booking does not need payment.');
      }

      // Idempotent: reuse the open payment if one exists.
      const open = await prisma.payment.findFirst({ where: { bookingId: id, status: 'initiated' } });
      const provider = getPaymentProvider();
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';

      if (open) {
        const init = await provider.initialize({
          reference: open.reference,
          amountKobo: open.amountKobo,
          email: user.email,
          callbackUrl: `${appBase}/bookings/${id}`,
        });
        return { authorizationUrl: init.authorizationUrl, reference: open.reference };
      }

      const reference = `pay-${randomUUID()}`;
      await prisma.payment.create({
        data: { bookingId: id, reference, amountKobo: booking.amountKobo, provider: provider.name },
      });
      const init = await provider.initialize({
        reference,
        amountKobo: booking.amountKobo,
        email: user.email,
        callbackUrl: `${appBase}/bookings/${id}`,
      });
      return { authorizationUrl: init.authorizationUrl, reference };
    },
  );

  /* ============ customer: list/read/act ============ */

  app.get(
    '/bookings',
    { preHandler: requireAuth, schema: { tags: ['bookings'], summary: 'List own bookings (customer)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const rows = await prisma.booking.findMany({
        where: { customerId: req.auth!.sub },
        include: includeAll,
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(serializeBooking);
    },
  );

  app.get(
    '/bookings/:id',
    { preHandler: requireAuth, schema: { tags: ['bookings'], summary: 'Get one of your bookings', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const booking = await prisma.booking.findUnique({ where: { id }, include: includeAll });
      if (!booking) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
      // Visible to its customer or its professional only.
      if (booking.customerId !== req.auth!.sub) {
        const profile = await prisma.professionalProfile.findUnique({ where: { userId: req.auth!.sub } });
        if (!profile || booking.professionalId !== profile.id) {
          throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
        }
      }
      return serializeBooking(booking);
    },
  );

  app.post(
    '/bookings/:id/cancel',
    { preHandler: requireAuth, schema: { tags: ['bookings'], summary: 'Cancel a booking (policy refund)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const { reason } = parseBody(reasonSchema, req.body ?? {});
      const booking = await ownBookingAsCustomer(id, req.auth!.sub);
      const updated = await cancelBooking(
        booking.id,
        req.auth!.sub,
        'customer',
        reason,
        ['pending_payment', 'requested', 'accepted'],
        'cancelled',
      );
      return serializeBooking({ ...updated, ...includeNulls() });
    },
  );

  app.post(
    '/bookings/:id/confirm',
    { preHandler: requireAuth, schema: { tags: ['bookings'], summary: 'Confirm completion (releases escrow)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      await ownBookingAsCustomer(id, req.auth!.sub);
      const updated = await completeBooking(id, req.auth!.sub, false);
      return serializeBooking({ ...updated, ...includeNulls() });
    },
  );

  app.post(
    '/bookings/:id/dispute',
    { preHandler: requireAuth, schema: { tags: ['bookings'], summary: 'Open a dispute (freezes funds)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const { reason } = parseBody(disputeSchema, req.body);
      await ownBookingAsCustomer(id, req.auth!.sub);
      const updated = await transition({
        bookingId: id,
        from: ['in_progress', 'delivered'],
        to: 'disputed',
        actorId: req.auth!.sub,
        event: 'disputed',
        data: { reason },
        extra: { disputeReason: reason, disputedAt: new Date() },
      });
      return serializeBooking({ ...updated, ...includeNulls() });
    },
  );

  /* ============ customer: review (completed bookings only) ============ */

  app.post(
    '/bookings/:id/review',
    { preHandler: requireAuth, schema: { tags: ['bookings'], summary: 'Review a completed booking', security: [{ bearerAuth: [] }] } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const data = parseBody(reviewSchema, req.body);
      const booking = await ownBookingAsCustomer(id, req.auth!.sub);
      if (booking.status !== 'completed') {
        throw new ApiError(409, 'NOT_REVIEWABLE', 'Only completed bookings can be reviewed.');
      }
      if (booking.review) {
        throw new ApiError(409, 'ALREADY_REVIEWED', 'You have already reviewed this booking.');
      }
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });

      try {
        const review = await prisma.$transaction(async (tx) => {
          // Service/professional derive from the booking — never the client.
          const created = await tx.review.create({
            data: {
              bookingId: booking.id,
              serviceId: booking.serviceId,
              professionalId: booking.professionalId,
              author: user.fullName,
              rating: data.rating,
              text: data.text,
              reviewedAt: new Date(),
            },
          });
          // Recompute aggregates from published reviews.
          for (const scope of ['service', 'professional'] as const) {
            const where = scope === 'service' ? { serviceId: booking.serviceId } : { professionalId: booking.professionalId };
            const agg = await tx.review.aggregate({
              where: { ...where, isPublished: true },
              _avg: { rating: true },
              _count: true,
            });
            const patch = {
              ratingAvg: Number((agg._avg.rating ?? 0).toFixed(2)),
              reviewCount: agg._count,
            };
            if (scope === 'service') await tx.service.update({ where: { id: booking.serviceId }, data: patch });
            else await tx.professionalProfile.update({ where: { id: booking.professionalId }, data: patch });
          }
          return created;
        });
        return reply.code(201).send({ id: review.id, rating: review.rating, text: review.text ?? '' });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          throw new ApiError(409, 'ALREADY_REVIEWED', 'You have already reviewed this booking.');
        }
        throw err;
      }
    },
  );

  /* ============ professional: manage bookings ============ */

  app.get(
    '/pro/bookings',
    { preHandler: requireProfessional, schema: { tags: ['bookings'], summary: 'List bookings on your services', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const rows = await prisma.booking.findMany({
        where: { professionalId: req.professionalProfileId!, status: { not: 'pending_payment' } },
        include: includeAll,
        orderBy: { scheduledAt: 'asc' },
      });
      return rows.map(serializeBooking);
    },
  );

  const proAction = (
    path: string,
    summary: string,
    from: string[],
    to: string,
    event: string,
    extra?: Record<string, unknown>,
  ) => {
    app.post(
      `/pro/bookings/:id/${path}`,
      { preHandler: requireProfessional, schema: { tags: ['bookings'], summary, security: [{ bearerAuth: [] }] } },
      async (req) => {
        const { id } = req.params as { id: string };
        await ownBookingAsPro(id, req.professionalProfileId!);
        const updated = await transition({
          bookingId: id,
          from: from as never,
          to: to as never,
          actorId: req.auth!.sub,
          event,
          extra: typeof extra === 'function' ? (extra as () => Record<string, unknown>)() : extra,
        });
        return serializeBooking({ ...updated, ...includeNulls() });
      },
    );
  };

  proAction('accept', 'Accept a booking request', ['requested'], 'accepted', 'accepted');
  proAction('start', 'Start work', ['accepted'], 'in_progress', 'work_started');

  app.post(
    '/pro/bookings/:id/deliver',
    { preHandler: requireProfessional, schema: { tags: ['bookings'], summary: 'Mark work delivered', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      await ownBookingAsPro(id, req.professionalProfileId!);
      const updated = await transition({
        bookingId: id,
        from: ['in_progress'],
        to: 'delivered',
        actorId: req.auth!.sub,
        event: 'delivered',
        extra: { deliveredAt: new Date() },
      });
      return serializeBooking({ ...updated, ...includeNulls() });
    },
  );

  app.post(
    '/pro/bookings/:id/decline',
    { preHandler: requireProfessional, schema: { tags: ['bookings'], summary: 'Decline a booking request (full refund)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const { reason } = parseBody(reasonSchema, req.body ?? {});
      await ownBookingAsPro(id, req.professionalProfileId!);
      const updated = await cancelBooking(id, req.auth!.sub, 'professional', reason, ['requested'], 'declined');
      return serializeBooking({ ...updated, ...includeNulls() });
    },
  );

  app.post(
    '/pro/bookings/:id/cancel',
    { preHandler: requireProfessional, schema: { tags: ['bookings'], summary: 'Cancel as professional (full refund)', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const { id } = req.params as { id: string };
      const { reason } = parseBody(reasonSchema, req.body ?? {});
      await ownBookingAsPro(id, req.professionalProfileId!);
      const updated = await cancelBooking(
        id,
        req.auth!.sub,
        'professional',
        reason,
        ['requested', 'accepted', 'in_progress'],
        'cancelled',
      );
      return serializeBooking({ ...updated, ...includeNulls() });
    },
  );

  /* ============ internal: dispute resolution (Phase E dashboard later) ============ */

  app.post('/bookings/:id/resolve', { schema: { hide: true } }, async (req) => {
    const key = req.headers['x-servix-review-key'];
    if (!key || key !== (process.env.SERVIX_REVIEW_KEY ?? 'dev-review-key')) {
      throw forbidden('Resolution access denied.');
    }
    const { id } = req.params as { id: string };
    const body = parseBody(
      z.object({ decision: z.enum(['release', 'refund']), note: z.string().max(1000).optional() }),
      req.body,
    );
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');

    if (body.decision === 'release') {
      const updated = await transition({
        bookingId: id,
        from: ['disputed'],
        to: 'completed',
        actorId: null,
        event: 'dispute_released',
        data: { note: body.note ?? null },
        extra: { completedAt: new Date() },
        sideEffects: async (tx) => {
          await postTransaction(tx, releaseLegs(booking.amountKobo, booking.platformFeeKobo, booking.professionalId), {
            bookingId: id,
            memo: 'dispute resolved: release',
          });
        },
      });
      return serializeBooking({ ...updated, ...includeNulls() });
    }

    const refund = refundAmount(booking.amountKobo, 100);
    const updated = await transition({
      bookingId: id,
      from: ['disputed'],
      to: 'refunded',
      actorId: null,
      event: 'dispute_refunded',
      data: { note: body.note ?? null },
      sideEffects: async (tx) => {
        await postTransaction(tx, refundLegs(refund), { bookingId: id, memo: 'dispute resolved: refund' });
        await tx.payment.updateMany({ where: { bookingId: id, status: 'captured' }, data: { status: 'refunded' } });
      },
    });
    return serializeBooking({ ...updated, ...includeNulls() });
  });
}

function includeNulls() {
  return { service: null, professional: null, customer: null, review: null };
}
