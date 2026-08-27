/**
 * SERVIX double-entry ledger (Phase D).
 * Append-only. Every transaction balances (Σ debits = Σ credits).
 * All amounts are BigInt kobo. Balances are ALWAYS derived from entries.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from './db.js';

type Tx = Prisma.TransactionClient;

export interface Leg {
  account: 'provider_cash' | 'customer_escrow' | 'professional_payable' | 'platform_revenue' | 'refunds_paid';
  direction: 'debit' | 'credit';
  amountKobo: bigint;
  subjectId?: string; // professional id for professional_payable legs
}

export interface LedgerRefs {
  bookingId?: string;
  paymentId?: string;
  payoutId?: string;
  memo?: string;
}

/** Post a balanced transaction. Throws if legs don't balance. */
export async function postTransaction(tx: Tx, legs: Leg[], refs: LedgerRefs): Promise<string> {
  const debits = legs.filter((l) => l.direction === 'debit').reduce((a, l) => a + l.amountKobo, 0n);
  const credits = legs.filter((l) => l.direction === 'credit').reduce((a, l) => a + l.amountKobo, 0n);
  if (debits !== credits) {
    throw new Error(`Unbalanced ledger transaction: debits=${debits} credits=${credits}`);
  }
  if (legs.some((l) => l.amountKobo <= 0n)) {
    throw new Error('Ledger amounts must be positive');
  }
  const txnId = randomUUID();
  await tx.ledgerEntry.createMany({
    data: legs.map((l) => ({
      txnId,
      account: l.account,
      direction: l.direction,
      amountKobo: l.amountKobo,
      subjectId: l.subjectId,
      bookingId: refs.bookingId,
      paymentId: refs.paymentId,
      payoutId: refs.payoutId,
      memo: refs.memo,
    })),
  });
  return txnId;
}

/** Balance of an account (credits − debits), optionally per subject. */
export async function accountBalance(
  account: Leg['account'],
  subjectId?: string,
  tx: Tx | typeof prisma = prisma,
): Promise<bigint> {
  const rows = await tx.ledgerEntry.groupBy({
    by: ['direction'],
    where: { account, ...(subjectId ? { subjectId } : {}) },
    _sum: { amountKobo: true },
  });
  let credits = 0n;
  let debits = 0n;
  for (const r of rows) {
    if (r.direction === 'credit') credits = r._sum.amountKobo ?? 0n;
    else debits = r._sum.amountKobo ?? 0n;
  }
  return credits - debits;
}

/* ---- Standard flows (used inside booking transactions) ---- */

/** Verified payment: provider cash in, held in escrow. */
export function captureLegs(amount: bigint): Leg[] {
  return [
    { account: 'provider_cash', direction: 'debit', amountKobo: amount },
    { account: 'customer_escrow', direction: 'credit', amountKobo: amount },
  ];
}

/** Completion: escrow released to professional payable + platform fee. */
export function releaseLegs(amount: bigint, fee: bigint, professionalId: string): Leg[] {
  return [
    { account: 'customer_escrow', direction: 'debit', amountKobo: amount },
    { account: 'professional_payable', direction: 'credit', amountKobo: amount - fee, subjectId: professionalId },
    { account: 'platform_revenue', direction: 'credit', amountKobo: fee },
  ];
}

/** Refund: escrow returned to the customer. */
export function refundLegs(amount: bigint): Leg[] {
  return [
    { account: 'customer_escrow', direction: 'debit', amountKobo: amount },
    { account: 'refunds_paid', direction: 'credit', amountKobo: amount },
  ];
}

/** Payout: payable settled out through the provider. */
export function payoutLegs(amount: bigint, professionalId: string): Leg[] {
  return [
    { account: 'professional_payable', direction: 'debit', amountKobo: amount, subjectId: professionalId },
    { account: 'provider_cash', direction: 'credit', amountKobo: amount },
  ];
}
