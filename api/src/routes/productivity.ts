/**
 * Plan-metered productivity tools.
 *
 *   Saved searches     GET/POST /account/saved-searches, DELETE /account/saved-searches/:id   (limit: saved_searches)
 *   CSV exports        GET /exports/:kind.csv  kind = bookings | proposals | requests | earnings | saved   (limit: monthly_exports)
 *   Profile versions   GET/POST /pro/profile/versions, POST /pro/profile/versions/:id/restore, DELETE … (feature: profile_versions, limit)
 *
 * Exports contain only the signed-in account's own records. Nothing here touches payments.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAuth, requireProfessional } from '../lib/authGuard.js';
import { ApiError, notFound } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { audit } from '../lib/audit.js';
import { entitlementsFor, assertFeature, assertWithinLimit } from '../lib/entitlements/index.js';
import { consumeMonthly, readMeter } from '../lib/entitlements/usage.js';

const auth = { preHandler: requireAuth };
const pro = { preHandler: requireProfessional };

const csvEscape = (v: unknown) => { const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
const toCsv = (header: string[], rows: unknown[][]) => `${header.join(',')}\n${rows.map((r) => r.map(csvEscape).join(',')).join('\n')}${rows.length ? '\n' : ''}`;
const sendCsv = (reply: FastifyReply, name: string, body: string) => {
  reply.header('Content-Type', 'text/csv; charset=utf-8').header('Cache-Control', 'no-store').header('Content-Disposition', `attachment; filename="servix-${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  return body;
};

const SEARCH_KINDS = ['requests', 'professionals', 'services'] as const;

export async function productivityRoutes(app: FastifyInstance) {
  /* ---------------- saved searches ---------------- */
  app.get('/account/saved-searches', { ...auth, schema: { tags: ['account'], summary: 'My saved searches', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const ent = await entitlementsFor(req);
    const rows = await prisma.savedSearch.findMany({ where: { userId: req.auth!.sub }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { limit: ent.limits.saved_searches, items: rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, params: r.params, createdAt: r.createdAt.toISOString() })) };
  });
  app.post('/account/saved-searches', { ...auth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['account'], summary: 'Save a search', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    const body = parseBody(z.object({ kind: z.enum(SEARCH_KINDS), name: z.string().trim().min(1).max(80), params: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(60)).max(20)])).refine((p) => Object.keys(p).length <= 20, 'Too many filters.') }).strict(), req.body);
    const ent = await entitlementsFor(req);
    const count = await prisma.savedSearch.count({ where: { userId: req.auth!.sub } });
    assertWithinLimit(ent, 'saved_searches', count, 1);
    const row = await prisma.savedSearch.create({ data: { userId: req.auth!.sub, kind: body.kind, name: body.name, params: body.params } });
    return reply.code(201).send({ id: row.id, kind: row.kind, name: row.name, params: row.params, createdAt: row.createdAt.toISOString() });
  });
  app.delete<{ Params: { id: string } }>('/account/saved-searches/:id', { ...auth, schema: { tags: ['account'], summary: 'Delete a saved search', security: [{ bearerAuth: [] }] } }, async (req) => {
    const r = await prisma.savedSearch.deleteMany({ where: { id: req.params.id, userId: req.auth!.sub } });
    if (!r.count) throw notFound('NOT_FOUND', 'Saved search not found.');
    return { ok: true };
  });

  /* ---------------- exports ---------------- */
  app.get('/exports', { ...auth, schema: { tags: ['account'], summary: 'Export allowance for this month', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const ent = await entitlementsFor(req);
    return readMeter({ type: 'user', id: ent.userId }, 'exports', ent.limits.monthly_exports);
  });

  app.get<{ Params: { kind: string } }>('/exports/:kind', { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['account'], summary: 'Download my records as CSV (bookings | proposals | requests | earnings | saved)', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    const kind = req.params.kind.replace(/\.csv$/, '');
    const ent = await entitlementsFor(req);
    const userId = ent.userId;
    const profile = await prisma.professionalProfile.findUnique({ where: { userId }, select: { id: true } });
    let csv: string;
    switch (kind) {
      case 'bookings': {
        const rows = await prisma.booking.findMany({ where: { OR: [{ customerId: userId }, ...(profile ? [{ professionalId: profile.id }] : [])] }, orderBy: { createdAt: 'desc' }, take: 5000, select: { reference: true, serviceTitle: true, status: true, amountKobo: true, currency: true, createdAt: true, completedAt: true, customerId: true } });
        csv = toCsv(['reference', 'service', 'role', 'status', 'amount', 'currency', 'created_at', 'completed_at'], rows.map((b) => [b.reference, b.serviceTitle, b.customerId === userId ? 'customer' : 'professional', b.status, Number(b.amountKobo) / 100, b.currency, b.createdAt, b.completedAt]));
        break;
      }
      case 'proposals': {
        if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Only professionals have proposals.');
        const rows = await prisma.proposal.findMany({ where: { professionalId: profile.id }, orderBy: { createdAt: 'desc' }, take: 5000, select: { id: true, status: true, priceKobo: true, deliveryDays: true, label: true, createdAt: true, updatedAt: true, request: { select: { title: true, status: true } } } });
        csv = toCsv(['id', 'request', 'request_status', 'status', 'price', 'delivery_days', 'label', 'created_at', 'updated_at'], rows.map((p) => [p.id, p.request.title, p.request.status, p.status, Number(p.priceKobo) / 100, p.deliveryDays, p.label, p.createdAt, p.updatedAt]));
        break;
      }
      case 'requests': {
        const rows = await prisma.serviceRequest.findMany({ where: { customerId: userId }, orderBy: { createdAt: 'desc' }, take: 5000, select: { id: true, title: true, status: true, budgetMinKobo: true, budgetMaxKobo: true, proposalCount: true, deadlineAt: true, createdAt: true } });
        csv = toCsv(['id', 'title', 'status', 'budget_min', 'budget_max', 'proposals', 'deadline', 'created_at'], rows.map((r) => [r.id, r.title, r.status, r.budgetMinKobo == null ? '' : Number(r.budgetMinKobo) / 100, r.budgetMaxKobo == null ? '' : Number(r.budgetMaxKobo) / 100, r.proposalCount, r.deadlineAt, r.createdAt]));
        break;
      }
      case 'earnings': {
        if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Only professionals have earnings.');
        const rows = await prisma.ledgerEntry.findMany({ where: { account: 'professional_payable', subjectId: profile.id }, orderBy: { createdAt: 'desc' }, take: 5000, select: { id: true, direction: true, amountKobo: true, memo: true, createdAt: true } });
        csv = toCsv(['id', 'direction', 'amount', 'memo', 'created_at'], rows.map((e) => [e.id, e.direction, Number(e.amountKobo) / 100, e.memo, e.createdAt]));
        break;
      }
      case 'saved': {
        const rows = await prisma.savedProfessional.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5000, select: { preferred: true, note: true, createdAt: true, professional: { select: { name: true, slug: true, title: true } } } });
        csv = toCsv(['name', 'title', 'profile', 'preferred', 'note', 'saved_at'], rows.map((s) => [s.professional.name, s.professional.title, `/professionals/${s.professional.slug}`, s.preferred, s.note, s.createdAt]));
        break;
      }
      default:
        throw new ApiError(404, 'NOT_FOUND', 'Unknown export.');
    }
    // Count the export only once the data is ready (a failed query must not consume the allowance).
    await consumeMonthly({ type: 'user', id: userId }, 'exports', ent.limits.monthly_exports, ent.plan, 'monthly_exports');
    await audit(prisma, { actorId: userId, action: 'export.downloaded', entity: 'user', entityId: userId, data: { kind } });
    return sendCsv(reply, kind, csv);
  });

  /* ---------------- profile versions ---------------- */
  const snapshot = async (professionalId: string) => {
    const p = await prisma.professionalProfile.findUniqueOrThrow({ where: { id: professionalId }, select: { title: true, about: true, locationCity: true, responseTimeLabel: true, details: true, skills: { orderBy: { position: 'asc' }, select: { skill: true } } } });
    return { title: p.title, about: p.about, locationCity: p.locationCity, responseTimeLabel: p.responseTimeLabel, details: p.details, skills: p.skills.map((s) => s.skill) };
  };
  const serializeVersion = (v: { id: string; name: string; data: unknown; createdAt: Date }) => ({ id: v.id, name: v.name, data: v.data, createdAt: v.createdAt.toISOString() });

  app.get('/pro/profile/versions', { ...pro, schema: { tags: ['professional'], summary: 'Saved profile versions', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const ent = await entitlementsFor(req);
    const rows = await prisma.profileVersion.findMany({ where: { professionalId: req.professionalProfileId! }, orderBy: { createdAt: 'desc' } });
    return { enabled: ent.features.includes('profile_versions'), limit: ent.limits.profile_versions, items: rows.map(serializeVersion) };
  });
  app.post('/pro/profile/versions', { ...pro, config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['professional'], summary: 'Save the current profile as a named version', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    const ent = await entitlementsFor(req);
    assertFeature(ent, 'profile_versions');
    const { name } = parseBody(z.object({ name: z.string().trim().min(1).max(60) }).strict(), req.body);
    const count = await prisma.profileVersion.count({ where: { professionalId: req.professionalProfileId! } });
    assertWithinLimit(ent, 'profile_versions', count, 1);
    const row = await prisma.profileVersion.create({ data: { professionalId: req.professionalProfileId!, name, data: await snapshot(req.professionalProfileId!) } });
    return reply.code(201).send(serializeVersion(row));
  });
  app.post<{ Params: { id: string } }>('/pro/profile/versions/:id/restore', { ...pro, config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['professional'], summary: 'Restore a saved version (the current profile is kept as "Before restore")', security: [{ bearerAuth: [] }] } }, async (req) => {
    const ent = await entitlementsFor(req);
    assertFeature(ent, 'profile_versions');
    const v = await prisma.profileVersion.findFirst({ where: { id: req.params.id, professionalId: req.professionalProfileId! } });
    if (!v) throw notFound('NOT_FOUND', 'Version not found.');
    const data = z.object({ title: z.string().min(3).max(120), about: z.string().max(2000).nullable(), locationCity: z.string().max(120).nullable(), responseTimeLabel: z.string().max(60).nullable(), details: z.unknown(), skills: z.array(z.string().min(1).max(60)).max(15) }).parse(v.data);
    const current = await snapshot(req.professionalProfileId!);
    await prisma.$transaction(async (tx) => {
      await tx.professionalProfile.update({ where: { id: req.professionalProfileId! }, data: { title: data.title, about: data.about, locationCity: data.locationCity, responseTimeLabel: data.responseTimeLabel, details: (data.details ?? {}) as object } });
      await tx.professionalSkill.deleteMany({ where: { professionalId: req.professionalProfileId! } });
      if (data.skills.length) await tx.professionalSkill.createMany({ data: [...new Set(data.skills)].map((skill, i) => ({ professionalId: req.professionalProfileId!, skill, position: i })) });
      // Keep an automatic safety copy within the limit (replace an older automatic copy when full).
      const limit = ent.limits.profile_versions;
      const count = await tx.profileVersion.count({ where: { professionalId: req.professionalProfileId! } });
      if (limit === null || count < limit) await tx.profileVersion.create({ data: { professionalId: req.professionalProfileId!, name: 'Before restore', data: current } });
      else {
        const old = await tx.profileVersion.findFirst({ where: { professionalId: req.professionalProfileId!, name: 'Before restore' }, orderBy: { createdAt: 'asc' } });
        if (old) await tx.profileVersion.update({ where: { id: old.id }, data: { data: current, createdAt: new Date() } });
      }
      await audit(tx, { actorId: req.auth!.sub, action: 'profile.version_restored', entity: 'professional_profile', entityId: req.professionalProfileId!, data: { versionId: v.id } });
    });
    return { ok: true, restored: serializeVersion(v) };
  });
  app.delete<{ Params: { id: string } }>('/pro/profile/versions/:id', { ...pro, schema: { tags: ['professional'], summary: 'Delete a saved version', security: [{ bearerAuth: [] }] } }, async (req) => {
    const r = await prisma.profileVersion.deleteMany({ where: { id: req.params.id, professionalId: req.professionalProfileId! } });
    if (!r.count) throw notFound('NOT_FOUND', 'Version not found.');
    return { ok: true };
  });
}
