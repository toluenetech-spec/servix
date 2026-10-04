/**
 * Servix AI — admin-only READ tools.
 *
 * Platform administrators asked Servix AI to see "everything except payments" so it can answer
 * operational questions ("who created a gig today?", "what is waiting for review?"). Rules:
 *  - Every tool is a bounded read; none writes, approves, suspends, pays or messages anyone.
 *  - Money rails are out of scope by design: no payments, payouts, ledger, wallets or refund data.
 *    Listing prices and request budgets are catalogue facts and are included; booking amounts are not.
 *  - Identity documents and ID numbers are never returned — only the review status.
 *  - `buildToolRunner` only exposes these tools when the caller's role (re-read from the DB) is `admin`.
 */
import { prisma } from '../lib/db.js';
import { publishProblems } from '../routes/pro.js';
import { clampText, normalizeEnum, normalizeInt } from './normalize.js';
import { sinceFrom } from './since.js';
export { sinceFrom } from './since.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const naira = (v: bigint | number | null | undefined) => (v == null ? null : Number(v));
const koboToNaira = (v: bigint | number | null | undefined) => (v == null ? null : Math.round(Number(v) / 100));
const take = (v: unknown, fallback = 20) => normalizeInt(v, 1, 50) ?? fallback;
const search = (q: unknown, fields: string[]) => {
  const text = clampText(q, 120);
  return text ? { OR: fields.map((f) => ({ [f]: { contains: text, mode: 'insensitive' as const } })) } : {};
};

export const adminOverview = async () => {
  const now = new Date(); const today = sinceFrom('today', now)!; const week = sinceFrom('7d', now)!;
  const [users, usersToday, usersWeek, pros, services, servicesToday, applications, kyc, bookings, disputes, requests, proposalsPending] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, createdAt: { gte: today } } }),
    prisma.user.count({ where: { deletedAt: null, createdAt: { gte: week } } }),
    prisma.professionalProfile.count(),
    prisma.service.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.service.count({ where: { createdAt: { gte: today } } }),
    prisma.professionalApplication.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.user.groupBy({ by: ['kycStatus'], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.booking.count({ where: { status: 'disputed' } }),
    prisma.serviceRequest.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.proposal.count({ where: { status: 'submitted' } }),
  ]);
  const byStatus = (rows: Array<{ status: string; _count: { _all: number } }>) => Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  return {
    asOf: now.toISOString(), timezoneNote: '"today" means the Lagos calendar day.',
    users: { total: users, newToday: usersToday, newLast7Days: usersWeek, professionals: pros },
    gigs: { byStatus: byStatus(services), createdToday: servicesToday },
    professionalApplications: byStatus(applications),
    identityVerifications: Object.fromEntries(kyc.map((r) => [r.kycStatus, r._count._all])),
    bookings: { byStatus: byStatus(bookings), openDisputes: disputes, note: 'Amounts, payments and payouts are not available to Servix AI — use Admin → Bookings / Payouts.' },
    requests: { byStatus: byStatus(requests), proposalsAwaitingDecision: proposalsPending },
  };
};

