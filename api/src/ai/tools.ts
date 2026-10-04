/**
 * Servix AI — read-only tool registry.
 *
 * Every tool is a bounded READ of real Servix data through the same code the
 * public API uses. There are deliberately NO tools that touch bookings,
 * payments, payouts, ledger, refunds, wallets, KYC decisions or admin actions,
 * and no tool performs a write. Departments receive a filtered subset
 * (`buildToolRunner(allowList, ctx)`); audience-restricted tools refuse to run
 * for the wrong caller even if a department lists them.
 */
import { prisma } from '../lib/db.js';
import { professionalQuerySchema } from '../lib/query.js';
import { computeTrust, publicTrust } from '../lib/trust.js';
import { listAchievements } from '../lib/achievements.js';
import { availabilitySummary, filterByAvailability } from '../lib/bookingService.js';
import { buildOrderBy, buildWhere } from '../routes/professionals.js';
import { normalizeProfileDetails } from '../lib/serialize.js';
import type { ToolSchema } from './provider.js';
import type { ToolRunner } from './router.js';
import { resolveCategorySlug, normalizeEnum, normalizeNaira, clampText } from './normalize.js';
import { ADMIN_TOOL_DEFS } from './adminTools.js';

export interface ToolContext {
  userId: string | null;
  role: 'customer' | 'professional' | 'admin' | null;
  professionalProfileId: string | null;
}

interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  audience?: 'professional' | 'authenticated' | 'admin';
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

