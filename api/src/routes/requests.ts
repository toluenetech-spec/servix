/**
 * Service Request marketplace (reverse marketplace) — flag REQUESTS_ENABLED.
 *
 * Customer: draft → publish → (pause/close/cancel) → award one proposal.
 * Professional: browse open requests, submit ONE live proposal per request
 *   (database partial unique index), edit/withdraw while submitted.
 * Award: request → awarded, other proposals → rejected, and a normal Booking is
 *   created in pending_payment with the proposal price as the immutable amount,
 *   attached to the gig the professional chose (or an auto-created hidden
 *   "Custom work" service). From there the existing pay → requested → accepted →
 *   … → completed pipeline, ledger, refunds, disputes and payouts run untouched.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/db.js';
import { requireAdmin, requireAuth, requireProfessional } from '../lib/authGuard.js';
import { ApiError, notFound } from '../lib/errors.js';
import { parseBody, parsePatchBody } from '../lib/query.js';
import { requireFeature } from '../lib/features.js';
import { notify, notifySafely } from '../lib/notifications.js';
import { audit } from '../lib/audit.js';
import { bookingRef } from '../lib/bookingService.js';
import { platformFeeKobo } from '../lib/refundPolicy.js';
import { mediaUrl } from '../lib/storage.js';
import { assertOwnMediaUrl } from './uploads.js';

const CUSTOM_WORK_SLUG_PREFIX = 'custom-work-';

const requestBody = z.object({
  title: z.string().trim().min(6, 'Give the request a clear title (at least 6 characters).').max(140),
  categorySlug: z.string().trim().min(1, 'Choose a category.').max(100),
  description: z.string().trim().max(5000).default(''),
  budgetType: z.enum(['fixed', 'range']).default('fixed'),
  budgetMin: z.number().int().min(0).max(100_000_000).nullable().optional(),
  budgetMax: z.number().int().min(0).max(100_000_000).nullable().optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
  preferredDeliveryAt: z.string().datetime().nullable().optional(),
  isRemote: z.boolean().default(true),
  location: z.string().trim().max(120).nullable().optional(),
  requiredSkills: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  attachments: z.array(z.object({ url: z.string().url(), name: z.string().trim().max(160) })).max(5).default([]),
  extraRequirements: z.string().trim().max(3000).nullable().optional(),
});

const proposalBody = z.object({
  cover: z.string().trim().min(30, 'Write at least a short paragraph (30 characters) about how you would approach this.').max(5000),
  price: z.number().int().min(1000, 'Minimum proposal is ₦1,000.').max(100_000_000),
  deliveryDays: z.number().int().min(1).max(365),
  milestones: z.array(z.object({ title: z.string().trim().min(2).max(120), amount: z.number().int().min(0).max(100_000_000).optional(), days: z.number().int().min(1).max(365).optional() })).max(10).default([]),
  attachments: z.array(z.object({ url: z.string().url(), name: z.string().trim().max(160) })).max(5).default([]),
  proposedStartAt: z.string().datetime().nullable().optional(),
  serviceSlug: z.string().trim().max(160).nullable().optional(),
});

const browseQuery = z.object({
  category: z.string().trim().max(100).optional(),
  minBudget: z.coerce.number().int().min(0).optional(),
  maxBudget: z.coerce.number().int().min(0).optional(),
  deadlineBefore: z.string().datetime().optional(),
  location: z.string().trim().max(100).optional(),
  remote: z.enum(['remote', 'onsite', 'any']).default('any'),
  skills: z.string().trim().max(300).optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(['newest', 'deadline', 'budget-high', 'budget-low']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

const requestInclude = { category: { select: { slug: true, name: true } }, customer: { select: { id: true, fullName: true, avatarUrl: true, createdAt: true } } } as const;
type RequestRow = Prisma.ServiceRequestGetPayload<{ include: typeof requestInclude }>;

const kobo = (naira: number | null | undefined) => (naira == null ? null : BigInt(naira) * 100n);
const naira = (k: bigint | null) => (k == null ? null : Number(k / 100n));

function serializeRequest(r: RequestRow, viewer: 'owner' | 'professional' | 'admin') {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    description: r.description,
    budgetType: r.budgetType,
    budgetMin: naira(r.budgetMinKobo),
    budgetMax: naira(r.budgetMaxKobo),
    deadlineAt: r.deadlineAt?.toISOString() ?? null,
    preferredDeliveryAt: r.preferredDeliveryAt?.toISOString() ?? null,
    isRemote: r.isRemote,
    location: r.location,
    requiredSkills: Array.isArray(r.requiredSkills) ? (r.requiredSkills as string[]) : [],
    attachments: viewer === 'professional' && r.status !== 'open' ? [] : ((r.attachments as { url: string; name: string }[]) ?? []).map((a) => ({ ...a, url: mediaUrl(a.url) })),
    extraRequirements: r.extraRequirements,
    status: r.status,
    proposalCount: r.proposalCount,
    awardedProposalId: viewer === 'professional' ? undefined : r.awardedProposalId,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    // Professionals see a first name + member-since only; owners/admins see the account.
    customer: viewer === 'professional'
      ? { displayName: r.customer.fullName.split(' ')[0], memberSince: r.customer.createdAt.toISOString().slice(0, 7) }
      : { id: r.customer.id, fullName: r.customer.fullName, avatarUrl: mediaUrl(r.customer.avatarUrl) },
  };
}

const proposalInclude = { professional: { select: { id: true, slug: true, name: true, title: true, imageUrl: true, ratingAvg: true, reviewCount: true, completedProjects: true, verification: true, user: { select: { kycStatus: true } } } }, service: { select: { slug: true, title: true } }, booking: { select: { id: true, reference: true, status: true } } } as const;
type ProposalRow = Prisma.ProposalGetPayload<{ include: typeof proposalInclude }>;

function serializeProposal(p: ProposalRow) {
  return {
    id: p.id,
    requestId: p.requestId,
    cover: p.cover,
    price: Number(p.priceKobo / 100n),
    deliveryDays: p.deliveryDays,
    milestones: p.milestones,
    attachments: ((p.attachments as { url: string; name: string }[]) ?? []).map((a) => ({ ...a, url: mediaUrl(a.url) })),
    proposedStartAt: p.proposedStartAt?.toISOString() ?? null,
    status: p.status,
    rejectedReason: p.rejectedReason,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    service: p.service ? { id: p.service.slug, title: p.service.title } : null,
    booking: p.booking ? { id: p.booking.id, reference: p.booking.reference, status: p.booking.status } : null,
    professional: { id: p.professional.slug, name: p.professional.name, title: p.professional.title, image: mediaUrl(p.professional.imageUrl), rating: Number(p.professional.ratingAvg), reviewCount: p.professional.reviewCount, completedProjects: p.professional.completedProjects, verified: p.professional.verification === 'verified', identityVerified: p.professional.user?.kycStatus === 'verified' },
  };
}

async function toRequestData(body: z.infer<typeof requestBody>, userId: string): Promise<Prisma.ServiceRequestUncheckedCreateInput> {
  const category = await prisma.category.findUnique({ where: { slug: body.categorySlug }, select: { id: true } });
  if (!category) throw new ApiError(422, 'VALIDATION_ERROR', 'Please check the highlighted fields.', { categorySlug: 'Choose a category.' });
  if (body.budgetType === 'range' && body.budgetMin != null && body.budgetMax != null && body.budgetMax < body.budgetMin) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Please check the highlighted fields.', { budgetMax: 'Maximum must be at least the minimum.' });
  }
  for (const a of body.attachments) assertOwnMediaUrl(a.url, 'attachments');
  return {
    customerId: userId,
    title: body.title,
    categoryId: category.id,
    description: body.description,
    budgetType: body.budgetType,
    budgetMinKobo: kobo(body.budgetType === 'fixed' ? body.budgetMax ?? body.budgetMin : body.budgetMin),
    budgetMaxKobo: kobo(body.budgetMax ?? (body.budgetType === 'fixed' ? body.budgetMin : null)),
    deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null,
    preferredDeliveryAt: body.preferredDeliveryAt ? new Date(body.preferredDeliveryAt) : null,
    isRemote: body.isRemote,
    location: body.location ?? null,
    requiredSkills: body.requiredSkills,
    attachments: body.attachments,
    extraRequirements: body.extraRequirements ?? null,
  };
}

function publishProblems(r: { title: string; description: string; budgetMaxKobo: bigint | null; budgetMinKobo: bigint | null; isRemote: boolean; location: string | null }) {
  const problems: Record<string, string> = {};
  if (r.title.trim().length < 6) problems.title = 'Add a clear title.';
  if (r.description.trim().length < 40) problems.description = 'Describe what you need in at least 40 characters so professionals can quote accurately.';
  if (r.budgetMaxKobo == null && r.budgetMinKobo == null) problems.budget = 'Give professionals a budget or a range.';
  if (!r.isRemote && !r.location) problems.location = 'On-site work needs a location.';
  return problems;
}

export async function requestRoutes(app: FastifyInstance) {
  const flag = requireFeature('requests');
  const customer = { preHandler: [flag, requireAuth] };
  const professional = { preHandler: [flag, requireProfessional] };
  const admin = { preHandler: [flag, requireAdmin] };
  const createLimit = { rateLimit: { max: 20, timeWindow: '10 minutes' } };

  async function ownRequest(id: string, userId: string) {
    const r = await prisma.serviceRequest.findFirst({ where: { id, customerId: userId }, include: requestInclude });
    if (!r) throw notFound('REQUEST_NOT_FOUND', 'Request not found');
    return r;
  }

  /* ================= customer ================= */

  app.get('/requests', { ...customer, schema: { tags: ['requests'], summary: 'My service requests', security: [{ bearerAuth: [] }] } }, async (req) => {
    const rows = await prisma.serviceRequest.findMany({ where: { customerId: req.auth!.sub }, orderBy: { updatedAt: 'desc' }, take: 100, include: requestInclude });
    return { items: rows.map((r) => serializeRequest(r, 'owner')) };
  });

  app.post('/requests', { ...customer, config: createLimit, schema: { tags: ['requests'], summary: 'Create a request (draft)', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    const body = parseBody(requestBody, req.body);
    const row = await prisma.serviceRequest.create({ data: await toRequestData(body, req.auth!.sub), include: requestInclude });
    return reply.code(201).send({ ...serializeRequest(row, 'owner'), publishProblems: publishProblems(row) });
  });

  app.get<{ Params: { id: string } }>('/requests/:id', { ...customer, schema: { tags: ['requests'], summary: 'One of my requests with publish checklist', security: [{ bearerAuth: [] }] } }, async (req) => {
    const r = await ownRequest(req.params.id, req.auth!.sub);
    return { ...serializeRequest(r, 'owner'), publishProblems: publishProblems(r) };
  });

  app.patch<{ Params: { id: string } }>('/requests/:id', { ...customer, schema: { tags: ['requests'], summary: 'Edit a draft/open/paused request', security: [{ bearerAuth: [] }] } }, async (req) => {
    const r = await ownRequest(req.params.id, req.auth!.sub);
    if (!['draft', 'open', 'paused'].includes(r.status)) throw new ApiError(409, 'REQUEST_LOCKED', 'This request can no longer be edited.');
    const patch = parsePatchBody(requestBody, req.body);
    const merged = requestBody.parse({ ...serializeRequestForMerge(r), ...patch });
    const data = await toRequestData(merged, req.auth!.sub);
    const row = await prisma.serviceRequest.update({ where: { id: r.id }, data, include: requestInclude });
    return { ...serializeRequest(row, 'owner'), publishProblems: publishProblems(row) };
  });

  const transitions: Record<string, { from: string[]; to: 'open' | 'paused' | 'closed' | 'cancelled'; summary: string }> = {
    publish: { from: ['draft', 'paused'], to: 'open', summary: 'Publish a request so professionals can propose' },
    pause: { from: ['open'], to: 'paused', summary: 'Pause a request (hidden from browse, proposals kept)' },
    close: { from: ['open', 'paused'], to: 'closed', summary: 'Close a request without awarding' },
    cancel: { from: ['draft', 'open', 'paused'], to: 'cancelled', summary: 'Cancel (withdraw) a request' },
  };
  for (const [action, t] of Object.entries(transitions)) {
    app.post<{ Params: { id: string } }>(`/requests/:id/${action}`, { ...customer, schema: { tags: ['requests'], summary: t.summary, security: [{ bearerAuth: [] }] } }, async (req) => {
      const r = await ownRequest(req.params.id, req.auth!.sub);
      if (action === 'publish') {
        const problems = publishProblems(r);
        if (Object.keys(problems).length) throw new ApiError(422, 'REQUEST_INCOMPLETE', 'Complete the request before publishing.', problems);
      }
      const result = await prisma.serviceRequest.updateMany({ where: { id: r.id, status: { in: t.from as never } }, data: { status: t.to, ...(t.to === 'open' && !r.publishedAt ? { publishedAt: new Date() } : {}), ...(['closed', 'cancelled'].includes(t.to) ? { closedAt: new Date() } : {}) } });
      if (result.count === 0) throw new ApiError(409, 'INVALID_TRANSITION', `A ${r.status} request cannot be ${t.to}.`);
      await audit(prisma, { actorId: req.auth!.sub, action: `request.${action}`, entity: 'service_request', entityId: r.id, ip: req.ip });
      if (['closed', 'cancelled'].includes(t.to)) {
        const live = await prisma.proposal.findMany({ where: { requestId: r.id, status: 'submitted' }, select: { id: true, professional: { select: { userId: true } } } });
        await prisma.proposal.updateMany({ where: { requestId: r.id, status: 'submitted' }, data: { status: 'rejected', rejectedReason: 'Request closed by the customer.' } });
        for (const p of live) if (p.professional.userId) await notifySafely({ userId: p.professional.userId, type: 'request.closed', title: 'A request you proposed on was closed', body: `"${r.title}" is no longer open.`, link: '/dashboard/proposals' });
      }
      const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id }, include: requestInclude });
      return { ...serializeRequest(row, 'owner'), publishProblems: publishProblems(row) };
    });
  }

  app.get<{ Params: { id: string } }>('/requests/:id/proposals', { ...customer, schema: { tags: ['requests'], summary: 'Proposals received on my request (comparison data)', security: [{ bearerAuth: [] }] } }, async (req) => {
    const r = await ownRequest(req.params.id, req.auth!.sub);
    const rows = await prisma.proposal.findMany({ where: { requestId: r.id, status: { not: 'withdrawn' } }, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }], include: proposalInclude });
    return { request: serializeRequest(r, 'owner'), items: rows.map(serializeProposal) };
  });

  app.post<{ Params: { id: string; pid: string } }>('/requests/:id/proposals/:pid/reject', { ...customer, schema: { tags: ['requests'], summary: 'Reject a proposal', security: [{ bearerAuth: [] }] } }, async (req) => {
    const r = await ownRequest(req.params.id, req.auth!.sub);
    const { reason } = parseBody(z.object({ reason: z.string().trim().max(500).optional() }), req.body ?? {});
    const result = await prisma.proposal.updateMany({ where: { id: req.params.pid, requestId: r.id, status: 'submitted' }, data: { status: 'rejected', rejectedReason: reason ?? null } });
    if (result.count === 0) throw new ApiError(409, 'INVALID_TRANSITION', 'Only submitted proposals can be rejected.');
    const p = await prisma.proposal.findUniqueOrThrow({ where: { id: req.params.pid }, include: proposalInclude });
    const owner = await prisma.professionalProfile.findUnique({ where: { id: p.professionalId }, select: { userId: true } });
    if (owner?.userId) await notifySafely({ userId: owner.userId, type: 'proposal.rejected', title: 'Your proposal was not selected', body: `"${r.title}"${reason ? ` — ${reason}` : ''}`, link: '/dashboard/proposals' });
    return serializeProposal(p);
  });

  /** Award: transactional, idempotent per request (status CAS), creates the booking. */
  app.post<{ Params: { id: string; pid: string } }>('/requests/:id/proposals/:pid/accept', { ...customer, config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['requests'], summary: 'Accept a proposal → request awarded, booking created (pending payment)', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    const { scheduledAt } = parseBody(z.object({ scheduledAt: z.string().datetime().optional() }), req.body ?? {});
    const userId = req.auth!.sub;
    const outcome = await prisma.$transaction(async (tx) => {
      const r = await tx.serviceRequest.findFirst({ where: { id: req.params.id, customerId: userId } });
      if (!r) throw notFound('REQUEST_NOT_FOUND', 'Request not found');
      const p = await tx.proposal.findFirst({ where: { id: req.params.pid, requestId: r.id }, include: { professional: { select: { id: true, userId: true, slug: true, categoryId: true } }, service: true } });
      if (!p) throw notFound('PROPOSAL_NOT_FOUND', 'Proposal not found');
      if (p.status !== 'submitted') throw new ApiError(409, 'INVALID_TRANSITION', `This proposal is ${p.status}.`);
      if (p.professional.userId === userId) throw new ApiError(409, 'OWN_PROPOSAL', 'You cannot award your own proposal.');
      // CAS on the request so two simultaneous accepts cannot both win.
      const awarded = await tx.serviceRequest.updateMany({ where: { id: r.id, status: { in: ['open', 'paused'] } }, data: { status: 'awarded', awardedProposalId: p.id, closedAt: new Date() } });
      if (awarded.count === 0) throw new ApiError(409, 'INVALID_TRANSITION', 'This request has already been awarded or closed.');
      await tx.proposal.update({ where: { id: p.id }, data: { status: 'accepted' } });
      const losers = await tx.proposal.findMany({ where: { requestId: r.id, status: 'submitted' }, select: { professional: { select: { userId: true } } } });
      await tx.proposal.updateMany({ where: { requestId: r.id, status: 'submitted' }, data: { status: 'rejected', rejectedReason: 'Another proposal was accepted.' } });
      // Service to attach: the professional's chosen gig, or a hidden "Custom work" service.
      let service = p.service && p.service.status === 'active' ? p.service : null;
      if (!service) {
        const slug = `${CUSTOM_WORK_SLUG_PREFIX}${p.professional.slug}`;
        service = await tx.service.upsert({
          where: { slug },
          create: { slug, professionalId: p.professional.id, categoryId: r.categoryId, title: 'Custom work (from a request)', shortDescription: 'Work agreed through a Servix request and proposal.', description: 'This service exists to carry bookings awarded through the request marketplace. Each booking stores its own agreed price.', price: p.priceKobo / 100n, priceUnit: 'project', status: 'archived', included: [], requirements: [], searchTags: [] },
          update: {},
        });
      }
      const amountKobo = p.priceKobo;
      const start = scheduledAt ? new Date(scheduledAt) : p.proposedStartAt ?? new Date(Date.now() + 86_400_000);
      const booking = await tx.booking.create({ data: {
        reference: bookingRef(), customerId: userId, professionalId: p.professional.id, serviceId: service.id, scheduledAt: start,
        amountKobo, platformFeeKobo: platformFeeKobo(amountKobo), serviceTitle: `${r.title} (proposal)`, priceUnit: 'project',
        notes: `Awarded from request "${r.title}". Proposal: ${p.cover.slice(0, 500)}`, proposalId: p.id,
        expectedDeliveryAt: new Date(start.getTime() + p.deliveryDays * 86_400_000),
        events: { create: { actorId: userId, event: 'created', data: { source: 'request', requestId: r.id, proposalId: p.id } } },
      } });
      await audit(tx, { actorId: userId, action: 'request.awarded', entity: 'service_request', entityId: r.id, data: { proposalId: p.id, bookingId: booking.id, amountKobo: amountKobo.toString() }, ip: req.ip });
      if (p.professional.userId) await notify(tx, { userId: p.professional.userId, type: 'proposal.accepted', title: 'Your proposal was accepted', body: `"${r.title}" — the customer is completing payment to start the booking.`, link: `/bookings/${booking.id}` });
      return { booking, losers: losers.map((l) => l.professional.userId).filter(Boolean) as string[], title: r.title };
    });
    for (const uid of outcome.losers) await notifySafely({ userId: uid, type: 'proposal.rejected', title: 'Your proposal was not selected', body: `"${outcome.title}" was awarded to another professional.`, link: '/dashboard/proposals' });
    return reply.code(201).send({ bookingId: outcome.booking.id, reference: outcome.booking.reference, status: outcome.booking.status, next: `/bookings/${outcome.booking.id}` });
  });

  /* ================= professional ================= */

  app.get('/requests/browse', { ...professional, schema: { tags: ['requests'], summary: 'Open requests for professionals (filters + sorts)', security: [{ bearerAuth: [] }] } }, async (req) => {
    const q = browseQuery.parse(req.query ?? {});
    const where: Prisma.ServiceRequestWhereInput = { status: 'open', customerId: { not: req.auth!.sub } };
    if (q.category) where.category = { slug: q.category };
    if (q.minBudget != null) where.OR = [{ budgetMaxKobo: { gte: kobo(q.minBudget)! } }, { budgetMaxKobo: null, budgetMinKobo: { gte: kobo(q.minBudget)! } }];
    if (q.maxBudget != null) where.budgetMinKobo = { lte: kobo(q.maxBudget)! };
    if (q.deadlineBefore) where.deadlineAt = { lte: new Date(q.deadlineBefore) };
    if (q.location) where.location = { contains: q.location, mode: 'insensitive' };
    if (q.remote === 'remote') where.isRemote = true;
    if (q.remote === 'onsite') where.isRemote = false;
    if (q.q) where.AND = [{ OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] }];
    if (q.skills) where.requiredSkills = { array_contains: q.skills.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 1) };
    const orderBy: Prisma.ServiceRequestOrderByWithRelationInput[] = q.sort === 'deadline' ? [{ deadlineAt: { sort: 'asc', nulls: 'last' } }] : q.sort === 'budget-high' ? [{ budgetMaxKobo: { sort: 'desc', nulls: 'last' } }] : q.sort === 'budget-low' ? [{ budgetMinKobo: { sort: 'asc', nulls: 'last' } }] : [{ publishedAt: 'desc' }];
    const [total, rows, mine] = await Promise.all([
      prisma.serviceRequest.count({ where }),
      prisma.serviceRequest.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: requestInclude }),
      prisma.proposal.findMany({ where: { professionalId: req.professionalProfileId!, status: { in: ['submitted', 'accepted'] } }, select: { requestId: true, id: true, status: true } }),
    ]);
    const mineByRequest = new Map(mine.map((m) => [m.requestId, m]));
    return { items: rows.map((r) => ({ ...serializeRequest(r, 'professional'), myProposal: mineByRequest.get(r.id) ?? null })), total, page: q.page, pageSize: q.pageSize };
  });

  app.get<{ Params: { id: string } }>('/requests/browse/:id', { ...professional, schema: { tags: ['requests'], summary: 'One open request (professional view)', security: [{ bearerAuth: [] }] } }, async (req) => {
    const r = await prisma.serviceRequest.findFirst({ where: { id: req.params.id, status: { in: ['open', 'paused', 'awarded', 'closed'] } }, include: requestInclude });
    if (!r) throw notFound('REQUEST_NOT_FOUND', 'Request not found');
    const mine = await prisma.proposal.findFirst({ where: { requestId: r.id, professionalId: req.professionalProfileId! }, orderBy: { createdAt: 'desc' }, include: proposalInclude });
    const services = await prisma.service.findMany({ where: { professionalId: req.professionalProfileId!, status: 'active' }, select: { slug: true, title: true } });
    return { ...serializeRequest(r, 'professional'), myProposal: mine ? serializeProposal(mine) : null, myServices: services.map((s) => ({ id: s.slug, title: s.title })) };
  });

  app.post<{ Params: { id: string } }>('/requests/:id/proposals', { ...professional, config: createLimit, schema: { tags: ['requests'], summary: 'Submit a proposal (one live proposal per request)', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    const body = parseBody(proposalBody, req.body);
    const r = await prisma.serviceRequest.findFirst({ where: { id: req.params.id, status: 'open' }, include: requestInclude });
    if (!r) throw new ApiError(409, 'REQUEST_NOT_OPEN', 'This request is not accepting proposals.');
    if (r.customerId === req.auth!.sub) throw new ApiError(409, 'OWN_REQUEST', 'You cannot propose on your own request.');
    const service = body.serviceSlug ? await prisma.service.findFirst({ where: { slug: body.serviceSlug, professionalId: req.professionalProfileId!, status: 'active' }, select: { id: true } }) : null;
    if (body.serviceSlug && !service) throw new ApiError(422, 'VALIDATION_ERROR', 'Please check the highlighted fields.', { serviceSlug: 'Choose one of your active gigs.' });
    for (const a of body.attachments) assertOwnMediaUrl(a.url, 'attachments');
    try {
      const created = await prisma.$transaction(async (tx) => {
        const p = await tx.proposal.create({ data: { requestId: r.id, professionalId: req.professionalProfileId!, serviceId: service?.id ?? null, cover: body.cover, priceKobo: BigInt(body.price) * 100n, deliveryDays: body.deliveryDays, milestones: body.milestones, attachments: body.attachments, proposedStartAt: body.proposedStartAt ? new Date(body.proposedStartAt) : null }, include: proposalInclude });
        await tx.serviceRequest.update({ where: { id: r.id }, data: { proposalCount: { increment: 1 } } });
        await notify(tx, { userId: r.customerId, type: 'proposal.new', title: 'New proposal on your request', body: `${p.professional.name} proposed ₦${body.price.toLocaleString('en-NG')} for "${r.title}".`, link: `/dashboard/requests/${r.id}` });
        return p;
      });
      return reply.code(201).send(serializeProposal(created));
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ApiError(409, 'PROPOSAL_EXISTS', 'You already have a live proposal on this request. Edit or withdraw it instead.');
      throw err;
    }
  });

  app.get('/proposals/mine', { ...professional, schema: { tags: ['requests'], summary: 'My proposals', security: [{ bearerAuth: [] }] } }, async (req) => {
    const rows = await prisma.proposal.findMany({ where: { professionalId: req.professionalProfileId! }, orderBy: { updatedAt: 'desc' }, take: 100, include: { ...proposalInclude, request: { include: requestInclude } } });
    return { items: rows.map((p) => ({ ...serializeProposal(p), request: serializeRequest(p.request, 'professional') })) };
  });

  app.patch<{ Params: { id: string } }>('/proposals/:id', { ...professional, schema: { tags: ['requests'], summary: 'Edit a submitted proposal', security: [{ bearerAuth: [] }] } }, async (req) => {
    const p = await prisma.proposal.findFirst({ where: { id: req.params.id, professionalId: req.professionalProfileId! }, include: { request: { select: { status: true } } } });
    if (!p) throw notFound('PROPOSAL_NOT_FOUND', 'Proposal not found');
    if (p.status !== 'submitted' || p.request.status !== 'open') throw new ApiError(409, 'PROPOSAL_LOCKED', 'This proposal can no longer be edited.');
    const patch = parsePatchBody(proposalBody, req.body);
    for (const a of patch.attachments ?? []) assertOwnMediaUrl(a.url, 'attachments');
    const row = await prisma.proposal.update({ where: { id: p.id }, data: {
      ...(patch.cover !== undefined ? { cover: patch.cover } : {}), ...(patch.price !== undefined ? { priceKobo: BigInt(patch.price) * 100n } : {}), ...(patch.deliveryDays !== undefined ? { deliveryDays: patch.deliveryDays } : {}),
      ...(patch.milestones !== undefined ? { milestones: patch.milestones } : {}), ...(patch.attachments !== undefined ? { attachments: patch.attachments } : {}), ...(patch.proposedStartAt !== undefined ? { proposedStartAt: patch.proposedStartAt ? new Date(patch.proposedStartAt) : null } : {}),
    }, include: proposalInclude });
    return serializeProposal(row);
  });

  app.post<{ Params: { id: string } }>('/proposals/:id/withdraw', { ...professional, schema: { tags: ['requests'], summary: 'Withdraw a submitted proposal', security: [{ bearerAuth: [] }] } }, async (req) => {
    const result = await prisma.proposal.updateMany({ where: { id: req.params.id, professionalId: req.professionalProfileId!, status: 'submitted' }, data: { status: 'withdrawn' } });
    if (result.count === 0) throw new ApiError(409, 'INVALID_TRANSITION', 'Only submitted proposals can be withdrawn.');
    const p = await prisma.proposal.findUniqueOrThrow({ where: { id: req.params.id }, include: proposalInclude });
    await prisma.serviceRequest.update({ where: { id: p.requestId }, data: { proposalCount: { decrement: 1 } } });
    return serializeProposal(p);
  });

  /* ================= admin ================= */

  app.get('/admin/requests', { ...admin, schema: { tags: ['admin'], summary: 'All service requests', security: [{ bearerAuth: [] }] } }, async (req) => {
    const q = z.object({ q: z.string().trim().max(120).optional(), status: z.enum(['draft', 'open', 'paused', 'closed', 'awarded', 'cancelled']).optional(), category: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query ?? {});
    const where: Prisma.ServiceRequestWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.category) where.category = { slug: q.category };
    if (q.q) where.OR = [{ title: { contains: q.q, mode: 'insensitive' } }, { customer: { email: { contains: q.q, mode: 'insensitive' } } }, { customer: { fullName: { contains: q.q, mode: 'insensitive' } } }];
    const [total, rows] = await Promise.all([prisma.serviceRequest.count({ where }), prisma.serviceRequest.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { ...requestInclude, customer: { select: { id: true, fullName: true, avatarUrl: true, createdAt: true, email: true } } } })]);
    return { items: rows.map((r) => ({ ...serializeRequest(r, 'admin'), customer: { ...serializeRequest(r, 'admin').customer, email: r.customer.email } })), total, page: q.page, pageSize: q.pageSize };
  });

  app.get('/admin/proposals', { ...admin, schema: { tags: ['admin'], summary: 'All proposals', security: [{ bearerAuth: [] }] } }, async (req) => {
    const q = z.object({ q: z.string().trim().max(120).optional(), status: z.enum(['submitted', 'withdrawn', 'rejected', 'accepted']).optional(), requestId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query ?? {});
    const where: Prisma.ProposalWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.requestId) where.requestId = q.requestId;
    if (q.q) where.OR = [{ request: { title: { contains: q.q, mode: 'insensitive' } } }, { professional: { name: { contains: q.q, mode: 'insensitive' } } }, { request: { customer: { email: { contains: q.q, mode: 'insensitive' } } } }];
    const [total, rows] = await Promise.all([prisma.proposal.count({ where }), prisma.proposal.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { ...proposalInclude, request: { include: requestInclude } } })]);
    return { items: rows.map((p) => ({ ...serializeProposal(p), request: { id: p.request.id, title: p.request.title, status: p.request.status, customer: { id: p.request.customer.id, fullName: p.request.customer.fullName } } })), total, page: q.page, pageSize: q.pageSize };
  });
}

/** Turns a stored row back into the editable body shape so PATCH can merge. */
function serializeRequestForMerge(r: RequestRow): z.infer<typeof requestBody> {
  return {
    title: r.title, categorySlug: r.category.slug, description: r.description, budgetType: r.budgetType,
    budgetMin: naira(r.budgetMinKobo), budgetMax: naira(r.budgetMaxKobo),
    deadlineAt: r.deadlineAt?.toISOString() ?? null, preferredDeliveryAt: r.preferredDeliveryAt?.toISOString() ?? null,
    isRemote: r.isRemote, location: r.location, requiredSkills: Array.isArray(r.requiredSkills) ? (r.requiredSkills as string[]) : [],
    attachments: (r.attachments as { url: string; name: string }[]) ?? [], extraRequirements: r.extraRequirements,
  };
}
