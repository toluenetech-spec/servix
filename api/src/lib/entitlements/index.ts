/**
 * Entitlement engine. Resolves "what can this account do right now" from:
 *   user.plan (expired → free)  ←  active organisation membership (team/enterprise plans are shared)
 *   ← operator overrides (`plans.limits`)  ←  enterprise custom limits (organisation, then account).
 *
 * Public API used by routes:
 *   entitlementsFor(req)             resolved + memoised per request
 *   canAccess(ent, feature)          boolean
 *   getLimit(ent, key)               number | null (unlimited)
 *   canUseAI(ent, department)        boolean
 *   assertFeature(ent, feature)      throws 403 PLAN_FEATURE with upgrade metadata
 *   assertWithinLimit(ent, key, used, { adding }) throws 403 PLAN_LIMIT with upgrade metadata
 *   requireEntitlement(feature)      Fastify preHandler (after requireAuth)
 *
 * The backend always enforces; the frontend only mirrors these answers to hide or label controls.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import type { Department } from '../../ai/config.js';
import {
  FEATURES, FEATURE_KEYS, LIMITS, LIMIT_KEYS, PLAN_AI_DEPARTMENTS, PLAN_LABEL, PLAN_LIMITS, PLAN_RANK, PLAN_SLUGS, ORGANIZATION_PLANS,
  isPlanSlug, minPlanFor, minPlanForAi, nextPlanForLimit, planHas, sanitizeOverride,
  type FeatureKey, type LimitKey, type LimitTable, type PlanOverride, type PlanSlug,
} from './catalog.js';

export * from './catalog.js';

export interface OrganizationContext {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'member';
  /** Per-member monthly AI cap inside the pool (null = pool only). */
  aiTokenCap: number | null;
}

export interface Entitlements {
  userId: string;
  /** Effective plan after expiry and organisation inheritance. */
  plan: PlanSlug;
  planLabel: string;
  /** Where the plan comes from. */
  source: 'account' | 'organization' | 'admin';
  /** The account's own subscription (what they pay for), independent of inheritance. */
  own: { plan: PlanSlug; expiresAt: Date | null; expired: boolean };
  organization: OrganizationContext | null;
  features: FeatureKey[];
  limits: LimitTable;
  aiDepartments: Department[];
  /** Whose monthly AI allowance is consumed. */
  aiSubject: { type: 'user' | 'org'; id: string };
  isAdmin: boolean;
}

/* ------------------------------------------------------------------ plan overrides (operator) */

interface OverrideCache { at: number; byPlan: Partial<Record<PlanSlug, PlanOverride>> }
let overrideCache: OverrideCache | null = null;
const OVERRIDE_TTL_MS = 60_000;

export async function loadPlanOverrides(force = false): Promise<Partial<Record<PlanSlug, PlanOverride>>> {
  if (!force && overrideCache && Date.now() - overrideCache.at < OVERRIDE_TTL_MS) return overrideCache.byPlan;
  const byPlan: Partial<Record<PlanSlug, PlanOverride>> = {};
  try {
    const rows = await prisma.plan.findMany({ select: { slug: true, limits: true } });
    for (const r of rows) if (isPlanSlug(r.slug)) byPlan[r.slug] = sanitizeOverride(r.limits);
  } catch {
    /* Catalogue unavailable: fall back to code defaults rather than failing requests. */
  }
  overrideCache = { at: Date.now(), byPlan };
  return byPlan;
}
export const invalidatePlanOverrides = (): void => { overrideCache = null; };

/** Effective (defaults + operator override) table for a plan, used by upgrade hints and admin screens. */
export function effectivePlanTable(plan: PlanSlug, overrides: Partial<Record<PlanSlug, PlanOverride>>, extra: PlanOverride[] = []): { limits: LimitTable; features: FeatureKey[]; aiDepartments: Department[] } {
  const layers = [overrides[plan], ...extra].filter((x): x is PlanOverride => !!x);
  const limits: LimitTable = { ...PLAN_LIMITS[plan] };
  let aiDepartments: Department[] = [...PLAN_AI_DEPARTMENTS[plan]];
  const featureFlags: Partial<Record<FeatureKey, boolean>> = {};
  for (const layer of layers) {
    if (layer.limits) for (const k of LIMIT_KEYS) if (k in layer.limits) limits[k] = layer.limits[k] ?? null;
    if (layer.features) Object.assign(featureFlags, layer.features);
    if (layer.aiDepartments) aiDepartments = [...layer.aiDepartments];
  }
  const features = FEATURE_KEYS.filter((f) => featureFlags[f] ?? planHas(plan, f));
  return { limits, features, aiDepartments };
}

