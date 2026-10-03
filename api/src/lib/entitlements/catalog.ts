/**
 * Servix plan catalogue — the single source of truth for what each plan allows.
 *
 *  - Five plans: free, go, pro, team, enterprise (rank order). Prices live in the `plans` table
 *    (operator-editable); this file defines capabilities.
 *  - Three kinds of entitlement:
 *      FEATURES  boolean capabilities (e.g. advanced_filters, team_workspace)
 *      LIMITS    numeric caps (null = unlimited), monthly or concurrent
 *      AI        which AI departments a plan may use, plus the monthly token allowance (a LIMIT)
 *  - Everything here can be overridden per plan by an operator (`plans.limits` JSON) and, for
 *    enterprise, per organisation / per account (`custom_limits`). The engine (./index.ts) merges
 *    code defaults ← plan overrides ← custom limits. No route ever compares plan slugs directly.
 *
 * Adding a feature: add a key to FEATURES with its minimum plan. Adding a limit: add it to LIMITS and
 * give every plan a value in PLAN_LIMITS (TypeScript enforces completeness).
 */
import { DEPARTMENTS, type Department } from '../../ai/config.js';

export const PLAN_SLUGS = ['free', 'go', 'pro', 'team', 'enterprise'] as const;
export type PlanSlug = (typeof PLAN_SLUGS)[number];
export const PLAN_RANK: Record<PlanSlug, number> = { free: 0, go: 1, pro: 2, team: 3, enterprise: 4 };
export const PLAN_LABEL: Record<PlanSlug, string> = { free: 'Free', go: 'Go', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };
/** Plans a user can buy online. Enterprise is arranged with Servix and assigned by an administrator. */
export const PURCHASABLE: readonly PlanSlug[] = ['go', 'pro', 'team'];
/** Plans whose entitlements are shared through an organisation (team workspace, pooled AI tokens). */
export const ORGANIZATION_PLANS: readonly PlanSlug[] = ['team', 'enterprise'];

export const isPlanSlug = (v: unknown): v is PlanSlug => typeof v === 'string' && (PLAN_SLUGS as readonly string[]).includes(v);

/* ------------------------------------------------------------------ features */

export const FEATURES = {
  advanced_filters:        { label: 'Advanced job filters (skills, deadline, location, sorting)', min: 'go' },
  proposal_organization:   { label: 'Proposal labels and private notes', min: 'go' },
  proposal_pipeline:       { label: 'Proposal pipeline view with status and label filters', min: 'pro' },
  profile_versions:        { label: 'Multiple profile versions', min: 'go' },
  analytics_detailed:      { label: 'Detailed analytics: trends, status and per-service breakdowns', min: 'go' },
  analytics_advanced:      { label: 'Application and profile performance analytics', min: 'pro' },
  profile_badge:           { label: 'Plan badge on your public profile', min: 'pro' },
  priority_ai:             { label: 'Priority AI routing (earlier fallback, shorter waits)', min: 'pro' },
  team_workspace:          { label: 'Team workspace: members, invitations, roles', min: 'team' },
  team_analytics:          { label: 'Team dashboard, activity and AI usage by member', min: 'team' },
  org_custom_limits:       { label: 'Custom organisation limits (set by Servix)', min: 'enterprise' },
  org_audit_log:           { label: 'Organisation audit log and export', min: 'enterprise' },
} as const satisfies Record<string, { label: string; min: PlanSlug }>;
export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/* ------------------------------------------------------------------ limits */

export const LIMITS = {
  monthly_ai_tokens:   { label: 'Servix AI tokens per month', period: 'month', unit: 'tokens' },
  listings:            { label: 'Service listings (drafts and published)', period: 'concurrent', unit: 'listings' },
  portfolio_items:     { label: 'Portfolio items', period: 'concurrent', unit: 'items' },
  monthly_proposals:   { label: 'Proposals (applications) per month', period: 'month', unit: 'proposals' },
  active_proposals:    { label: 'Live proposals at one time', period: 'concurrent', unit: 'proposals' },
  monthly_requests:    { label: 'Service requests posted per month', period: 'month', unit: 'requests' },
  active_requests:     { label: 'Open service requests at one time', period: 'concurrent', unit: 'requests' },
  saved_professionals: { label: 'Saved professionals', period: 'concurrent', unit: 'professionals' },
  saved_searches:      { label: 'Saved searches', period: 'concurrent', unit: 'searches' },
  profile_versions:    { label: 'Saved profile versions', period: 'concurrent', unit: 'versions' },
  monthly_exports:     { label: 'CSV exports per month', period: 'month', unit: 'exports' },
  team_members:        { label: 'Team members (including pending invitations)', period: 'concurrent', unit: 'members' },
} as const satisfies Record<string, { label: string; period: 'month' | 'concurrent'; unit: string }>;
export type LimitKey = keyof typeof LIMITS;
export const LIMIT_KEYS = Object.keys(LIMITS) as LimitKey[];
/** null = unlimited */
export type LimitValue = number | null;
export type LimitTable = Record<LimitKey, LimitValue>;

