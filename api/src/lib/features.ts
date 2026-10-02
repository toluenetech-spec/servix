/**
 * Feature flags for systems that ship to production switched OFF.
 * Each flag is an environment variable set to 'true' on the API host.
 * The frontend reads GET /api/v1/features and hides navigation for
 * anything disabled; the API refuses gated routes with 503 FEATURE_DISABLED.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from './errors.js';

export const FEATURE_FLAGS = {
  requests: { env: 'REQUESTS_ENABLED', label: 'Service request marketplace & proposals' },
  compare: { env: 'COMPARE_ENABLED', label: 'Professional / service comparison' },
  achievements: { env: 'ACHIEVEMENTS_ENABLED', label: 'Automatic professional achievements' },
  trust: { env: 'TRUST_ENABLED', label: 'Trust & performance profile section' },
  projects: { env: 'PROJECTS_ENABLED', label: 'Projects & milestones' },
  crm: { env: 'CRM_ENABLED', label: 'Professional clients (CRM)' },
  packages: { env: 'PACKAGES_ENABLED', label: 'Service packages' },
  business: { env: 'BUSINESS_ENABLED', label: 'Business workspace' },
  pricing: { env: 'PRICING_INSIGHTS_ENABLED', label: 'Price intelligence' },
  community: { env: 'COMMUNITY_ENABLED', label: 'Community, messages & network' },
} as const;

export type FeatureKey = keyof typeof FEATURE_FLAGS;

export function featureEnabled(key: FeatureKey): boolean {
  return process.env[FEATURE_FLAGS[key].env] === 'true';
}

export function featureSnapshot(): Record<FeatureKey, boolean> {
  return Object.fromEntries((Object.keys(FEATURE_FLAGS) as FeatureKey[]).map((k) => [k, featureEnabled(k)])) as Record<FeatureKey, boolean>;
}

export function requireFeature(key: FeatureKey) {
  return async (_req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!featureEnabled(key)) {
      throw new ApiError(503, 'FEATURE_DISABLED', `${FEATURE_FLAGS[key].label} is not enabled on this Servix instance yet.`);
    }
  };
}