/* ------------------------------------------------------------------ resolution */

const isActivePlan = (slug: string, expiresAt: Date | null, now: Date): slug is PlanSlug =>
  isPlanSlug(slug) && slug !== 'free' && (expiresAt === null || expiresAt > now);

export async function resolveEntitlements(userId: string, now = new Date()): Promise<Entitlements> {
  const [user, membership, overrides] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, planSlug: true, planExpiresAt: true, customLimits: true } }),
    prisma.organizationMember.findFirst({
      where: { userId, status: 'active' },
      select: { role: true, aiTokenCap: true, organization: { select: { id: true, name: true, slug: true, planSlug: true, planExpiresAt: true, customLimits: true, owner: { select: { planSlug: true, planExpiresAt: true } } } } },
    }),
    loadPlanOverrides(),
  ]);
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Account not found.');

  const ownActive = isActivePlan(user.planSlug, user.planExpiresAt, now);
  const own = { plan: (ownActive ? user.planSlug : 'free') as PlanSlug, expiresAt: user.planExpiresAt, expired: !ownActive && user.planSlug !== 'free' && isPlanSlug(user.planSlug) };

  let plan: PlanSlug = own.plan;
  let source: Entitlements['source'] = 'account';
  let organization: OrganizationContext | null = null;
  const extra: PlanOverride[] = [];
  let aiSubject: Entitlements['aiSubject'] = { type: 'user', id: userId };

  if (membership) {
    const org = membership.organization;
    // Organisation plan: admin-assigned plan wins, otherwise the owner's subscription.
    const assigned = org.planSlug && isActivePlan(org.planSlug, org.planExpiresAt, now) ? org.planSlug : null;
    const ownerPlan = isActivePlan(org.owner.planSlug, org.owner.planExpiresAt, now) ? org.owner.planSlug : null;
    const orgPlan = assigned ?? ownerPlan;
    organization = { id: org.id, name: org.name, slug: org.slug, role: membership.role, aiTokenCap: membership.aiTokenCap };
    if (orgPlan && ORGANIZATION_PLANS.includes(orgPlan) && PLAN_RANK[orgPlan] >= PLAN_RANK[plan]) {
      plan = orgPlan;
      source = assigned ? 'admin' : 'organization';
      aiSubject = { type: 'org', id: org.id };
      if (plan === 'enterprise') extra.push(sanitizeOverride(org.customLimits));
    }
  }
  if (plan === 'enterprise' && source === 'account') extra.push(sanitizeOverride(user.customLimits));

  // Platform administrators get full capabilities for support and QA; their own AI use is metered per account.
  const isAdmin = user.role === 'admin';
  if (isAdmin && plan !== 'enterprise') { plan = 'enterprise'; source = 'admin'; }

  const table = effectivePlanTable(plan, overrides, extra);
  return { userId, plan, planLabel: PLAN_LABEL[plan], source, own, organization, features: table.features, limits: table.limits, aiDepartments: table.aiDepartments, aiSubject, isAdmin };
}

/* ------------------------------------------------------------------ request helpers */

declare module 'fastify' {
  interface FastifyRequest {
    entitlements?: Entitlements;
  }
}

/** Resolve once per request (after requireAuth). */
export async function entitlementsFor(req: FastifyRequest): Promise<Entitlements> {
  if (req.entitlements) return req.entitlements;
  if (!req.auth) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  const ent = await resolveEntitlements(req.auth.sub);
  req.entitlements = ent;
  return ent;
}

