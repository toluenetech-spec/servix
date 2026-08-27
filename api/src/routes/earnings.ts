/**
 * SERVIX Phase D — professional earnings & payouts (ledger-derived).
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { requireProfessional } from '../lib/authGuard.js';
import { ApiError } from '../lib/errors.js';
import { accountBalance, payoutLegs, postTransaction } from '../lib/ledger.js';
import { getPaymentProvider } from '../lib/payments.js';

export async function earningsRoutes(app: FastifyInstance) {
  app.get(
    '/pro/earnings',
    { preHandler: requireProfessional, schema: { tags: ['payments'], summary: 'Ledger-derived earnings & payout history', security: [{ bearerAuth: [] }] } },
    async (req) => {
      const proId = req.professionalProfileId!;
      const payable = await accountBalance('professional_payable', proId);
      const lifetimeCredits = await prisma.ledgerEntry.aggregate({
        where: { account: 'professional_payable', subjectId: proId, direction: 'credit' },
        _sum: { amountKobo: true },
      });
      const payouts = await prisma.payout.findMany({
        where: { professionalId: proId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      return {
        payableKobo: payable.toString(),
        payable: Number(payable / 100n),
        lifetimeEarnings: Number((lifetimeCredits._sum.amountKobo ?? 0n) / 100n),
        payouts: payouts.map((p) => ({
          id: p.id,
          reference: p.reference,
          amount: Number(p.amountKobo / 100n),
          status: p.status,
          providerRef: p.providerRef,
          createdAt: p.createdAt.toISOString(),
          paidAt: p.paidAt?.toISOString() ?? null,
        })),
      };
    },
  );

  app.post(
    '/pro/payouts',
    { preHandler: requireProfessional, schema: { tags: ['payments'], summary: 'Request payout of the full payable balance', security: [{ bearerAuth: [] }] } },
    async (req, reply) => {
      const proId = req.professionalProfileId!;

      // Serialize per professional: the partial unique index on
      // (professional_id) WHERE status='processing' makes double
      // requests impossible at the DB level; balance is recomputed
      // inside the transaction.
      const reference = `po-${randomUUID()}`;
      let payout;
      try {
        payout = await prisma.$transaction(async (tx) => {
          const payable = await accountBalance('professional_payable', proId, tx);
          if (payable <= 0n) {
            throw new ApiError(409, 'NOTHING_PAYABLE', 'No funds available for payout.');
          }
          const created = await tx.payout.create({
            data: { professionalId: proId, reference, amountKobo: payable },
          });
          await postTransaction(tx, payoutLegs(payable, proId), {
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

      // Provider transfer AFTER the ledger hold; reference stored either way.
      try {
        const transfer = await getPaymentProvider().transfer({
          reference,
          amountKobo: payout.amountKobo,
          recipientName: proId,
        });
        const updated = await prisma.payout.update({
          where: { id: payout.id },
          data: {
            status: transfer.status === 'failed' ? 'failed' : 'paid',
            providerRef: transfer.providerRef,
            paidAt: transfer.status === 'failed' ? null : new Date(),
          },
        });
        return reply.code(201).send({
          id: updated.id,
          reference: updated.reference,
          amount: Number(updated.amountKobo / 100n),
          status: updated.status,
          providerRef: updated.providerRef,
        });
      } catch (err) {
        await prisma.payout.update({ where: { id: payout.id }, data: { status: 'failed' } });
        throw new ApiError(502, 'TRANSFER_FAILED', 'The payout transfer failed. Support has been notified.');
      }
    },
  );
}
