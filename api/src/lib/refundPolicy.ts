/**
 * SERVIX refund policy (Phase D) — the single source of refund rules.
 * The client NEVER supplies a refund amount; controllers ask this module.
 * Percentages are configurable via env so business rules live here only.
 */
import type { BookingStatus } from '../generated/prisma/enums.js';

export interface RefundDecision {
  allowed: boolean;
  /** Percent of the captured amount to refund (0–100). */
  percent: number;
  reason: string;
}

const beforeWorkPct = () => {
  const v = Number(process.env.REFUND_BEFORE_WORK_PCT ?? 100);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 100;
};

export function refundForCancellation(
  status: BookingStatus,
  cancelledBy: 'customer' | 'professional',
): RefundDecision {
  // Professional-initiated cancellation or decline → always full refund.
  if (cancelledBy === 'professional') {
    return { allowed: true, percent: 100, reason: 'professional_cancelled' };
  }
  switch (status) {
    case 'pending_payment':
      return { allowed: true, percent: 0, reason: 'nothing_captured' };
    case 'requested':
      return { allowed: true, percent: 100, reason: 'before_acceptance' };
    case 'accepted':
      return { allowed: true, percent: beforeWorkPct(), reason: 'before_work_began' };
    case 'in_progress':
    case 'delivered':
      // No unilateral customer cancellation once work has begun —
      // the dispute flow decides.
      return { allowed: false, percent: 0, reason: 'work_in_progress_use_dispute' };
    default:
      return { allowed: false, percent: 0, reason: 'not_cancellable' };
  }
}

/** Amount in kobo for a given percentage — integer arithmetic only. */
export function refundAmount(capturedKobo: bigint, percent: number): bigint {
  return (capturedKobo * BigInt(Math.round(percent))) / 100n;
}

export function platformFeeKobo(amountKobo: bigint): bigint {
  const pct = Number(process.env.PLATFORM_FEE_PCT ?? 10);
  const safe = Number.isFinite(pct) ? Math.min(50, Math.max(0, pct)) : 10;
  return (amountKobo * BigInt(Math.round(safe))) / 100n;
}
