import { mediaUrl } from '../lib/storage.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertOwnMediaUrl } from './uploads.js';
import { prisma } from '../lib/db.js';
import { notifySafely } from '../lib/notifications.js';
import { requireAuth } from '../lib/authGuard.js';
import { entitlementsFor, assertWithinLimit } from '../lib/entitlements/index.js';
import { ApiError } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { accountOverview, ONBOARDING_ACTION } from '../lib/accountOverview.js';
import { audit } from '../lib/audit.js';
export async function accountRoutes(app: FastifyInstance) {
  app.patch('/account/profile', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const body = parseBody(z.object({ fullName: z.string().trim().min(2).max(200).optional(), avatarUrl: z.string().trim().max(500).nullable().optional() }).strict(), req.body);
    if (body.fullName === undefined && body.avatarUrl === undefined) throw new ApiError(422, 'VALIDATION_ERROR', 'Nothing to update.');
    if (body.avatarUrl) assertOwnMediaUrl(body.avatarUrl, 'Profile photo');
    await accountOverview(req.auth!.sub);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: req.auth!.sub }, data: { fullName: body.fullName, avatarUrl: body.avatarUrl === undefined ? undefined : body.avatarUrl || null } });
      // Keep the public professional card in step with the account photo unless the pro set a dedicated one during onboarding.
      if (body.avatarUrl !== undefined) {
        await tx.professionalProfile.updateMany({ where: { userId: req.auth!.sub }, data: { imageUrl: body.avatarUrl || null } });
      }
    });
    return { ok: true };
  });
  app.get('/account/security-summary', { preHandler: requireAuth }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); const id = req.auth!.sub;
    await accountOverview(id);
    const [security, recoveryCodesRemaining, passkeys] = await Promise.all([
      prisma.accountSecurity.findUnique({ where: { userId: id }, select: { method: true } }),
      prisma.recoveryCode.count({ where: { userId: id, usedAt: null } }),
      prisma.passkeyCredential.count({ where: { userId: id } }),
    ]);
    return { method: security?.method ?? null, recoveryCodesRemaining, passkeys };
  });
  app.get('/account/payments', { preHandler: requireAuth }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); await accountOverview(req.auth!.sub);
    const records = await prisma.payment.findMany({ where: { booking: { customerId: req.auth!.sub } }, orderBy: { createdAt: 'desc' }, take: 100, include: { booking: { select: { id: true, reference: true, serviceTitle: true } } } });
    return { mode: process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_') && process.env.PAYMENT_MODE !== 'sandbox' ? 'live' : 'test', records: records.map(p => ({ id: p.id, reference: p.reference, amount: Number(p.amountKobo) / 100, currency: p.currency, status: p.status, createdAt: p.createdAt, booking: p.booking })) };
  });
  /* ---------------- notifications ---------------- */
  app.get('/account/notifications', { preHandler: requireAuth }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); const id = req.auth!.sub; await accountOverview(id);
    const q = parseBody(z.object({ before: z.string().uuid().optional(), unread: z.enum(['1']).optional() }), req.query);
    if (q.before && !await prisma.notification.findFirst({ where: { id: q.before, userId: id }, select: { id: true } })) throw new ApiError(404, 'NOT_FOUND', 'Unknown notification.');
    const rows = await prisma.notification.findMany({ where: { userId: id, ...(q.unread ? { readAt: null } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30, ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}) });
    const unread = await prisma.notification.count({ where: { userId: id, readAt: null } });
    return { unread, before: rows.length === 30 ? rows[rows.length - 1]!.id : null, items: rows.map(n => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.readAt, createdAt: n.createdAt })) };
  });
  app.get('/account/notifications/unread', { preHandler: requireAuth }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); await accountOverview(req.auth!.sub);
    return { unread: await prisma.notification.count({ where: { userId: req.auth!.sub, readAt: null } }) };
  });
  app.post('/account/notifications/read', { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); const id = req.auth!.sub; await accountOverview(id);
    const body = parseBody(z.object({ ids: z.array(z.string().uuid()).min(1).max(100).optional(), all: z.literal(true).optional() }).strict(), req.body ?? {});
    if (!body.ids && !body.all) throw new ApiError(422, 'VALIDATION_ERROR', 'Provide ids or all.');
    const result = await prisma.notification.updateMany({ where: { userId: id, readAt: null, ...(body.ids ? { id: { in: body.ids } } : {}) }, data: { readAt: new Date() } });
    return { updated: result.count, unread: await prisma.notification.count({ where: { userId: id, readAt: null } }) };
  });
  /* ---------------- saved professionals ---------------- */
  const savedSelect = { id: true, createdAt: true, preferred: true, note: true, professional: { select: { slug: true, name: true, title: true, imageUrl: true, locationCity: true, ratingAvg: true, reviewCount: true, verification: true, availability: true, startingPrice: true, currency: true } } } as const;
  const serializeSaved = (row: { id: string; createdAt: Date; preferred?: boolean; note?: string | null; professional: { slug: string; name: string; title: string; imageUrl: string | null; locationCity: string | null; ratingAvg: unknown; reviewCount: number; verification: string; availability: string; startingPrice: bigint | null; currency: string } }) => ({ id: row.id, savedAt: row.createdAt, preferred: Boolean(row.preferred), note: row.note ?? '', professional: { ...row.professional, imageUrl: mediaUrl(row.professional.imageUrl), ratingAvg: Number(row.professional.ratingAvg), startingPrice: row.professional.startingPrice === null ? null : Number(row.professional.startingPrice) } });
  app.get('/account/saved', { preHandler: requireAuth }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); await accountOverview(req.auth!.sub);
    const rows = await prisma.savedProfessional.findMany({ where: { userId: req.auth!.sub }, orderBy: { createdAt: 'desc' }, take: 200, select: savedSelect });
    return rows.map(serializeSaved);
  });
  app.post('/account/saved', { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); await accountOverview(req.auth!.sub);
    const { profileSlug } = parseBody(z.object({ profileSlug: z.string().min(1).max(160) }).strict(), req.body);
    const profile = await prisma.professionalProfile.findUnique({ where: { slug: profileSlug }, select: { id: true, userId: true } });
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'No professional found.');
    if (profile.userId === req.auth!.sub) throw new ApiError(400, 'VALIDATION_ERROR', 'You cannot save your own profile.');
    const already = await prisma.savedProfessional.findUnique({ where: { userId_professionalId: { userId: req.auth!.sub, professionalId: profile.id } }, select: { id: true } });
    if (!already) assertWithinLimit(await entitlementsFor(req), 'saved_professionals', await prisma.savedProfessional.count({ where: { userId: req.auth!.sub } }), 1);
    const row = await prisma.savedProfessional.upsert({ where: { userId_professionalId: { userId: req.auth!.sub, professionalId: profile.id } }, create: { userId: req.auth!.sub, professionalId: profile.id }, update: {}, select: savedSelect });
    return serializeSaved(row);
  });
  app.patch('/account/saved/:slug', { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['account'], summary: 'Mark a saved professional as preferred / add a private note', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); await accountOverview(req.auth!.sub);
    const { slug } = req.params as { slug: string };
    const body = parseBody(z.object({ preferred: z.boolean().optional(), note: z.string().trim().max(500).optional() }).strict(), req.body ?? {});
    const profile = await prisma.professionalProfile.findUnique({ where: { slug }, select: { id: true, userId: true } });
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'No professional found.');
    if (profile.userId === req.auth!.sub) throw new ApiError(400, 'VALIDATION_ERROR', 'You cannot save your own profile.');
    const already = await prisma.savedProfessional.findUnique({ where: { userId_professionalId: { userId: req.auth!.sub, professionalId: profile.id } }, select: { id: true } });
    if (!already) assertWithinLimit(await entitlementsFor(req), 'saved_professionals', await prisma.savedProfessional.count({ where: { userId: req.auth!.sub } }), 1);
    const row = await prisma.savedProfessional.upsert({ where: { userId_professionalId: { userId: req.auth!.sub, professionalId: profile.id } }, create: { userId: req.auth!.sub, professionalId: profile.id, preferred: body.preferred ?? false, note: body.note ?? null }, update: { ...(body.preferred === undefined ? {} : { preferred: body.preferred }), ...(body.note === undefined ? {} : { note: body.note || null }) }, select: savedSelect });
    if (body.preferred && profile.userId) await notifySafely({ userId: profile.userId, type: 'professional.preferred', title: 'A customer marked you as a preferred professional', body: 'They can rebook you in one tap from their saved list.', link: '/dashboard/analytics' });
    return serializeSaved(row);
  });
  app.delete('/account/saved/:slug', { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); await accountOverview(req.auth!.sub);
    const { slug } = req.params as { slug: string };
    const result = await prisma.savedProfessional.deleteMany({ where: { userId: req.auth!.sub, professional: { slug } } });
    return { removed: result.count };
  });
  /* ---------------- customer activity summary (real records only) ---------------- */
  app.get('/account/insights', { preHandler: requireAuth }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store'); const id = req.auth!.sub; await accountOverview(id);
    const since = new Date(Date.now() - 365 * 86_400_000);
    const [bookings, payments, upcoming, reviews] = await Promise.all([
      prisma.booking.groupBy({ by: ['status'], where: { customerId: id }, _count: true }),
      prisma.payment.findMany({ where: { booking: { customerId: id }, status: { in: ['captured', 'refunded'] }, createdAt: { gte: since } }, select: { amountKobo: true, status: true, createdAt: true } }),
      prisma.booking.findMany({ where: { customerId: id, status: { in: ['requested', 'accepted', 'in_progress'] }, scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: 'asc' }, take: 5, select: { id: true, reference: true, serviceTitle: true, scheduledAt: true, status: true } }),
      prisma.booking.count({ where: { customerId: id, status: 'completed', review: null } }),
    ]);
    const months: Record<string, { spent: number; refunded: number }> = {};
    for (let i = 11; i >= 0; i--) { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months[d.toISOString().slice(0, 7)] = { spent: 0, refunded: 0 }; }
    for (const p of payments) { const k = p.createdAt.toISOString().slice(0, 7); if (!months[k]) continue; const n = Number(p.amountKobo) / 100; if (p.status === 'refunded') months[k].refunded += n; else months[k].spent += n; }
    return { statusCounts: Object.fromEntries(bookings.map(b => [b.status, b._count])), monthly: Object.entries(months).map(([month, v]) => ({ month, ...v })), upcoming, pendingReviews: reviews };
  });
  app.get('/account/overview', { preHandler: requireAuth }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return accountOverview(req.auth!.sub);
  });
  app.post('/account/onboarding', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { intent } = parseBody(z.object({ intent: z.enum(['customer', 'professional']) }).strict(), req.body);
    const userId = req.auth!.sub;
    return prisma.$transaction(async tx => {
      // Serialise first-choice writes across tabs. This is a preference, never a role grant.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const state = await accountOverview(userId, tx);
      if (!state.emailVerified) throw new ApiError(403, 'EMAIL_UNVERIFIED', 'Verify your email before choosing your account path.');
      if (!state.needsChoice) return state;
      await audit(tx, { actorId: userId, entity: 'user', entityId: userId, action: ONBOARDING_ACTION, data: { intent } });
      return accountOverview(userId, tx);
    });
  });
}
