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
import { optionalAuth, requireAdmin, requireAuth, requireProfessional } from '../lib/authGuard.js';
import { runMetered } from '../ai/metering.js';
import { entitlementsFor } from '../lib/entitlements/index.js';
import { aiMeters } from '../lib/entitlements/usage.js';
import { ApiError } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { FEATURE_FLAGS } from '../lib/features.js';
import { aiEnabled, aiStatus, attachAiLogger, getAi } from '../ai/index.js';
import type { RunOptions, TaskSuccess } from '../ai/router.js';
import type { UsageMeter } from '../lib/entitlements/usage.js';
import type { ToolContext } from '../ai/tools.js';
import { DEPARTMENT_DEFS } from '../ai/departments.js';
import {
  assistantInput, assistantTask, searchIntentInput, searchIntentTask, jobMatchingTask, opportunityRadarTask,
  profileAnalysisTask, improvementInput, profileImprovementTask, pricingInput, pricingGuidanceTask,
  projectHealthTask, explainInput, explanationTask, proposalInput, proposalTask, draftInput, draftingTask,
} from '../ai/departments.js';

const AI_RATE = { rateLimit: { max: 20, timeWindow: '1 minute' } };

/** OpenAPI body descriptions so the /docs console offers an editor. Validation itself is zod (422). */
const str = (description: string, example?: string) => ({ type: 'string', description: example ? `${description} (e.g. "${example}")` : description });
const DOC = {
  assistant: { type: 'object', properties: { messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' } } }, description: 'e.g. [{"role":"user","content":"Who can design a logo for my bakery in Lagos?"}]' } } },
  searchIntent: { type: 'object', properties: { query: str('What the customer typed', 'logo designer in Lagos under 30k') } },
  improve: { type: 'object', properties: { focus: { type: 'string', enum: ['all', 'about', 'title', 'gigs', 'skills', 'pricing'] } } },
  pricing: { type: 'object', properties: { categorySlug: str('Category slug', 'graphic-design'), brief: str('Optional description of the job'), deliveryDays: { type: 'integer' } } },
  explain: { type: 'object', properties: { topic: str('e.g. payments, trust, requests, kyc, plans, achievements', 'payments'), context: str('Optional extra context') } },
  proposal: { type: 'object', properties: { requestId: str('Open request id (uuid)'), notes: str('Optional notes from the professional') } },
  drafts: { type: 'object', properties: { kind: { type: 'string', enum: ['request_brief', 'gig_description', 'client_message', 'profile_about'] }, input: str('Rough notes', 'Restaurant website with menu and WhatsApp ordering, budget 150-250k'), tone: { type: 'string', enum: ['friendly', 'professional', 'brief'] } } },
  empty: { type: 'object', properties: {} },
} as const;

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

/** Attach real request facts (from the DB, never from the model) to match/radar items so the UI can render links. */
async function withRequests<T extends { requestId: string }>(items: T[]): Promise<Array<T & { request: { id: string; title: string; categoryName: string; budgetMin: number | null; budgetMax: number | null; deadlineAt: string | null; proposalCount: number } | null }>> {
  const ids = [...new Set(items.map((i) => i.requestId))];
  const rows = ids.length ? await prisma.serviceRequest.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, budgetMinKobo: true, budgetMaxKobo: true, deadlineAt: true, proposalCount: true, category: { select: { name: true } } } }) : [];
  const byId = new Map(rows.map((r) => [r.id, { id: r.id, title: r.title, categoryName: r.category.name, budgetMin: r.budgetMinKobo == null ? null : Number(r.budgetMinKobo) / 100, budgetMax: r.budgetMaxKobo == null ? null : Number(r.budgetMaxKobo) / 100, deadlineAt: r.deadlineAt?.toISOString() ?? null, proposalCount: r.proposalCount }]));
  return items.map((i) => ({ ...i, request: byId.get(i.requestId) ?? null }));
}

/**
 * Server-sent events for the two conversational departments. The browser sees words as the model writes them
 * instead of waiting for the whole answer; a closed tab aborts every in-flight provider call. Events:
 *   data: {"type":"start"} | {"type":"delta","text":"…"} | {"type":"done","answer":"…","ai":{…}} | {"type":"error","code","message","status"}
 * The reply is hijacked, so CORS/rate-limit headers already set on the Fastify reply are copied onto the raw response.
 */
