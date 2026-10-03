/**
 * Admin Console: plans, organisations and the AI usage analytics dashboard.
 *
 *   GET   /admin/plans                       catalogue with code defaults, operator overrides and effective tables
 *   PATCH /admin/plans/:slug                 edit price / copy / overrides (limits, features, aiDepartments)
 *   POST  /admin/users/:id/plan              assign a plan manually (enterprise deals, support) + optional custom limits
 *   GET   /admin/organizations               list teams with owner, plan, member counts, AI usage this period
 *   PATCH /admin/organizations/:id           assign plan / expiry / custom limits (enterprise)
 *   GET   /admin/ai/usage                    aggregated AI usage analytics (filters: from, to, plan, userId, organizationId, department, model, status, granularity)
 *   GET   /admin/ai/usage/events             paginated raw events (no prompts, ever)
 *
 * Nothing here can read or change payment credentials, wallets or provider configuration.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/db.js';
import { requireAdmin } from '../lib/authGuard.js';
import { ApiError, notFound } from '../lib/errors.js';
import { parseBody, parseQuery, paginationSchema } from '../lib/query.js';
import { audit } from '../lib/audit.js';
import { grantPlan, effectivePlan } from '../lib/plans.js';
import {
  FEATURES, LIMITS, PLAN_AI_DEPARTMENTS, PLAN_LABEL, PLAN_LIMITS, PLAN_SLUGS, isPlanSlug, loadPlanOverrides, invalidatePlanOverrides, effectivePlanTable, sanitizeOverride,
} from '../lib/entitlements/index.js';
import { periodStart, readMeter } from '../lib/entitlements/usage.js';
import { DEPARTMENTS } from '../ai/config.js';

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function adminPlanRoutes(app: FastifyInstance) {
  const guard = { preHandler: requireAdmin };

  /* ---------------- plans ---------------- */
  app.get('/admin/plans', { ...guard, schema: { tags: ['admin'], summary: 'Plan catalogue: defaults, overrides and effective entitlements', security: [{ bearerAuth: [] }] } }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const [rows, overrides, counts] = await Promise.all([
      prisma.plan.findMany({ orderBy: { position: 'asc' } }),
      loadPlanOverrides(true),
      prisma.user.findMany({ where: { deletedAt: null }, select: { planSlug: true, planExpiresAt: true } }),
    ]);
    const accounts: Record<string, number> = {};
    for (const u of counts) { const s = effectivePlan(u); accounts[s] = (accounts[s] ?? 0) + 1; }
    return {
      catalog: { features: FEATURES, limits: LIMITS, departments: DEPARTMENTS },
      plans: rows.filter((p) => isPlanSlug(p.slug)).map((p) => {
        const slug = p.slug as typeof PLAN_SLUGS[number];
        return {
          slug, name: p.name, tagline: p.tagline, price: Number(p.price), currency: p.currency, period: p.period, cta: p.cta, highlighted: p.highlighted, features: p.features, isActive: p.isActive, position: p.position,
          defaults: { limits: PLAN_LIMITS[slug], aiDepartments: PLAN_AI_DEPARTMENTS[slug] },
          overrides: overrides[slug] ?? {},
          effective: effectivePlanTable(slug, overrides),
          accounts: accounts[slug] ?? 0,
        };
      }),
    };
  });

  app.patch<{ Params: { slug: string } }>('/admin/plans/:slug', { ...guard, schema: { tags: ['admin'], summary: 'Edit a plan (price, copy, overrides)', security: [{ bearerAuth: [] }] } }, async (req) => {
    const slug = req.params.slug;
    if (!isPlanSlug(slug)) throw notFound('NOT_FOUND', 'Unknown plan.');
    const body = parseBody(z.object({
      name: z.string().trim().min(1).max(40).optional(), tagline: z.string().trim().max(160).optional(), price: z.number().int().min(0).max(100_000_000).optional(),
      cta: z.string().trim().max(40).optional(), highlighted: z.boolean().optional(), isActive: z.boolean().optional(), features: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
      overrides: z.object({ limits: z.record(z.string(), z.number().int().min(0).nullable()).optional(), features: z.record(z.string(), z.boolean()).optional(), aiDepartments: z.array(z.string()).nullable().optional() }).optional(),
    }).strict(), req.body);
    if (slug === 'free' && body.price !== undefined && body.price !== 0) throw new ApiError(422, 'VALIDATION_ERROR', 'The Free plan stays free.');
    const existing = await prisma.plan.findUnique({ where: { slug } });
    if (!existing) throw notFound('NOT_FOUND', 'Unknown plan.');
    const data: Prisma.PlanUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.tagline !== undefined) data.tagline = body.tagline;
    if (body.price !== undefined) data.price = BigInt(body.price);
    if (body.cta !== undefined) data.cta = body.cta;
    if (body.highlighted !== undefined) data.highlighted = body.highlighted;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.features !== undefined) data.features = body.features;
    if (body.overrides !== undefined) {
      const clean = sanitizeOverride({ ...body.overrides, aiDepartments: body.overrides.aiDepartments ?? undefined });
      data.limits = clean as Prisma.InputJsonValue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.plan.update({ where: { slug }, data });
      await audit(tx, { actorId: req.auth!.sub, action: 'plan.catalog_updated', entity: 'plan', entityId: slug, data: body as object });
    });
    invalidatePlanOverrides();
    const overrides = await loadPlanOverrides(true);
    return { slug, overrides: overrides[slug] ?? {}, effective: effectivePlanTable(slug, overrides) };
  });

  /* ---------------- manual plan assignment ---------------- */
  app.post<{ Params: { id: string } }>('/admin/users/:id/plan', { ...guard, schema: { tags: ['admin'], summary: 'Assign a plan to an account (enterprise deals, support)', security: [{ bearerAuth: [] }] } }, async (req) => {
    const body = parseBody(z.object({ plan: z.string(), expiresAt: z.string().datetime().nullable().optional(), days: z.number().int().min(1).max(3660).optional(), note: z.string().trim().max(300).optional(), customLimits: z.unknown().optional() }).strict(), req.body);
    if (!isPlanSlug(body.plan)) throw new ApiError(422, 'VALIDATION_ERROR', 'Unknown plan.');
    const expiresAt = body.plan === 'free' ? null : body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + (body.days ?? 30) * 86_400_000);
    await grantPlan(req.auth!.sub, req.params.id, body.plan, expiresAt, body.note);
    if (body.customLimits !== undefined) {
      await prisma.user.update({ where: { id: req.params.id }, data: { customLimits: sanitizeOverride(body.customLimits) as Prisma.InputJsonValue } });
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.params.id }, select: { id: true, planSlug: true, planExpiresAt: true, customLimits: true } });
    return { id: user.id, plan: user.planSlug, label: PLAN_LABEL[effectivePlan(user)], expiresAt: user.planExpiresAt?.toISOString() ?? null, customLimits: user.customLimits };
  });

  /* ---------------- organisations ---------------- */
  app.get('/admin/organizations', { ...guard, schema: { tags: ['admin'], summary: 'Teams and enterprise organisations', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const q = parseQuery(paginationSchema.extend({ q: z.string().trim().max(80).optional() }), req.query);
    const where: Prisma.OrganizationWhereInput = q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { owner: { email: { contains: q.q, mode: 'insensitive' } } }] } : {};
    const [total, rows] = await Promise.all([
      prisma.organization.count({ where }),
      prisma.organization.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { owner: { select: { id: true, fullName: true, email: true, planSlug: true, planExpiresAt: true } }, _count: { select: { members: true } } } }),
    ]);
    const start = periodStart();
    const usage = rows.length ? await prisma.aiUsageEvent.groupBy({ by: ['organizationId'], where: { organizationId: { in: rows.map((r) => r.id) }, createdAt: { gte: start } }, _sum: { totalTokens: true }, _count: true }) : [];
    return {
      total, page: q.page, pageSize: q.pageSize,
      items: rows.map((o) => {
        const u = usage.find((x) => x.organizationId === o.id);
        const assigned = o.planSlug && isPlanSlug(o.planSlug) && (!o.planExpiresAt || o.planExpiresAt > new Date()) ? o.planSlug : null;
        return { id: o.id, name: o.name, slug: o.slug, createdAt: o.createdAt.toISOString(), owner: { id: o.owner.id, name: o.owner.fullName, email: o.owner.email, plan: effectivePlan(o.owner) },
          assignedPlan: o.planSlug, assignedPlanExpiresAt: o.planExpiresAt?.toISOString() ?? null, effectivePlan: assigned ?? effectivePlan(o.owner), customLimits: o.customLimits,
          members: o._count.members, aiTokensThisPeriod: u?._sum.totalTokens ?? 0, aiRequestsThisPeriod: u?._count ?? 0 };
      }),
    };
  });

  app.patch<{ Params: { id: string } }>('/admin/organizations/:id', { ...guard, schema: { tags: ['admin'], summary: 'Assign a plan / custom limits to an organisation', security: [{ bearerAuth: [] }] } }, async (req) => {
    const body = parseBody(z.object({ plan: z.string().nullable().optional(), expiresAt: z.string().datetime().nullable().optional(), days: z.number().int().min(1).max(3660).optional(), customLimits: z.unknown().optional(), name: z.string().trim().min(2).max(80).optional() }).strict(), req.body);
    const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!org) throw notFound('NOT_FOUND', 'Organisation not found.');
    const data: Prisma.OrganizationUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.plan !== undefined) {
      if (body.plan !== null && !isPlanSlug(body.plan)) throw new ApiError(422, 'VALIDATION_ERROR', 'Unknown plan.');
      data.planSlug = body.plan;
      data.planExpiresAt = body.plan === null ? null : body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + (body.days ?? 365) * 86_400_000);
    } else if (body.expiresAt !== undefined) data.planExpiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (body.customLimits !== undefined) data.customLimits = sanitizeOverride(body.customLimits) as Prisma.InputJsonValue;
    const updated = await prisma.$transaction(async (tx) => {
      const r = await tx.organization.update({ where: { id: org.id }, data });
      await audit(tx, { actorId: req.auth!.sub, action: 'organization.updated', entity: 'organization', entityId: org.id, data: body as object });
      return r;
    });
    return { id: updated.id, name: updated.name, assignedPlan: updated.planSlug, assignedPlanExpiresAt: updated.planExpiresAt?.toISOString() ?? null, customLimits: updated.customLimits };
  });

  /* ---------------- AI usage analytics ---------------- */
  const usageQuery = z.object({
    from: z.string().datetime().optional(), to: z.string().datetime().optional(), days: z.coerce.number().int().min(1).max(365).default(30),
    plan: z.string().optional(), userId: z.string().uuid().optional(), organizationId: z.string().uuid().optional(), department: z.string().optional(), model: z.string().optional(),
    status: z.enum(['ok', 'failed']).optional(), granularity: z.enum(['day', 'week', 'month']).default('day'),
  });
  const usageWhere = (q: z.infer<typeof usageQuery>): { where: Prisma.AiUsageEventWhereInput; from: Date; to: Date } => {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - q.days * 86_400_000);
    const where: Prisma.AiUsageEventWhereInput = { createdAt: { gte: from, lte: to } };
    if (q.plan && isPlanSlug(q.plan)) where.planSlug = q.plan;
    if (q.userId) where.userId = q.userId;
    if (q.organizationId) where.organizationId = q.organizationId;
    if (q.department) where.department = q.department;
    if (q.model) where.OR = [{ model: q.model }, { modelAlias: q.model }];
    if (q.status) where.ok = q.status === 'ok';
    return { where, from, to };
  };

  app.get('/admin/ai/usage', { ...guard, schema: { tags: ['admin'], summary: 'AI usage analytics (tokens, requests, success, latency, fallbacks) with filters', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const q = parseQuery(usageQuery, req.query);
    const { where, from, to } = usageWhere(q);
    // When a status filter is active, "succeeded"/"failed" slices that contradict it are empty rather than re-widened.
    const okWhere = (ok: boolean): Prisma.AiUsageEventWhereInput | null => (where.ok !== undefined && where.ok !== ok ? null : { ...where, ok });
    const none = { _count: 0, _avg: { durationMs: null }, _sum: { totalTokens: 0 } };
    const [agg, okAgg, failedAgg, fallbackCount, byPlan, byDepartment, byModel, byError, topUsers, topOrgs] = await Promise.all([
      prisma.aiUsageEvent.aggregate({ where, _count: true, _sum: { totalTokens: true, promptTokens: true, completionTokens: true }, _avg: { durationMs: true } }),
      okWhere(true) ? prisma.aiUsageEvent.aggregate({ where: okWhere(true)!, _count: true, _avg: { durationMs: true } }) : Promise.resolve(none),
      okWhere(false) ? prisma.aiUsageEvent.aggregate({ where: okWhere(false)!, _count: true, _sum: { totalTokens: true } }) : Promise.resolve(none),
      prisma.aiUsageEvent.count({ where: { ...where, fallbackUsed: true } }),
      prisma.aiUsageEvent.groupBy({ by: ['planSlug'], where, _count: true, _sum: { totalTokens: true }, _avg: { durationMs: true } }),
      prisma.aiUsageEvent.groupBy({ by: ['department'], where, _count: true, _sum: { totalTokens: true }, _avg: { durationMs: true } }),
      prisma.aiUsageEvent.groupBy({ by: ['modelAlias', 'model'], where, _count: true, _sum: { totalTokens: true }, _avg: { durationMs: true } }),
      okWhere(false) ? prisma.aiUsageEvent.groupBy({ by: ['errorCode'], where: okWhere(false)!, _count: true }) : Promise.resolve([] as Array<{ errorCode: string | null; _count: number }>),
      prisma.aiUsageEvent.groupBy({ by: ['userId'], where: { ...where, userId: { not: null } }, _count: true, _sum: { totalTokens: true }, orderBy: { _sum: { totalTokens: 'desc' } }, take: 10 }),
      prisma.aiUsageEvent.groupBy({ by: ['organizationId'], where: { ...where, organizationId: { not: null } }, _count: true, _sum: { totalTokens: true }, orderBy: { _sum: { totalTokens: 'desc' } }, take: 10 }),
    ]);
    const okByDept = okWhere(true) ? await prisma.aiUsageEvent.groupBy({ by: ['department'], where: okWhere(true)!, _count: true }) : [];
    const okByModel = okWhere(true) ? await prisma.aiUsageEvent.groupBy({ by: ['modelAlias'], where: okWhere(true)!, _count: true }) : [];
    const okByPlan = okWhere(true) ? await prisma.aiUsageEvent.groupBy({ by: ['planSlug'], where: okWhere(true)!, _count: true }) : [];

    // Time series via SQL (date_trunc honours the requested granularity). Filters are re-applied with Prisma.sql fragments.
    const conds: Prisma.Sql[] = [Prisma.sql`"created_at" >= ${from}`, Prisma.sql`"created_at" <= ${to}`];
    if (q.plan && isPlanSlug(q.plan)) conds.push(Prisma.sql`"plan_slug" = ${q.plan}`);
    if (q.userId) conds.push(Prisma.sql`"user_id" = ${q.userId}`);
    if (q.organizationId) conds.push(Prisma.sql`"organization_id" = ${q.organizationId}`);
    if (q.department) conds.push(Prisma.sql`"department" = ${q.department}`);
    if (q.model) conds.push(Prisma.sql`("model" = ${q.model} OR "model_alias" = ${q.model})`);
    if (q.status) conds.push(Prisma.sql`"ok" = ${q.status === 'ok'}`);
    const whereSql = Prisma.join(conds, ' AND ');
    const series = await prisma.$queryRaw<Array<{ bucket: Date; requests: bigint; ok: bigint; tokens: bigint; avg_ms: number | null; fallbacks: bigint }>>`
      SELECT date_trunc(${q.granularity}, "created_at") AS bucket, COUNT(*)::bigint AS requests, COUNT(*) FILTER (WHERE "ok")::bigint AS ok,
             COALESCE(SUM("total_tokens"), 0)::bigint AS tokens, AVG("duration_ms")::float AS avg_ms, COUNT(*) FILTER (WHERE "fallback_used")::bigint AS fallbacks
      FROM "ai_usage_events" WHERE ${whereSql} GROUP BY 1 ORDER BY 1`;

    const userIds = topUsers.map((u) => u.userId!).filter(Boolean);
    const orgIds = topOrgs.map((o) => o.organizationId!).filter(Boolean);
    const [users, orgs] = await Promise.all([
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true, role: true, planSlug: true, planExpiresAt: true } }) : [],
      orgIds.length ? prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
    ]);
    const requests = agg._count;
    return {
      range: { from: from.toISOString(), to: to.toISOString(), granularity: q.granularity },
      totals: {
        requests, succeeded: okAgg._count, failed: failedAgg._count, successRate: requests ? Math.round((okAgg._count / requests) * 1000) / 10 : null,
        tokens: agg._sum.totalTokens ?? 0, promptTokens: agg._sum.promptTokens ?? 0, completionTokens: agg._sum.completionTokens ?? 0, tokensOnFailures: failedAgg._sum.totalTokens ?? 0,
        avgLatencyMs: agg._avg.durationMs ? Math.round(agg._avg.durationMs) : null, avgLatencySuccessMs: okAgg._avg.durationMs ? Math.round(okAgg._avg.durationMs) : null,
        fallbacks: fallbackCount, fallbackRate: requests ? Math.round((fallbackCount / requests) * 1000) / 10 : null,
      },
      byPlan: byPlan.map((p) => ({ plan: p.planSlug, label: isPlanSlug(p.planSlug) ? PLAN_LABEL[p.planSlug] : p.planSlug, requests: p._count, succeeded: okByPlan.find((o) => o.planSlug === p.planSlug)?._count ?? 0, tokens: p._sum.totalTokens ?? 0, avgLatencyMs: p._avg.durationMs ? Math.round(p._avg.durationMs) : null })).sort((a, b) => b.tokens - a.tokens),
      byDepartment: byDepartment.map((d) => ({ department: d.department, requests: d._count, succeeded: okByDept.find((o) => o.department === d.department)?._count ?? 0, tokens: d._sum.totalTokens ?? 0, avgLatencyMs: d._avg.durationMs ? Math.round(d._avg.durationMs) : null })).sort((a, b) => b.tokens - a.tokens),
      byModel: byModel.map((m) => ({ alias: m.modelAlias, model: m.model, requests: m._count, succeeded: okByModel.find((o) => o.modelAlias === m.modelAlias)?._count ?? 0, tokens: m._sum.totalTokens ?? 0, avgLatencyMs: m._avg.durationMs ? Math.round(m._avg.durationMs) : null })).sort((a, b) => b.requests - a.requests),
      errors: byError.map((e) => ({ code: e.errorCode ?? 'unknown', count: e._count })).sort((a, b) => b.count - a.count),
      series: series.map((s) => ({ date: dayKey(s.bucket), requests: Number(s.requests), succeeded: Number(s.ok), failed: Number(s.requests) - Number(s.ok), tokens: Number(s.tokens), avgLatencyMs: s.avg_ms ? Math.round(s.avg_ms) : null, fallbacks: Number(s.fallbacks) })),
      topUsers: topUsers.map((u) => { const user = users.find((x) => x.id === u.userId); return { userId: u.userId, name: user?.fullName ?? 'Deleted account', email: user?.email ?? null, role: user?.role ?? null, plan: user ? effectivePlan(user) : null, requests: u._count, tokens: u._sum.totalTokens ?? 0 }; }),
      topOrganizations: topOrgs.map((o) => ({ organizationId: o.organizationId, name: orgs.find((x) => x.id === o.organizationId)?.name ?? 'Deleted team', requests: o._count, tokens: o._sum.totalTokens ?? 0 })),
      filters: { plans: PLAN_SLUGS, departments: DEPARTMENTS },
    };
  });

  app.get('/admin/ai/usage/events', { ...guard, schema: { tags: ['admin'], summary: 'Raw AI usage events (paginated; never prompts or answers)', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const q = parseQuery(usageQuery.merge(paginationSchema), req.query);
    const { where } = usageWhere(q);
    const [total, rows] = await Promise.all([
      prisma.aiUsageEvent.count({ where }),
      prisma.aiUsageEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { user: { select: { fullName: true, email: true } }, organization: { select: { name: true } } } }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((e) => ({ id: e.id, at: e.createdAt.toISOString(), user: e.user ? { name: e.user.fullName, email: e.user.email } : null, organization: e.organization?.name ?? null, plan: e.planSlug, department: e.department, alias: e.modelAlias, model: e.model, promptTokens: e.promptTokens, completionTokens: e.completionTokens, totalTokens: e.totalTokens, ok: e.ok, durationMs: e.durationMs, fallbackUsed: e.fallbackUsed, attempts: e.attempts, errorCode: e.errorCode })) };
  });

  /* ---------------- per-account meter (support) ---------------- */
  app.get<{ Params: { id: string } }>('/admin/users/:id/ai-usage', { ...guard, schema: { tags: ['admin'], summary: 'One account’s AI meter and plan', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, planSlug: true, planExpiresAt: true, customLimits: true } });
    if (!user) throw notFound('NOT_FOUND', 'User not found.');
    const plan = effectivePlan(user);
    const overrides = await loadPlanOverrides();
    const table = effectivePlanTable(plan, overrides, plan === 'enterprise' ? [sanitizeOverride(user.customLimits)] : []);
    return { plan, label: PLAN_LABEL[plan], expiresAt: user.planExpiresAt?.toISOString() ?? null, customLimits: user.customLimits, limits: table.limits, meter: await readMeter({ type: 'user', id: user.id }, 'ai_tokens', table.limits.monthly_ai_tokens) };
  });
}