const naira = (v: bigint | number | null | undefined) => (v == null ? null : Number(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function listCategories(): Promise<{ slug: string; name: string }[]> {
  const rows = await prisma.category.findMany({ where: { isActive: true }, orderBy: { position: 'asc' }, select: { slug: true, name: true } });
  return rows;
}

const compactPro = (p: { slug: string; name: string; title: string; locationCity: string | null; ratingAvg: unknown; reviewCount: number; verification: string; startingPrice: bigint | null; completedProjects: number; category?: { slug: string } | null }) => ({
  slug: p.slug, name: p.name, title: p.title, city: p.locationCity, category: p.category?.slug ?? null,
  rating: num(p.ratingAvg), reviews: p.reviewCount, verified: p.verification === 'verified', completedProjects: p.completedProjects, fromPrice: naira(p.startingPrice),
});

/** Same search the public /professionals endpoint runs, with model drift snapped to real values. */
export async function searchProfessionals(input: Record<string, unknown>) {
  const categories = await listCategories();
  const q = professionalQuerySchema.parse({
    q: clampText(input.q, 120) || undefined,
    category: resolveCategorySlug(input.category, categories) ?? undefined,
    location: clampText(input.location, 80) || undefined,
    maxPrice: normalizeNaira(input.maxPrice) ?? undefined,
    minRating: typeof input.minRating === 'number' ? Math.min(5, Math.max(0, input.minRating)) : undefined,
    available: normalizeEnum(input.available, ['today', 'tomorrow', 'week'] as const) ?? undefined,
    sort: normalizeEnum(input.sort, ['recommended', 'rating', 'reviews', 'price-asc', 'price-desc'] as const) ?? 'recommended',
    page: 1, pageSize: 8,
  });
  const where = buildWhere(q);
  const rows = await prisma.professionalProfile.findMany({ where, orderBy: buildOrderBy(q.sort), take: q.available ? 60 : 8, include: { category: true } });
  let kept = rows;
  if (q.available) { const keep = await filterByAvailability(rows.map((r) => r.id), q.available); kept = rows.filter((r) => keep.has(r.id)).slice(0, 8); }
  return { filters: q, total: kept.length, items: kept.map(compactPro) };
}

const TOOLS: ToolDef[] = [
  {
    name: 'get_categories',
    description: 'List the real Servix service categories (slug + name). Always use these slugs; never invent one.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => ({ items: await listCategories() }),
  },
  {
    name: 'search_professionals',
    description: 'Search Servix professionals. Returns up to 8 real profiles with slug, rating, verification and starting price. Use category slugs from get_categories.',
    parameters: { type: 'object', properties: {
      q: { type: 'string', description: 'keywords (name, title or skill)' },
      category: { type: 'string', description: 'category slug' },
      location: { type: 'string', description: 'city, e.g. Lagos' },
      maxPrice: { type: 'integer', description: 'maximum starting price in naira' },
      minRating: { type: 'number' },
      available: { type: 'string', enum: ['today', 'tomorrow', 'week'] },
      sort: { type: 'string', enum: ['recommended', 'rating', 'reviews', 'price-asc', 'price-desc'] },
    }, additionalProperties: false },
    run: (args) => searchProfessionals(args),
  },
  {
    name: 'get_professional_profile',
    description: 'Full public profile of one professional by slug: about, skills, active gigs with prices and delivery days.',
    parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'], additionalProperties: false },
    run: async (args) => {
      const slug = clampText(args.slug, 160);
      const p = await prisma.professionalProfile.findUnique({ where: { slug }, include: { category: true, skills: { orderBy: { position: 'asc' } }, services: { where: { status: 'active' }, select: { slug: true, title: true, price: true, priceUnit: true, deliveryDays: true, shortDescription: true } } } });
      if (!p) return { error: 'professional not found' };
      const details = normalizeProfileDetails(p.details);
      return { ...compactPro(p), about: (p.about ?? '').slice(0, 1200), skills: p.skills.map((s) => s.skill), responseTime: p.responseTimeLabel, memberSince: p.memberSince,
        languages: details.languages, experience: details.experience.slice(0, 5).map((e) => ({ title: e.title, company: e.company, start: e.start, end: e.end })),
        gigs: p.services.map((s) => ({ slug: s.slug, title: s.title, price: naira(s.price), priceUnit: s.priceUnit, deliveryDays: s.deliveryDays, summary: s.shortDescription.slice(0, 200) })) };
    },
  },
  {
    name: 'get_trust_metrics',
    description: 'Trust & performance metrics computed from real Servix activity (reliability, response rate, repeat customers, achievements). Fields marked enough=false mean "Not enough Servix data yet".',
    parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'], additionalProperties: false },
    run: async (args) => {
      const p = await prisma.professionalProfile.findUnique({ where: { slug: clampText(args.slug, 160) }, select: { id: true, name: true } });
      if (!p) return { error: 'professional not found' };
      const [metrics, achievements] = await Promise.all([computeTrust(p.id), listAchievements(p.id)]);
      return { name: p.name, ...publicTrust(metrics), achievements: achievements.map((a: { key?: string; title?: string; name?: string }) => a.title ?? a.name ?? a.key) };
    },
  },
  {
    name: 'check_availability',
    description: 'Next real available slot for a professional (today / tomorrow / this week), from their actual availability rules and bookings.',
    parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'], additionalProperties: false },
    run: async (args) => {
      const p = await prisma.professionalProfile.findUnique({ where: { slug: clampText(args.slug, 160) }, select: { id: true } });
      if (!p) return { error: 'professional not found' };
      return availabilitySummary(p.id);
    },
  },
  {
    name: 'compare_professionals',
    description: 'Side-by-side facts for 2–4 professionals (summary + trust metrics).',
    parameters: { type: 'object', properties: { slugs: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 } }, required: ['slugs'], additionalProperties: false },
    run: async (args) => {
      const slugs = Array.isArray(args.slugs) ? args.slugs.filter((s): s is string => typeof s === 'string').slice(0, 4) : [];
      const pros = await prisma.professionalProfile.findMany({ where: { slug: { in: slugs } }, include: { category: true } });
      const items = await Promise.all(pros.map(async (p) => ({ ...compactPro(p), trust: publicTrust(await computeTrust(p.id)) })));
      return { items };
    },
  },
  {
    name: 'get_price_stats',
    description: 'Real price distribution of active Servix gigs in a category (naira). insufficient=true means fewer than 5 gigs — say "Not enough Servix data yet".',
    parameters: { type: 'object', properties: { category: { type: 'string', description: 'category slug' } }, required: ['category'], additionalProperties: false },
    run: async (args) => priceStats(args.category),
  },
  {
    name: 'get_open_requests',
    description: 'Open customer service requests (the pro’s own category first). Each has a real id, title, budget and deadline.',
    parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
    audience: 'professional',
    run: async (args, ctx) => ({ items: await openRequestsFor(ctx.professionalProfileId!, Math.min(20, Math.max(1, Number(args.limit) || 10))) }),
  },
  {
    name: 'get_my_profile',
    description: 'The signed-in professional’s own profile, gigs and trust metrics.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    audience: 'professional',
    run: async (_args, ctx) => ownProfile(ctx.professionalProfileId!),
  },
  {
    name: 'get_booking_timeline',
    description: 'Status and timeline of one booking the caller is party to (no payment details).',
    parameters: { type: 'object', properties: { bookingId: { type: 'string' } }, required: ['bookingId'], additionalProperties: false },
    audience: 'authenticated',
    run: async (args, ctx) => bookingTimeline(clampText(args.bookingId, 80), ctx),
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

export async function priceStats(categoryInput: unknown) {
  const categories = await listCategories();
  const slug = resolveCategorySlug(categoryInput, categories);
  if (!slug) return { error: 'unknown category', knownCategories: categories.map((c) => c.slug) };
  const rows = await prisma.service.findMany({ where: { status: 'active', category: { slug } }, select: { price: true } });
  const prices = rows.map((r) => Number(r.price)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const pct = (p: number) => prices[Math.min(prices.length - 1, Math.floor(p * prices.length))];
  if (prices.length < 5) return { category: slug, count: prices.length, insufficient: true, note: 'Not enough Servix data yet' };
  return { category: slug, count: prices.length, insufficient: false, currency: 'NGN', min: prices[0], p25: pct(0.25), median: pct(0.5), p75: pct(0.75), max: prices[prices.length - 1] };
}

export async function openRequestsFor(professionalProfileId: string, limit = 10) {
  const me = await prisma.professionalProfile.findUnique({ where: { id: professionalProfileId }, select: { categoryId: true, skills: { select: { skill: true } } } });
  const rows = await prisma.serviceRequest.findMany({ where: { status: 'open' }, orderBy: [{ publishedAt: 'desc' }], take: 60, include: { category: { select: { slug: true, name: true } } } });
  const mine = rows.filter((r) => r.categoryId === me?.categoryId); const others = rows.filter((r) => r.categoryId !== me?.categoryId);
  return [...mine, ...others].slice(0, limit).map((r) => ({
    id: r.id, title: r.title, category: r.category.slug, description: r.description.slice(0, 500), budgetMin: r.budgetMinKobo == null ? null : Number(r.budgetMinKobo) / 100, budgetMax: r.budgetMaxKobo == null ? null : Number(r.budgetMaxKobo) / 100,
    deadlineAt: r.deadlineAt?.toISOString() ?? null, isRemote: r.isRemote, location: r.location, requiredSkills: Array.isArray(r.requiredSkills) ? r.requiredSkills : [], proposalCount: r.proposalCount, publishedAt: r.publishedAt?.toISOString() ?? null,
  }));
}

export async function ownProfile(professionalProfileId: string) {
  const p = await prisma.professionalProfile.findUnique({ where: { id: professionalProfileId }, include: { category: true, skills: { orderBy: { position: 'asc' } }, services: { where: { status: 'active' }, select: { slug: true, title: true, price: true, priceUnit: true, deliveryDays: true, shortDescription: true, description: true } }, portfolio: { select: { title: true, verifiedAt: true }, take: 10 } } });
  if (!p) return { error: 'profile not found' };
  const trust = publicTrust(await computeTrust(p.id));
  const details = normalizeProfileDetails(p.details);
  return { ...compactPro(p), about: p.about ?? '', skills: p.skills.map((s) => s.skill), responseTime: p.responseTimeLabel, plan: p.planSlug, hasPhoto: Boolean(p.imageUrl),
    details: { occupation: details.occupation, languages: details.languages, education: details.education.length, certifications: details.certifications.length, experience: details.experience.length },
    gigs: p.services.map((s) => ({ slug: s.slug, title: s.title, price: naira(s.price), priceUnit: s.priceUnit, deliveryDays: s.deliveryDays, summary: s.shortDescription, descriptionLength: s.description.length })),
    portfolio: { items: p.portfolio.length, verified: p.portfolio.filter((i) => i.verifiedAt).length }, trust };
}

export async function bookingTimeline(bookingId: string, ctx: ToolContext) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { events: { orderBy: { createdAt: 'asc' }, select: { event: true, createdAt: true } }, professional: { select: { name: true, slug: true } }, service: { select: { title: true, deliveryDays: true } } } });
  if (!b) return { error: 'booking not found' };
  const isParty = (ctx.userId && b.customerId === ctx.userId) || (ctx.professionalProfileId && b.professionalId === ctx.professionalProfileId) || ctx.role === 'admin';
  if (!isParty) return { error: 'booking not found' };
  const now = Date.now();
  const expected = b.expectedDeliveryAt ?? null;
  const overdueDays = expected && !b.deliveredAt && !b.completedAt && ['accepted', 'in_progress'].includes(b.status) ? Math.max(0, Math.floor((now - expected.getTime()) / 86_400_000)) : 0;
  return {
    id: b.id, reference: b.reference, status: b.status, serviceTitle: b.serviceTitle, professional: b.professional.name, professionalSlug: b.professional.slug,
    scheduledAt: b.scheduledAt.toISOString(), expectedDeliveryAt: expected?.toISOString() ?? null, deliveredAt: b.deliveredAt?.toISOString() ?? null, completedAt: b.completedAt?.toISOString() ?? null,
    disputedAt: b.disputedAt?.toISOString() ?? null, cancelledBy: b.cancelledBy, deadlineChangedAt: b.deadlineChangedAt?.toISOString() ?? null, overdueDays, daysSinceCreated: Math.floor((now - b.createdAt.getTime()) / 86_400_000),
    events: b.events.slice(-20).map((e) => ({ event: e.event, at: e.createdAt.toISOString() })),
  };
}

/** Build the tool runner a department is allowed to use for this caller. */
export function buildToolRunner(allow: readonly string[], ctx: ToolContext): ToolRunner {
  const adminDefs: ToolDef[] = ADMIN_TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>, audience: 'admin', run: (args) => t.run(args) }));
  const defs = [...TOOLS, ...adminDefs].filter((t) => allow.includes(t.name)).filter((t) =>
    t.audience === 'professional' ? ctx.role === 'professional' && Boolean(ctx.professionalProfileId)
    : t.audience === 'admin' ? ctx.role === 'admin' && Boolean(ctx.userId)
    : t.audience === 'authenticated' ? Boolean(ctx.userId)
    : true);
  const schemas: ToolSchema[] = defs.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  return {
    schemas,
    async run(name, args) {
      const def = defs.find((t) => t.name === name);
      if (!def) return { error: `tool "${name}" is not available here` };
      const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
      return def.run(safeArgs, ctx);
    },
  };
}
