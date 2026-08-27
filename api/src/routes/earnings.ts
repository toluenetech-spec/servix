/**
 * SERVIX Phase D — professional earnings & payouts (ledger-derived).
 * Phase E: payout execution goes through payoutService, which reverses
 * the ledger hold EXACTLY ONCE on provider failure (CAS-guarded) and
 * supports admin/job retries without duplicating money.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { requireProfessional } from '../lib/authGuard.js';
import { accountBalance } from '../lib/ledger.js';
import { requestPayout } from '../lib/payoutService.js';

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
      const updated = await requestPayout(req.professionalProfileId!);
      return reply.code(201).send({
        id: updated.id,
        reference: updated.reference,
        amount: Number(updated.amountKobo / 100n),
        status: updated.status,
        providerRef: updated.providerRef,
      });
    },
  );
}
