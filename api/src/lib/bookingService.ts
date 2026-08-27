/**
 * SERVIX booking domain service (Phase D).
 * All state transitions are compare-and-swap inside DB transactions;
 * financial effects post to the ledger in the same transaction.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { ApiError } from './errors.js';
import { captureLegs, postTransaction, refundLegs, releaseLegs } from './ledger.js';
import { platformFeeKobo, refundAmount, refundForCancellation } from './refundPolicy.js';
import type { BookingStatus } from '../generated/prisma/enums.js';

export const ACTIVE_SLOT_STATUSES: BookingStatus[] = [
  'pending_payment',
  'requested',
  'accepted',
  'in_progress',
  'delivered',
  'disputed',
];

export const bookingRef = () =>
  `SVX-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;

/* ---------------- availability ---------------- */

export interface Slot {
  startsAt: Date;
}

const DEFAULT_RULES = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startHour: 9, endHour: 17 }));

/** Compute bookable 1-hour slots for a professional over the next N days. */
export async function availableSlots(professionalId: string, days: number): Promise<Slot[]> {
  const rules = await prisma.availabilityRule.findMany({ where: { professionalId } });
  const effective = rules.length ? rules : DEFAULT_RULES;
  const byWeekday = new Map(effective.map((r) => [r.weekday, r]));

  const from = new Date();
  const to = new Date(from.getTime() + days * 86_400_000);

  const exceptions = await prisma.availabilityException.findMany({
    where: { professionalId, date: { gte: new Date(from.toDateString()), lte: to } },
  });
  const closedDays = new Set(exceptions.map((e) => e.date.toISOString().slice(0, 10)));

  const taken = await prisma.booking.findMany({
    where: {
      professionalId,
      status: { in: ACTIVE_SLOT_STATUSES },
      scheduledAt: { gte: from, lte: to },
    },
    select: { scheduledAt: true },
  });
  const takenSet = new Set(taken.map((b) => b.scheduledAt.getTime()));

  const slots: Slot[] = [];
  for (let d = 0; d <= days; d += 1) {
    const day = new Date(from);
    day.setDate(from.getDate() + d);
    day.setMinutes(0, 0, 0);
    const dayKey = day.toISOString().slice(0, 10);
    if (closedDays.has(dayKey)) continue;
    const rule = byWeekday.get(day.getDay());
    if (!rule) continue;
    for (let h = rule.startHour; h < rule.endHour; h += 1) {
      const slot = new Date(day);
      slot.setHours(h, 0, 0, 0);
      if (slot <= from) continue;
      if (takenSet.has(slot.getTime())) continue;
      slots.push({ startsAt: slot });
    }
  }
  return slots;
}

/** Server-side conflict + availability check for one specific slot. */
export async function assertSlotAvailable(professionalId: string, at: Date): Promise<void> {
  if (at.getMinutes() !== 0 || at.getSeconds() !== 0 || at.getMilliseconds() !== 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Bookings start on the hour.');
  }
  if (at <= new Date()) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'The selected time is in the past.');
  }
  const rules = await prisma.availabilityRule.findMany({ where: { professionalId } });
  const effective = rules.length ? rules : DEFAULT_RULES;
  const rule = effective.find((r) => r.weekday === at.getDay());
  const hour = at.getHours();
  if (!rule || hour < rule.startHour || hour >= rule.endHour) {
    throw new ApiError(409, 'SLOT_UNAVAILABLE', 'The professional is not available at this time.');
  }
  const dayStart = new Date(at.toDateString());
  const exception = await prisma.availabilityException.findFirst({
    where: { professionalId, date: dayStart },
  });
  if (exception) {
    throw new ApiError(409, 'SLOT_UNAVAILABLE', 'The professional is unavailable on this date.');
  }
  const clash = await prisma.booking.findFirst({
    where: { professionalId, scheduledAt: at, status: { in: ACTIVE_SLOT_STATUSES } },
  });
  if (clash) throw new ApiError(409, 'SLOT_TAKEN', 'This time slot has just been booked.');
}

/* ---------------- transitions (CAS) ---------------- */

interface TransitionOpts {
  bookingId: string;
  from: BookingStatus[];
  to: BookingStatus;
  actorId: string | null;
  event: string;
  data?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  /** Runs inside the same transaction AFTER a successful CAS. */
  sideEffects?: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>;
}

/**
 * Compare-and-swap transition. Throws 409 CONFLICT if the booking is not
 * in one of the expected `from` states (covers races: two simultaneous
 * requests — one wins, the other gets 409).
 */