export const PLAN_LIMITS: Record<PlanSlug, LimitTable> = {
  free:       { monthly_ai_tokens: 20_000,    listings: 2,  portfolio_items: 6,  monthly_proposals: 5,   active_proposals: 3,   monthly_requests: 3,   active_requests: 2,  saved_professionals: 10,  saved_searches: 2,  profile_versions: 1,  monthly_exports: 1,   team_members: 0 },
  go:         { monthly_ai_tokens: 100_000,   listings: 5,  portfolio_items: 12, monthly_proposals: 25,  active_proposals: 10,  monthly_requests: 10,  active_requests: 5,  saved_professionals: 50,  saved_searches: 10, profile_versions: 3,  monthly_exports: 5,   team_members: 0 },
  pro:        { monthly_ai_tokens: 300_000,   listings: 15, portfolio_items: 20, monthly_proposals: 100, active_proposals: 30,  monthly_requests: 30,  active_requests: 15, saved_professionals: 200, saved_searches: 30, profile_versions: 10, monthly_exports: 25,  team_members: 0 },
  team:       { monthly_ai_tokens: 1_000_000, listings: 30, portfolio_items: 30, monthly_proposals: 300, active_proposals: 100, monthly_requests: 100, active_requests: 50, saved_professionals: 500, saved_searches: 50, profile_versions: 25, monthly_exports: 100, team_members: 5 },
  // Enterprise defaults are a starting point; real deals are configured per organisation by an administrator.
  enterprise: { monthly_ai_tokens: 3_000_000, listings: null, portfolio_items: null, monthly_proposals: null, active_proposals: null, monthly_requests: null, active_requests: null, saved_professionals: null, saved_searches: null, profile_versions: null, monthly_exports: null, team_members: 25 },
};

/* ------------------------------------------------------------------ AI departments */

const AI_FREE: Department[] = ['assistant', 'explanations', 'search_intent', 'project_health', 'pricing_guidance'];
const AI_GO: Department[] = [...AI_FREE, 'background_drafting', 'profile_analysis', 'job_matching'];
const AI_PRO: Department[] = [...AI_GO, 'proposal_generation', 'profile_improvement', 'opportunity_radar'];
export const PLAN_AI_DEPARTMENTS: Record<PlanSlug, readonly Department[]> = { free: AI_FREE, go: AI_GO, pro: AI_PRO, team: AI_PRO, enterprise: AI_PRO };

/* ------------------------------------------------------------------ derived helpers (pure) */

export const planHas = (plan: PlanSlug, feature: FeatureKey): boolean => PLAN_RANK[plan] >= PLAN_RANK[FEATURES[feature].min];
/** Lowest plan (in rank order) that includes a feature. */
export const minPlanFor = (feature: FeatureKey): PlanSlug => FEATURES[feature].min;
/** Lowest plan whose limit is strictly greater than `value` (or unlimited); null when no plan does. */
export function nextPlanForLimit(key: LimitKey, current: PlanSlug, overrides?: Partial<Record<PlanSlug, LimitTable>>): PlanSlug | null {
  const now = (overrides?.[current] ?? PLAN_LIMITS[current])[key];
  for (const slug of PLAN_SLUGS) {
    if (PLAN_RANK[slug] <= PLAN_RANK[current]) continue;
    const v = (overrides?.[slug] ?? PLAN_LIMITS[slug])[key];
    if (v === null || (now !== null && v > now)) return slug;
  }
  return null;
}
export const minPlanForAi = (department: Department): PlanSlug | null => PLAN_SLUGS.find((p) => PLAN_AI_DEPARTMENTS[p].includes(department)) ?? null;
export const isDepartment = (v: unknown): v is Department => typeof v === 'string' && (DEPARTMENTS as readonly string[]).includes(v);

/** Shape of operator overrides stored in `plans.limits` and of enterprise `custom_limits`. */
export interface PlanOverride {
  limits?: Partial<LimitTable>;
  features?: Partial<Record<FeatureKey, boolean>>;
  aiDepartments?: Department[];
}

/** Validate/normalise an override object coming from an admin (unknown keys dropped, values type-checked). */
export function sanitizeOverride(input: unknown): PlanOverride {
  const out: PlanOverride = {};
  if (!input || typeof input !== 'object') return out;
  const o = input as Record<string, unknown>;
  if (o.limits && typeof o.limits === 'object') {
    const limits: Partial<LimitTable> = {};
    for (const [k, v] of Object.entries(o.limits as Record<string, unknown>)) {
      if (!(k in LIMITS)) continue;
      if (v === null) limits[k as LimitKey] = null;
      else if (typeof v === 'number' && Number.isFinite(v) && v >= 0) limits[k as LimitKey] = Math.floor(v);
    }
    if (Object.keys(limits).length) out.limits = limits;
  }
  if (o.features && typeof o.features === 'object') {
    const features: Partial<Record<FeatureKey, boolean>> = {};
    for (const [k, v] of Object.entries(o.features as Record<string, unknown>)) if (k in FEATURES && typeof v === 'boolean') features[k as FeatureKey] = v;
    if (Object.keys(features).length) out.features = features;
  }
  if (Array.isArray(o.aiDepartments)) {
    const deps = o.aiDepartments.filter(isDepartment);
    out.aiDepartments = deps;
  }
  return out;
}