export const canAccess = (ent: Entitlements, feature: FeatureKey): boolean => ent.features.includes(feature);
export const getLimit = (ent: Entitlements, key: LimitKey): number | null => ent.limits[key];
export const canUseAI = (ent: Entitlements, department: Department): boolean => ent.aiDepartments.includes(department);

export interface UpgradeMeta {
  kind: 'feature' | 'limit' | 'ai_department' | 'ai_quota';
  feature?: FeatureKey;
  limit?: LimitKey;
  department?: Department;
  plan: PlanSlug;
  /** Lowest plan that unlocks the feature / raises the limit (null when nothing higher helps). */
  upgradeTo: PlanSlug | null;
  upgradeToLabel: string | null;
  used?: number;
  allowed?: number | null;
  resetAt?: string;
}

const upgradeMeta = (m: Omit<UpgradeMeta, 'upgradeToLabel'>): Record<string, unknown> & UpgradeMeta => ({ ...m, upgradeToLabel: m.upgradeTo ? PLAN_LABEL[m.upgradeTo] : null });

export function featureLockedError(ent: Entitlements, feature: FeatureKey): ApiError {
  const upgradeTo = minPlanFor(feature);
  const label = FEATURES[feature].label;
  return new ApiError(403, 'PLAN_FEATURE', `${label} is available on ${PLAN_LABEL[upgradeTo]} and above.`, undefined,
    upgradeMeta({ kind: 'feature', feature, plan: ent.plan, upgradeTo: PLAN_RANK[upgradeTo] > PLAN_RANK[ent.plan] ? upgradeTo : null }));
}
export function assertFeature(ent: Entitlements, feature: FeatureKey): void {
  if (!canAccess(ent, feature)) throw featureLockedError(ent, feature);
}

export function limitReachedError(ent: Entitlements, key: LimitKey, used: number, allowed: number): ApiError {
  const meta = LIMITS[key];
  const upgradeTo = nextPlanForLimit(key, ent.plan);
  const period = meta.period === 'month' ? ' this month' : '';
  const message = `You have reached your ${PLAN_LABEL[ent.plan]} plan limit of ${allowed.toLocaleString('en-NG')} ${meta.unit}${period}. Nothing has been removed${upgradeTo ? ` — upgrade to ${PLAN_LABEL[upgradeTo]} for more` : ''}.`;
  return new ApiError(403, 'PLAN_LIMIT', message, undefined, upgradeMeta({ kind: 'limit', limit: key, plan: ent.plan, upgradeTo, used, allowed }));
}
/** Throws when `used + adding` would exceed the limit. Returns the limit for convenience. */
export function assertWithinLimit(ent: Entitlements, key: LimitKey, used: number, adding = 1): number | null {
  const allowed = getLimit(ent, key);
  if (allowed !== null && used + adding > allowed) throw limitReachedError(ent, key, used, allowed);
  return allowed;
}

export function aiDepartmentLockedError(ent: Entitlements, department: Department): ApiError {
  const upgradeTo = minPlanForAi(department);
  const better = upgradeTo && PLAN_RANK[upgradeTo] > PLAN_RANK[ent.plan] ? upgradeTo : null;
  return new ApiError(403, 'PLAN_FEATURE', better ? `This Servix AI feature is available on ${PLAN_LABEL[better]} and above.` : 'This Servix AI feature is not included in your plan.', undefined,
    upgradeMeta({ kind: 'ai_department', department, plan: ent.plan, upgradeTo: better }));
}
export function assertAiDepartment(ent: Entitlements, department: Department): void {
  if (!canUseAI(ent, department)) throw aiDepartmentLockedError(ent, department);
}

/** Fastify preHandler: `preHandler: [requireAuth, requireEntitlement('team_workspace')]`. */
export const requireEntitlement = (feature: FeatureKey) => async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
  assertFeature(await entitlementsFor(req), feature);
};

/** Plans ranked above `plan` (for "upgrade" lists). */
export const plansAbove = (plan: PlanSlug): PlanSlug[] => PLAN_SLUGS.filter((p) => PLAN_RANK[p] > PLAN_RANK[plan]);