export async function transition(opts: TransitionOpts) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.booking.updateMany({
      where: { id: opts.bookingId, status: { in: opts.from } },
      data: { status: opts.to, ...(opts.extra ?? {}) },
    });
    if (result.count === 0) {
      throw new ApiError(409, 'INVALID_TRANSITION', 'This booking is not in a state that allows that action.');
    }
    await tx.bookingEvent.create({
      data: {
        bookingId: opts.bookingId,
        actorId: opts.actorId,
        event: opts.event,
        data: (opts.data ?? {}) as object,
      },
    });
    if (opts.sideEffects) await opts.sideEffects(tx);
    return tx.booking.findUniqueOrThrow({ where: { id: opts.bookingId } });
  });
}

/* ---------------- financial transitions ---------------- */

/** Escrow release on completion (confirm or auto-confirm). */
export async function completeBooking(bookingId: string, actorId: string | null, auto: boolean) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  return transition({
    bookingId,
    from: ['delivered'],
    to: 'completed',
    actorId,
    event: auto ? 'auto_confirmed' : 'confirmed',
    data: { auto },
    extra: { completedAt: new Date(), autoConfirmed: auto },
    sideEffects: async (tx) => {
      await postTransaction(
        tx,
        releaseLegs(booking.amountKobo, booking.platformFeeKobo, booking.professionalId),
        { bookingId, memo: auto ? 'auto-confirm release' : 'customer confirm release' },
      );
    },
  });
}

/** Cancellation/decline with policy-driven refund. */
export async function cancelBooking(
  bookingId: string,
  actorId: string,
  cancelledBy: 'customer' | 'professional',
  reason: string | undefined,
  from: BookingStatus[],
  toStatus: 'cancelled' | 'declined',
) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const decision = refundForCancellation(booking.status, cancelledBy);
  if (!decision.allowed) {
    throw new ApiError(409, 'NOT_CANCELLABLE', 'This booking can no longer be cancelled. Open a dispute instead.');
  }
  const captured = booking.status !== 'pending_payment';
  const refund = captured ? refundAmount(booking.amountKobo, decision.percent) : 0n;

  return transition({
    bookingId,
    from,
    to: toStatus,
    actorId,
    event: toStatus === 'declined' ? 'declined' : 'cancelled',
    data: { cancelledBy, reason: reason ?? null, refundKobo: refund.toString(), policy: decision.reason },
    extra: { cancelledBy, cancelReason: reason ?? null },
    sideEffects: async (tx) => {
      if (refund > 0n) {
        await postTransaction(tx, refundLegs(refund), {
          bookingId,
          memo: `refund ${decision.percent}% (${decision.reason})`,
        });
        await tx.payment.updateMany({
          where: { bookingId, status: 'captured' },
          data: { status: 'refunded' },
        });
      }
    },
  });
}

/** Webhook-driven capture: payment verified → escrow + requested. */
export async function capturePayment(paymentId: string, bookingId: string, amountKobo: bigint) {
  return prisma.$transaction(async (tx) => {
    const pay = await tx.payment.updateMany({
      where: { id: paymentId, status: 'initiated' },
      data: { status: 'captured', verifiedAt: new Date() },
    });
    if (pay.count === 0) return null; // duplicate/out-of-order event — no-op
    const book = await tx.booking.updateMany({
      where: { id: bookingId, status: 'pending_payment' },
      data: { status: 'requested' },
    });
    if (book.count === 0) {
      throw new Error('Payment captured for a booking not awaiting payment');
    }
    await tx.bookingEvent.create({
      data: { bookingId, actorId: null, event: 'payment_captured', data: { amountKobo: amountKobo.toString() } },
    });
    await postTransaction(tx, captureLegs(amountKobo), {
      bookingId,
      paymentId,
      memo: 'verified payment capture',
    });
    return tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  });
}

/* ---------------- auto-confirm sweep ---------------- */

const CONFIRM_WINDOW_MS = Number(process.env.CONFIRM_WINDOW_DAYS ?? 3) * 86_400_000;

/** Complete every delivered booking older than the confirmation window. */
export async function runAutoConfirmSweep(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CONFIRM_WINDOW_MS);
  const due = await prisma.booking.findMany({
    where: { status: 'delivered', deliveredAt: { lte: cutoff } },
    select: { id: true },
  });
  let done = 0;
  for (const b of due) {
    try {
      await completeBooking(b.id, null, true);
      done += 1;
    } catch {
      // CAS lost (e.g. disputed in the meantime) — correctly skipped.
    }
  }
  return done;
}
