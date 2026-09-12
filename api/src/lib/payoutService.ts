/**
 * SERVIX payouts (Phase E) — ledger-derived, idempotent, with failure
 * recovery that reverses the hold exactly once.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { ApiError } from './errors.js';
import { accountBalance, payoutLegs, payoutReversalLegs, postTransaction } from './ledger.js';
import { getPaymentProvider } from './payments.js';
import { enqueueMail } from './jobs.js';
import { payoutSentMail } from './mailer.js';

export async function requestPayout(professionalId: string) {
  const reference = `po-${randomUUID()}`;
  let payout;
  try {
    payout = await prisma.$transaction(async (tx) => {
      const payable = await accountBalance('professional_payable', professionalId, tx);
      if (payable <= 0n) {
        throw new ApiError(409, 'NOTHING_PAYABLE', 'No funds available for payout.');
      }
      const created = await tx.payout.create({
        data: { professionalId, reference, amountKobo: payable },
      });
      await postTransaction(tx, payoutLegs(payable, professionalId), {
        payoutId: created.id,
        memo: 'payout requested',
      });
      return created;
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      throw new ApiError(409, 'PAYOUT_IN_FLIGHT', 'A payout is already being processed.');
    }
    throw err;
  }

  return executeTransfer(payout.id);
}

/**
 * Execute (or re-execute) the provider transfer for a payout.
 * Idempotent: only acts while the payout is `processing`; a failed
 * transfer reverses the ledger hold EXACTLY ONCE (CAS on status).
 */
export async function executeTransfer(payoutId: string) {
  const payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
  if (payout.status !== 'processing') return payout; // replay no-op

  try {
    const transfer = await getPaymentProvider().transfer({
      reference: payout.reference,
      amountKobo: payout.amountKobo,
      recipientName: payout.professionalId,
    });
    if (transfer.status === 'failed') throw new Error('provider reported failure');
    const updated = await prisma.payout.update({
      where: { id: payoutId },
      data: { status: 'paid', providerRef: transfer.providerRef, paidAt: new Date() },
    });
    // Notify (async job; not on the request path)
    const profile = await prisma.professionalProfile.findUnique({
      where: { id: payout.professionalId },
      include: { user: true },
    });
    if (profile?.user) {
      await enqueueMail(
        payoutSentMail(profile.user.email, payout.reference, `₦${(payout.amountKobo / 100n).toLocaleString('en-NG')}`),
        `payout-mail-${payout.id}`,
      );
    }
    return updated;
  } catch {
    // Mark failed + reverse the hold exactly once (CAS guards the reversal).
    await prisma.$transaction(async (tx) => {
      const cas = await tx.payout.updateMany({
        where: { id: payoutId, status: 'processing' },
        data: { status: 'failed' },
      });
      if (cas.count === 1) {
        await postTransaction(tx, payoutReversalLegs(payout.amountKobo, payout.professionalId), {
          payoutId,
          memo: 'payout transfer failed — hold reversed',
        });
      }
    });
    throw new ApiError(502, 'TRANSFER_FAILED', 'The payout transfer failed. The balance has been restored.');
  }
}

/** Admin/job retry for a failed payout: creates a fresh payout attempt. */
export async function retryPayout(payoutId: string) {
  const failed = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
  if (failed.status !== 'failed') return failed; // idempotent
  // Idempotency: if a later payout already covers this professional's balance
  // (a previous retry succeeded), return it instead of creating another
  // attempt — a replayed retry must never duplicate a financial operation.
  const successor = await prisma.payout.findFirst({
    where: {
      professionalId: failed.professionalId,
      createdAt: { gt: failed.createdAt },
      status: { in: ['processing', 'paid'] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (successor) return successor;
  return requestPayout(failed.professionalId);
}
