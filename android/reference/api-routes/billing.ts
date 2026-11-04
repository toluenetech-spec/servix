/**
 * Plans & entitlements for every account.
 *   GET  /me/entitlements        plan, capabilities, limits, usage meters, AI meter, catalogue, history
 *   GET  /billing/plan           alias of the above (Plan page)
 *   POST /billing/checkout       start a Paystack checkout for a purchasable plan (go / pro / team)
 *   POST /billing/verify         verify a returned reference and activate (idempotent)
 *   POST /billing/downgrade      switch to Free immediately; data is kept
 *
 * Payment execution stays entirely inside the existing provider abstraction (lib/payments.ts).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAuth } from '../lib/authGuard.js';
import { ApiError } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { entitlementsFor } from '../lib/entitlements/index.js';
import { downgradeToFree, planSummaryFor, startPlanCheckout, verifySubscription } from '../lib/plans.js';

const guard = { preHandler: requireAuth };

export async function billingRoutes(app: FastifyInstance) {
  const summary = async (req: Parameters<typeof entitlementsFor>[0]) => planSummaryFor(await entitlementsFor(req));

  app.get('/me/entitlements', { ...guard, schema: { tags: ['account'], summary: 'Effective plan, capabilities, limits and usage for the signed-in account', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return summary(req);
  });
  app.get('/billing/plan', { ...guard, schema: { tags: ['account'], summary: 'Plan page payload (same as /me/entitlements)', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return summary(req);
  });

  app.post('/billing/checkout', { ...guard, config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags: ['account'], summary: 'Start a plan checkout', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { plan } = parseBody(z.object({ plan: z.string().min(1).max(40) }).strict(), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
    if (!user.emailVerifiedAt) throw new ApiError(403, 'EMAIL_UNVERIFIED', 'Verify your email before upgrading.');
    const ent = await entitlementsFor(req);
    if (ent.organization && ent.organization.role !== 'owner' && ent.source !== 'account') {
      throw new ApiError(409, 'TEAM_MEMBER_PLAN', 'Your plan is provided by your team. Leave the team to manage a personal subscription.');
    }
    const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
    return startPlanCheckout(user.id, user.email, plan, appBase);
  });

  app.post('/billing/verify', { ...guard, config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['account'], summary: 'Verify a plan payment after returning from checkout', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { reference } = parseBody(z.object({ reference: z.string().min(1).max(120) }).strict(), req.body);
    const owned = await prisma.planSubscription.findFirst({ where: { reference, OR: [{ userId: req.auth!.sub }, { professional: { userId: req.auth!.sub } }] }, select: { id: true } });
    if (!owned) throw new ApiError(404, 'NOT_FOUND', 'Unknown plan reference.');
    const status = await verifySubscription(reference);
    req.entitlements = undefined;
    return { status, plan: await summary(req) };
  });

  app.post('/billing/downgrade', { ...guard, config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags: ['account'], summary: 'Switch to the Free plan immediately (data is kept)', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    parseBody(z.object({ plan: z.literal('free'), confirm: z.literal(true) }).strict(), req.body);
    // Team owners may downgrade too; members lose the shared plan at once (the client warns before confirming).
    await downgradeToFree(req.auth!.sub);
    req.entitlements = undefined;
    return { status: 'free', plan: await summary(req) };
  });
}