async function streamText(req: FastifyRequest, reply: FastifyReply, run: (opts: RunOptions) => Promise<TaskSuccess<string> & { quota?: UsageMeter | null }>): Promise<void> {
  const ac = new AbortController();
  let finished = false;
  reply.hijack();
  reply.raw.writeHead(200, { ...(reply.getHeaders() as Record<string, string | number | string[]>), 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  reply.raw.on('close', () => { if (!finished) ac.abort(); });
  const send = (event: Record<string, unknown>) => { if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`); };
  const heartbeat = setInterval(() => { if (!reply.raw.destroyed) reply.raw.write(': ping\n\n'); }, 15_000);
  send({ type: 'start' });
  try {
    const r = await run({ signal: ac.signal, onDelta: (text) => send({ type: 'delta', text }) });
    send({ type: 'done', answer: r.value, ai: meta(r, {}).ai });
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
    if (err.code !== 'AI_CANCELLED') {
      if (!(e instanceof ApiError)) req.log.error({ err: e }, 'ai stream failed');
      send({ type: 'error', code: err.code, message: err.message, status: err.status, ...(err.meta ? { meta: err.meta } : {}) });
    }
  } finally {
    finished = true;
    clearInterval(heartbeat);
    if (!reply.raw.destroyed) reply.raw.end();
  }
}

const meta = <T>(r: { model: string; alias: string; fallbackUsed: boolean; attempts: number; durationMs: number; toolsUsed: string[]; usage: { promptTokens: number; completionTokens: number }; quota?: UsageMeter | null }, value: T) =>
  ({ ...value, ai: { model: r.alias, fallbackUsed: r.fallbackUsed, durationMs: r.durationMs, toolsUsed: r.toolsUsed, tokens: r.usage.promptTokens + r.usage.completionTokens, quota: r.quota ?? null } });

export async function aiRoutes(app: FastifyInstance) {
  attachAiLogger({ info: (o, m) => app.log.info(o, m), warn: (o, m) => app.log.warn(o, m) });
  const auth = { preHandler: [requireAi, requireAuth], config: AI_RATE, attachValidation: true as const };
  const pro = { preHandler: [requireAi, requireProfessional], config: AI_RATE, attachValidation: true as const };

  app.post('/ai/assistant', { ...auth, schema: { tags: ['ai'], summary: 'AI Concierge — grounded assistant over real Servix data', body: DOC.assistant } }, async (req) => {
    const input = parseBody(assistantInput, req.body);
    const r = await runMetered(req, assistantTask(input, await toolContext(req)));
    return meta(r, { answer: r.value });
  });

  app.post('/ai/assistant/stream', { ...auth, schema: { tags: ['ai'], summary: 'AI Concierge, streamed as server-sent events (same grounding and limits as /ai/assistant)', body: DOC.assistant } }, async (req, reply) => {
    const input = parseBody(assistantInput, req.body);
    const task = assistantTask(input, await toolContext(req));
    await streamText(req, reply, (opts) => runMetered(req, task, opts));
  });

  app.post('/ai/search/intent', { preHandler: [requireAi, optionalAuth], config: AI_RATE, attachValidation: true, schema: { tags: ['ai'], summary: 'Natural-language query → validated professional-search filters', body: DOC.searchIntent } }, async (req) => {
    const input = parseBody(searchIntentInput, req.body);
    const r = await runMetered(req, await searchIntentTask(input));
    return meta(r, { filters: r.value });
  });

  app.post('/ai/opportunities/match', { ...pro, schema: { tags: ['ai'], summary: 'Rank open requests for the signed-in professional', body: DOC.empty } }, async (req) => {
    const task = await jobMatchingTask(await toolContext(req));
    if ('shortCircuit' in task) return { ...task.shortCircuit, ai: null };
    const r = await runMetered(req, task);
    return meta(r, { ...r.value, matches: await withRequests(r.value.matches) });
  });

  app.post('/ai/opportunities/radar', { ...pro, schema: { tags: ['ai'], summary: 'Opportunity Radar — what is new this week', body: DOC.empty } }, async (req) => {
    const task = await opportunityRadarTask(await toolContext(req));
    if ('shortCircuit' in task) return { ...task.shortCircuit, ai: null };
    const r = await runMetered(req, task);
    return meta(r, { ...r.value, highlights: await withRequests(r.value.highlights) });
  });

  app.post('/ai/profile/analysis', { ...pro, schema: { tags: ['ai'], summary: 'Analyse the signed-in professional’s profile', body: DOC.empty } }, async (req) => {
    const r = await runMetered(req, await profileAnalysisTask(await toolContext(req)));
    return meta(r, r.value);
  });

  app.post('/ai/profile/improve', { ...pro, schema: { tags: ['ai'], summary: 'Concrete profile improvement suggestions', body: DOC.improve } }, async (req) => {
    const input = parseBody(improvementInput, req.body ?? {});
    const r = await runMetered(req, await profileImprovementTask(input, await toolContext(req)));
    return meta(r, r.value);
  });

  app.post('/ai/pricing/guidance', { ...auth, schema: { tags: ['ai'], summary: 'Pricing guidance from real Servix price data', body: DOC.pricing } }, async (req) => {
    const input = parseBody(pricingInput, req.body);
    const r = await runMetered(req, await pricingGuidanceTask(input, await toolContext(req)));
    return meta(r, r.value);
  });

  app.post<{ Params: { id: string } }>('/ai/bookings/:id/health', { ...auth, schema: { tags: ['ai'], summary: 'Project health explanation for a booking you are party to', body: DOC.empty } }, async (req) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
    const r = await runMetered(req, await projectHealthTask(id.data, await toolContext(req)));
    return meta(r, r.value);
  });

  app.post('/ai/explain', { ...auth, schema: { tags: ['ai'], summary: '“What does this mean?” — explain a Servix concept', body: DOC.explain } }, async (req) => {
    const input = parseBody(explainInput, req.body);
    const r = await runMetered(req, explanationTask(input));
    return meta(r, { answer: r.value });
  });

  app.post('/ai/explain/stream', { ...auth, schema: { tags: ['ai'], summary: 'Explain a Servix concept, streamed as server-sent events', body: DOC.explain } }, async (req, reply) => {
    const input = parseBody(explainInput, req.body);
    await streamText(req, reply, (opts) => runMetered(req, explanationTask(input), opts));
  });

  app.post('/ai/proposals/draft', { ...pro, schema: { tags: ['ai'], summary: 'Draft a proposal for an open request (nothing is submitted)', body: DOC.proposal } }, async (req) => {
    const input = parseBody(proposalInput, req.body);
    const r = await runMetered(req, await proposalTask(input, await toolContext(req)));
    return meta(r, { draft: r.value });
  });

  app.post('/ai/drafts', { ...auth, schema: { tags: ['ai'], summary: 'Background drafting: request brief, gig description, message, about', body: DOC.drafts } }, async (req) => {
    const input = parseBody(draftInput, req.body);
    const task = await draftingTask(input, await toolContext(req));
    if (task.kind === 'request_brief') { const r = await runMetered(req, task.spec); return meta(r, { kind: task.kind, draft: r.value }); }
    const r = await runMetered(req, task.spec);
    return meta(r, { kind: task.kind, draft: r.value });
  });

  app.get('/ai/usage', { preHandler: [requireAuth], schema: { tags: ['ai'], summary: 'My Servix AI allowance for this month (pool + personal cap)', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const ent = await entitlementsFor(req);
    const meters = await aiMeters(ent);
    return { plan: ent.plan, planLabel: ent.planLabel, departments: ent.aiDepartments, subject: ent.aiSubject.type, ...meters.pool, member: meters.member, enabled: aiEnabled() };
  });

  /* ---------------- admin: routing + telemetry (no secrets) ---------------- */

  app.get('/admin/ai/status', { preHandler: requireAdmin, schema: { tags: ['admin'], summary: 'AI routing configuration and internal telemetry' } }, async () => ({
    ...aiStatus(),
    departments: Object.values(DEPARTMENT_DEFS).map((d) => ({ department: d.key, label: d.label, audience: d.audience, tools: d.tools, chain: getAi().config.routes[d.key] })),
  }));

  app.get('/admin/ai/telemetry/recent', { preHandler: requireAdmin, schema: { tags: ['admin'], summary: 'Most recent AI attempts and tasks' } }, async () => getAi().telemetry.recent(100));
}