export const ADMIN_TOOL_DEFS = [
  {
    name: 'admin_overview',
    description: 'Platform snapshot for admins: user counts (total, new today, new this week), gigs by status and created today, applications, identity checks, bookings by status, open disputes and requests. No money figures.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => adminOverview(),
  },
  {
    name: 'admin_list_gigs',
    description: 'List gigs/services across the whole platform with who created them. Filter by status (draft, pending_review, active, paused, archived), creation time ("today", "yesterday", "7d", "30d" or an ISO date), free text, or the professional\'s name/email. Returns owner name + email, identity (KYC) status, category, price, timestamps and what still blocks publishing.',
    parameters: { type: 'object', properties: {
      status: { type: 'string', enum: ['draft', 'pending_review', 'active', 'paused', 'archived'] },
      createdSince: { type: 'string', description: '"today", "yesterday", "7d", "30d" or ISO date' },
      updatedSince: { type: 'string' },
      q: { type: 'string', description: 'words in the gig title or short description' },
      professional: { type: 'string', description: 'professional name or account email' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }, additionalProperties: false },
    run: async (args: Record<string, unknown>) => {
      const status = normalizeEnum(args.status, ['draft', 'pending_review', 'active', 'paused', 'archived'] as const);
      const createdSince = sinceFrom(args.createdSince); const updatedSince = sinceFrom(args.updatedSince);
      const pro = clampText(args.professional, 120);
      const where = {
        ...(status ? { status } : {}),
        ...(createdSince ? { createdAt: { gte: createdSince } } : {}),
        ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
        ...search(args.q, ['title', 'shortDescription']),
        ...(pro ? { professional: { OR: [{ name: { contains: pro, mode: 'insensitive' as const } }, { user: { email: { contains: pro, mode: 'insensitive' as const } } }] } } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.service.count({ where }),
        prisma.service.findMany({ where, orderBy: { createdAt: 'desc' }, take: take(args.limit), include: { category: { select: { name: true, slug: true } }, media: { select: { kind: true } }, professional: { select: { name: true, slug: true, verification: true, user: { select: { email: true, fullName: true, kycStatus: true } } } } } }),
      ]);
      return {
        total, showing: rows.length, reviewHint: 'Admins review and publish gigs in Admin → Services → Review.',
        items: rows.map((s) => ({
          id: s.slug, title: s.title, status: s.status, category: s.category?.name ?? null, price: naira(s.price), priceUnit: s.priceUnit,
          deliveryDays: s.deliveryDays, createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt),
          createdBy: { name: s.professional.user?.fullName ?? s.professional.name, professionalName: s.professional.name, profile: s.professional.slug, email: s.professional.user?.email ?? null, identityStatus: s.professional.user?.kycStatus ?? null, profileVerification: s.professional.verification },
          blockingPublish: Object.values(publishProblems({ ...s, media: s.media })),
        })),
      };
    },
  },
  {
    name: 'admin_list_users',
    description: 'Search platform accounts by name/email with optional role (customer, professional, admin), status (active, pending_verification, suspended, deactivated) and sign-up time filter. Returns role, status, plan, identity (KYC) status, sign-up and last sign-in times.',
    parameters: { type: 'object', properties: {
      q: { type: 'string' }, role: { type: 'string', enum: ['customer', 'professional', 'admin'] },
      status: { type: 'string', enum: ['active', 'pending_verification', 'suspended', 'deactivated'] },
      createdSince: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 },
    }, additionalProperties: false },
    run: async (args: Record<string, unknown>) => {
      const role = normalizeEnum(args.role, ['customer', 'professional', 'admin'] as const);
      const status = normalizeEnum(args.status, ['active', 'pending_verification', 'suspended', 'deactivated'] as const);
      const since = sinceFrom(args.createdSince);
      const where = { deletedAt: null, ...(role ? { role } : {}), ...(status ? { status } : {}), ...(since ? { createdAt: { gte: since } } : {}), ...search(args.q, ['email', 'fullName']) };
      const [total, rows] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, take: take(args.limit), select: { id: true, fullName: true, email: true, role: true, status: true, planSlug: true, kycStatus: true, createdAt: true, lastLoginAt: true, professionalProfile: { select: { slug: true, name: true, verification: true } } } }),
      ]);
      return { total, showing: rows.length, items: rows.map((u) => ({ id: u.id, name: u.fullName, email: u.email, role: u.role, status: u.status, plan: u.planSlug, identityStatus: u.kycStatus, signedUpAt: iso(u.createdAt), lastSignInAt: iso(u.lastLoginAt), professionalProfile: u.professionalProfile ? { slug: u.professionalProfile.slug, name: u.professionalProfile.name, verification: u.professionalProfile.verification } : null })) };
    },
  },
  {
    name: 'admin_list_applications',
    description: 'Professional applications (people applying to sell on Servix) with status pending, under_review, approved or rejected, newest first.',
    parameters: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'under_review', 'approved', 'rejected'] }, since: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
    run: async (args: Record<string, unknown>) => {
      const status = normalizeEnum(args.status, ['pending', 'under_review', 'approved', 'rejected'] as const); const since = sinceFrom(args.since);
      const where = { ...(status ? { status } : {}), ...(since ? { createdAt: { gte: since } } : {}) };
      const rows = await prisma.professionalApplication.findMany({ where, orderBy: { createdAt: 'desc' }, take: take(args.limit), include: { user: { select: { fullName: true, email: true, kycStatus: true } } } });
      return { total: await prisma.professionalApplication.count({ where }), showing: rows.length, reviewHint: 'Approve or reject in Admin → Applications.', items: rows.map((a) => ({ id: a.id, applicant: a.user.fullName, email: a.user.email, identityStatus: a.user.kycStatus, title: a.title, category: a.categorySlug, city: a.locationCity, status: a.status, submittedAt: iso(a.submittedAt ?? a.createdAt), reviewedAt: iso(a.reviewedAt), rejectionReason: a.rejectionReason })) };
    },
  },
  {
    name: 'admin_list_identity_checks',
    description: 'Identity (KYC) verification queue by account: who is pending, verified or rejected. Never returns ID numbers, document types or files — Servix AI has no access to verification records themselves.',
    parameters: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'verified', 'rejected', 'unverified'] }, since: { type: 'string', description: 'account sign-up time filter' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
    run: async (args: Record<string, unknown>) => {
      const status = normalizeEnum(args.status, ['pending', 'verified', 'rejected', 'unverified'] as const) ?? 'pending'; const since = sinceFrom(args.since);
      const where = { deletedAt: null, kycStatus: status, ...(since ? { createdAt: { gte: since } } : {}) };
      const rows = await prisma.user.findMany({ where, orderBy: { updatedAt: 'desc' }, take: take(args.limit), select: { fullName: true, email: true, role: true, kycStatus: true, updatedAt: true } });
      return { total: await prisma.user.count({ where }), showing: rows.length, reviewHint: 'Decisions are made in Admin → Identity (KYC); Servix AI cannot approve or reject and never sees documents.', items: rows.map((u) => ({ name: u.fullName, email: u.email, role: u.role, identityStatus: u.kycStatus, lastUpdatedAt: iso(u.updatedAt) })) };
    },
  },
  {
    name: 'admin_list_bookings',
    description: 'Bookings across the platform (reference, status, service, customer, professional, timestamps). Filter by status or creation time. No amounts, payments or payouts.',
    parameters: { type: 'object', properties: { status: { type: 'string', enum: ['pending_payment', 'requested', 'accepted', 'in_progress', 'delivered', 'completed', 'declined', 'cancelled', 'disputed', 'refunded'] }, since: { type: 'string' }, q: { type: 'string', description: 'booking reference or service title' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
    run: async (args: Record<string, unknown>) => {
      const status = normalizeEnum(args.status, ['pending_payment', 'requested', 'accepted', 'in_progress', 'delivered', 'completed', 'declined', 'cancelled', 'disputed', 'refunded'] as const);
      const since = sinceFrom(args.since); const q = clampText(args.q, 80);
      const where = { ...(status ? { status } : {}), ...(since ? { createdAt: { gte: since } } : {}), ...(q ? { OR: [{ reference: { contains: q, mode: 'insensitive' as const } }, { service: { title: { contains: q, mode: 'insensitive' as const } } }] } : {}) };
      const rows = await prisma.booking.findMany({ where, orderBy: { createdAt: 'desc' }, take: take(args.limit), include: { service: { select: { title: true, slug: true } }, customer: { select: { fullName: true, email: true } }, professional: { select: { name: true, slug: true } } } });
      return { total: await prisma.booking.count({ where }), showing: rows.length, note: 'Money is intentionally excluded; see Admin → Bookings & disputes.', items: rows.map((b) => ({ reference: b.reference, status: b.status, service: b.service.title, serviceId: b.service.slug, customer: b.customer.fullName, customerEmail: b.customer.email, professional: b.professional.name, createdAt: iso(b.createdAt), deliveredAt: iso(b.deliveredAt), completedAt: iso(b.completedAt), disputedAt: iso(b.disputedAt) })) };
    },
  },
  {
    name: 'admin_list_requests',
    description: 'Customer service requests (the request → proposal marketplace) with status, budget range, proposal count and who posted them.',
    parameters: { type: 'object', properties: { status: { type: 'string', enum: ['draft', 'open', 'paused', 'closed', 'awarded', 'cancelled'] }, since: { type: 'string' }, q: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
    run: async (args: Record<string, unknown>) => {
      const status = normalizeEnum(args.status, ['draft', 'open', 'paused', 'closed', 'awarded', 'cancelled'] as const); const since = sinceFrom(args.since);
      const where = { ...(status ? { status } : {}), ...(since ? { createdAt: { gte: since } } : {}), ...search(args.q, ['title', 'description']) };
      const rows = await prisma.serviceRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: take(args.limit), include: { customer: { select: { fullName: true, email: true } }, category: { select: { name: true } } } });
      return { total: await prisma.serviceRequest.count({ where }), showing: rows.length, items: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, category: r.category?.name ?? null, budgetNaira: { min: koboToNaira(r.budgetMinKobo), max: koboToNaira(r.budgetMaxKobo) }, proposals: r.proposalCount, postedBy: r.customer.fullName, postedByEmail: r.customer.email, createdAt: iso(r.createdAt), deadlineAt: iso(r.deadlineAt) })) };
    },
  },
  {
    name: 'admin_recent_activity',
    description: 'Most recent admin/system audit-log entries (who did what, when). Filter by entity (user, service, booking, application, kyc …) or action prefix.',
    parameters: { type: 'object', properties: { entity: { type: 'string' }, action: { type: 'string', description: 'e.g. "service." or "user.suspend"' }, since: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
    run: async (args: Record<string, unknown>) => {
      const entity = clampText(args.entity, 40) || undefined; const action = clampText(args.action, 60) || undefined; const since = sinceFrom(args.since);
      const where = { ...(entity ? { entity } : {}), ...(action ? { action: { startsWith: action } } : {}), ...(since ? { createdAt: { gte: since } } : {}) };
      const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: take(args.limit), include: { actor: { select: { fullName: true, email: true } } } });
      return { showing: rows.length, items: rows.map((a) => ({ at: iso(a.createdAt), action: a.action, entity: a.entity, entityId: a.entityId, by: a.actor ? `${a.actor.fullName} <${a.actor.email}>` : 'system' })) };
    },
  },
] as const;

export const ADMIN_TOOL_NAMES: readonly string[] = ADMIN_TOOL_DEFS.map((t) => t.name);
