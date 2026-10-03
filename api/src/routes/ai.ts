/**
 * Servix AI routes — /api/v1/ai/* (AI_ENABLED) + /api/v1/admin/ai/*.
 *
 * Every endpoint: authenticated, rate limited, routed through src/ai with the
 * department's model chain, and returns drafts/answers only. Nothing here
 * writes to the database or touches payments; drafts are submitted by the
 * client through the ordinary validated endpoints (POST /requests, …).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAdmin, requireAuth, requireProfessional } from '../lib/authGuard.js';
import { ApiError } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { FEATURE_FLAGS } from '../lib/features.js';
import { aiEnabled, aiStatus, attachAiLogger, getAi } from '../ai/index.js';
import type { ToolContext } from '../ai/tools.js';
import { DEPARTMENT_DEFS } from '../ai/departments.js';
import {
  assistantInput, assistantTask, searchIntentInput, searchIntentTask, jobMatchingTask, opportunityRadarTask,
  profileAnalysisTask, improvementInput, profileImprovementTask, pricingInput, pricingGuidanceTask,
  projectHealthTask, explainInput, explanationTask, proposalInput, proposalTask, draftInput, draftingTask,
} from '../ai/departments.js';

const AI_RATE = { rateLimit: { max: 20, timeWindow: '1 minute' } };

async function requireAi(_req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!aiEnabled()) throw new ApiError(503, 'FEATURE_DISABLED', `${FEATURE_FLAGS.ai.label} is not enabled on this Servix instance yet.`);
}

/** Role and profile come from the database, never from the token. */
async function toolContext(req: FastifyRequest): Promise<ToolContext> {
  if (!req.auth) return { userId: null, role: null, professionalProfileId: null };
  const user = await prisma.user.findUnique({ where: { id: req.auth.sub }, select: { id: true, role: true, professionalProfile: { select: { id: true } } } });
  if (!user) return { userId: null, role: null, professionalProfileId: null };
  return { userId: user.id, role: user.role as ToolContext['role'], professionalProfileId: user.professionalProfile?.id ?? null };
}

const meta = <T>(r: { model: string; alias: string; fallbackUsed: boolean; attempts: number; durationMs: number; toolsUsed: string[]; usage: { promptTokens: number; completionTokens: number } }, value: T) =>
  ({ ...value, ai: { model: r.alias, fallbackUsed: r.fallbackUsed, durationMs: r.durationMs, toolsUsed: r.toolsUsed } });

export async function aiRoutes(app: FastifyInstance) {
  attachAiLogger({ info: (o, m) => app.log.info(o, m), warn: (o, m) => app.log.warn(o, m) });
  const auth = { preHandler: [requireAi, requireAuth], config: AI_RATE };
  const pro = { preHandler: [requireAi, requireProfessional], config: AI_RATE };

  app.post('/ai/assistant', { ...auth, schema: { tags: ['ai'], summary: 'AI Concierge — grounded assistant over real Servix data' } }, async (req) => {
    const input = parseBody(assistantInput, req.body);
    const r = await getAi().router.run(assistantTask(input, await toolContext(req)));
    return meta(r, { answer: r.value });
  });

  app.post('/ai/search/intent', { preHandler: [requireAi], config: AI_RATE, schema: { tags: ['ai'], summary: 'Natural-language query → validated professional-search filters' } }, async (req) => {
    const input = parseBody(searchIntentInput, req.body);
    const r = await getAi().router.run(await searchIntentTask(input));
    return meta(r, { filters: r.value });
  });

  app.post('/ai/opportunities/match', { ...pro, schema: { tags: ['ai'], summary: 'Rank open requests for the signed-in professional' } }, async (req) => {
    const task = await jobMatchingTask(await toolContext(req));
    if ('shortCircuit' in task) return { ...task.shortCircuit, ai: null };
    const r = await getAi().router.run(task);
    return meta(r, r.value);
  });

  app.post('/ai/opportunities/radar', { ...pro, schema: { tags: ['ai'], summary: 'Opportunity Radar — what is new this week' } }, async (req) => {
    const task = await opportunityRadarTask(await toolContext(req));
    if ('shortCircuit' in task) return { ...task.shortCircuit, ai: null };
    const r = await getAi().router.run(task);
    return meta(r, r.value);
  });

  app.post('/ai/profile/analysis', { ...pro, schema: { tags: ['ai'], summary: 'Analyse the signed-in professional’s profile' } }, async (req) => {
    const r = await getAi().router.run(await profileAnalysisTask(await toolContext(req)));
    return meta(r, r.value);
  });

  app.post('/ai/profile/improve', { ...pro, schema: { tags: ['ai'], summary: 'Concrete profile improvement suggestions' } }, async (req) => {
    const input = parseBody(improvementInput, req.body ?? {});
    const r = await getAi().router.run(await profileImprovementTask(input, await toolContext(req)));
    return meta(r, r.value);
  });

  app.post('/ai/pricing/guidance', { ...auth, schema: { tags: ['ai'], summary: 'Pricing guidance from real Servix price data' } }, async (req) => {
    const input = parseBody(pricingInput, req.body);
    const r = await getAi().router.run(await pricingGuidanceTask(input, await toolContext(req)));
    return meta(r, r.value);
  });

  app.post<{ Params: { id: string } }>('/ai/bookings/:id/health', { ...auth, schema: { tags: ['ai'], summary: 'Project health explanation for a booking you are party to' } }, async (req) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
    const r = await getAi().router.run(await projectHealthTask(id.data, await toolContext(req)));
    return meta(r, r.value);
  });

  app.post('/ai/explain', { ...auth, schema: { tags: ['ai'], summary: '“What does this mean?” — explain a Servix concept' } }, async (req) => {
    const input = parseBody(explainInput, req.body);
    const r = await getAi().router.run(explanationTask(input));
    return meta(r, { answer: r.value });
  });

  app.post('/ai/proposals/draft', { ...pro, schema: { tags: ['ai'], summary: 'Draft a proposal for an open request (nothing is submitted)' } }, async (req) => {
    const input = parseBody(proposalInput, req.body);
    const r = await getAi().router.run(await proposalTask(input, await toolContext(req)));
    return meta(r, { draft: r.value });
  });

  app.post('/ai/drafts', { ...auth, schema: { tags: ['ai'], summary: 'Background drafting: request brief, gig description, message, about' } }, async (req) => {
    const input = parseBody(draftInput, req.body);
    const task = await draftingTask(input, await toolContext(req));
    if (task.kind === 'request_brief') { const r = await getAi().router.run(task.spec); return meta(r, { kind: task.kind, draft: r.value }); }
    const r = await getAi().router.run(task.spec);
    return meta(r, { kind: task.kind, draft: r.value });
  });

  /* ---------------- admin: routing + telemetry (no secrets) ---------------- */

  app.get('/admin/ai/status', { preHandler: requireAdmin, schema: { tags: ['admin'], summary: 'AI routing configuration and internal telemetry' } }, async () => ({
    ...aiStatus(),
    departments: Object.values(DEPARTMENT_DEFS).map((d) => ({ department: d.key, label: d.label, audience: d.audience, tools: d.tools, chain: getAi().config.routes[d.key] })),
  }));

  app.get('/admin/ai/telemetry/recent', { preHandler: requireAdmin, schema: { tags: ['admin'], summary: 'Most recent AI attempts and tasks' } }, async () => getAi().telemetry.recent(100));
}
