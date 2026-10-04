/**
 * Servix AI — central model routing configuration.
 *
 * Every AI "department" maps to an ORDERED CHAIN of model aliases. The first
 * alias is the primary model; the rest are tried, in order, only when the
 * previous one is unavailable, times out, or returns output that fails
 * validation. Nothing outside this file knows a concrete model identifier.
 *
 * Aliases → provider model ids come from the environment, with defaults taken
 * from the Dahl catalogue measured in docs/ai-eval/DAHL_EVALUATION_REPORT.md.
 * Changing provider or model is a configuration change, never a code change:
 *
 *   AI_ENABLED=true
 *   AI_PROVIDER=dahl                          # label only (any OpenAI-compatible host)
 *   AI_BASE_URL=https://inference.dahl.global/v1
 *   AI_API_KEY=…                              # server-side secret, never logged or sent to the browser
 *   AI_MODEL_DEEPSEEK=deepseek-ai/DeepSeek-V4-Flash-0731
 *   AI_MODEL_MINIMAX=MiniMaxAI/MiniMax-M2.7
 *   AI_MODEL_GLM=zai-org/GLM-5.3-Flash
 *   AI_ROUTE_PROPOSAL_GENERATION=minimax,deepseek,glm   # optional per-department override
 *   AI_CALL_TIMEOUT_MS=30000  AI_TASK_TIMEOUT_MS=60000  AI_MAX_ATTEMPTS_PER_MODEL=2
 *
 * Optional INDEPENDENT backup provider (a different host/account, e.g. NVIDIA's free tier). When configured, the
 * alias `backup` is appended to every chain, so it only answers when every primary-provider model is unavailable
 * (capacity, outage, retired id):
 *   AI_BACKUP_BASE_URL=https://integrate.api.nvidia.com/v1
 *   AI_BACKUP_API_KEY=…                       # enables the backup
 *   AI_BACKUP_MODEL=meta/llama-3.3-70b-instruct
 */

export const MODEL_ALIASES = ['deepseek', 'minimax', 'glm', 'backup'] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const DEPARTMENTS = [
  'assistant',
  'search_intent',
  'job_matching',
  'opportunity_radar',
  'profile_analysis',
  'profile_improvement',
  'pricing_guidance',
  'project_health',
  'explanations',
  'proposal_generation',
  'background_drafting',
] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** Primary model per department (owner's assignment, 2026-10-03). */
const PRIMARY: Record<Department, ModelAlias> = {
  assistant: 'deepseek',
  search_intent: 'deepseek',
  job_matching: 'deepseek',
  opportunity_radar: 'deepseek',
  profile_analysis: 'deepseek',
  profile_improvement: 'deepseek',
  pricing_guidance: 'deepseek',
  project_health: 'deepseek',
  explanations: 'deepseek',
  proposal_generation: 'minimax',
  background_drafting: 'minimax',
};

/**
 * Default fallback chain for a primary:
 *   deepseek → glm
 *   minimax  → deepseek → glm
 *   glm      → deepseek
 */
export function defaultChain(primary: ModelAlias): ModelAlias[] {
  if (primary === 'minimax') return ['minimax', 'deepseek', 'glm'];
  if (primary === 'glm') return ['glm', 'deepseek'];
  return ['deepseek', 'glm'];
}

const DEFAULT_MODEL_IDS: Record<ModelAlias, string> = {
  deepseek: 'deepseek-ai/DeepSeek-V4-Flash-0731',
  minimax: 'MiniMaxAI/MiniMax-M2.7',
  glm: 'zai-org/GLM-5.3-Flash',
  backup: 'meta/llama-3.3-70b-instruct',
};
export const DEFAULT_BACKUP_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export interface AiConfig {
  enabled: boolean;
  provider: { name: string; baseUrl: string; apiKey: string };
  /** Independent last-resort provider (different host + account); null when not configured. */
  backup: { name: string; baseUrl: string; apiKey: string } | null;
  models: Record<ModelAlias, string>;
  /** Base pause before a transient retry (multiplied by the attempt number, plus jitter). */
  retryBackoffMs: number;
  routes: Record<Department, ModelAlias[]>;
  callTimeoutMs: number;
  taskTimeoutMs: number;
  maxAttemptsPerModel: number;
  maxToolCalls: number;
  /** Start the next model in the chain in parallel when the current one has not answered after this long (0 = off). */
  hedgeAfterMs: number;
  /** Provider-specific request fields merged into every call (e.g. to switch a model's thinking mode off). */
  extraBody: Record<string, unknown>;
  /** Problems found while reading the environment (reported, never thrown). */
  warnings: string[];
}

function parseChain(raw: string | undefined, fallback: ModelAlias[], dept: string, warnings: string[], allowed: readonly ModelAlias[]): ModelAlias[] {
  if (!raw) return fallback;
  const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const valid = parts.filter((p): p is ModelAlias => (allowed as readonly string[]).includes(p));
  if (!valid.length || valid.length !== parts.length) {
    warnings.push(`AI_ROUTE_${dept.toUpperCase()} ignored: expected aliases from ${allowed.join('|')}, got "${raw}"`);
    return fallback;
  }
  return [...new Set(valid)];
}

function intEnv(env: NodeJS.ProcessEnv, name: string, def: number, min: number, max: number): number {
  const n = Number(env[name]);
  if (!Number.isFinite(n) || env[name] === undefined || env[name] === '') return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const warnings: string[] = [];
  let enabled = env.AI_ENABLED === 'true';
  const apiKey = env.AI_API_KEY ?? '';
  const baseUrl = (env.AI_BASE_URL ?? 'https://inference.dahl.global/v1').replace(/\/+$/, '');
  if (enabled && !apiKey) { warnings.push('AI_ENABLED=true but AI_API_KEY is missing — Servix AI stays OFF.'); enabled = false; }
  if (enabled && !/^https:\/\//.test(baseUrl) && env.NODE_ENV === 'production') { warnings.push('AI_BASE_URL must be https in production — Servix AI stays OFF.'); enabled = false; }

  const models: Record<ModelAlias, string> = {
    deepseek: env.AI_MODEL_DEEPSEEK?.trim() || DEFAULT_MODEL_IDS.deepseek,
    minimax: env.AI_MODEL_MINIMAX?.trim() || DEFAULT_MODEL_IDS.minimax,
    glm: env.AI_MODEL_GLM?.trim() || DEFAULT_MODEL_IDS.glm,
    backup: env.AI_BACKUP_MODEL?.trim() || DEFAULT_MODEL_IDS.backup,
  };
  const backupKey = env.AI_BACKUP_API_KEY?.trim() ?? '';
  const backupUrl = (env.AI_BACKUP_BASE_URL?.trim() || DEFAULT_BACKUP_BASE_URL).replace(/\/+$/, '');
  let backup: AiConfig['backup'] = null;
  if (backupKey) {
    if (!/^https:\/\//.test(backupUrl)) warnings.push('AI_BACKUP_BASE_URL must be https — backup provider ignored.');
    else if (backupUrl === baseUrl && backupKey === apiKey) warnings.push('AI_BACKUP_* points at the same host and key as AI_* — backup provider ignored (it must be independent).');
    else backup = { name: env.AI_BACKUP_PROVIDER?.trim() || 'backup', baseUrl: backupUrl, apiKey: backupKey };
  }
  const allowedAliases: readonly ModelAlias[] = backup ? MODEL_ALIASES : MODEL_ALIASES.filter((a) => a !== 'backup');
  const withBackup = (chain: ModelAlias[]): ModelAlias[] => (backup && !chain.includes('backup') ? [...chain, 'backup'] : chain);
  const routes = Object.fromEntries(
    DEPARTMENTS.map((d) => [d, withBackup(parseChain(env[`AI_ROUTE_${d.toUpperCase()}`], defaultChain(PRIMARY[d]), d, warnings, allowedAliases))]),
  ) as Record<Department, ModelAlias[]>;

  let extraBody: Record<string, unknown> = {};
  if (env.AI_EXTRA_BODY_JSON?.trim()) {
    try { const parsed = JSON.parse(env.AI_EXTRA_BODY_JSON) as unknown; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) extraBody = parsed as Record<string, unknown>; else warnings.push('AI_EXTRA_BODY_JSON ignored: must be a JSON object.'); }
    catch { warnings.push('AI_EXTRA_BODY_JSON ignored: invalid JSON.'); }
  }

  return {
    enabled,
    provider: { name: env.AI_PROVIDER?.trim() || 'dahl', baseUrl, apiKey },
    backup,
    models,
    routes,
    retryBackoffMs: intEnv(env, 'AI_RETRY_BACKOFF_MS', 2_000, 250, 15_000),
    callTimeoutMs: intEnv(env, 'AI_CALL_TIMEOUT_MS', 30_000, 3_000, 120_000),
    taskTimeoutMs: intEnv(env, 'AI_TASK_TIMEOUT_MS', 60_000, 5_000, 300_000),
    maxAttemptsPerModel: intEnv(env, 'AI_MAX_ATTEMPTS_PER_MODEL', 3, 1, 5),
    maxToolCalls: intEnv(env, 'AI_MAX_TOOL_CALLS', 6, 1, 12),
    hedgeAfterMs: intEnv(env, 'AI_HEDGE_AFTER_MS', 6_000, 0, 60_000),
    extraBody,
    warnings,
  };
}

/** Safe-to-display view of the routing (no secrets). */
export function describeRouting(cfg: AiConfig) {
  return {
    enabled: cfg.enabled,
    provider: { name: cfg.provider.name, baseUrl: cfg.provider.baseUrl, keyConfigured: Boolean(cfg.provider.apiKey) },
    backup: cfg.backup ? { name: cfg.backup.name, baseUrl: cfg.backup.baseUrl, keyConfigured: true, model: cfg.models.backup } : null,
    models: cfg.backup ? cfg.models : Object.fromEntries(Object.entries(cfg.models).filter(([k]) => k !== 'backup')),
    departments: DEPARTMENTS.map((d) => ({ department: d, chain: cfg.routes[d], primary: cfg.models[cfg.routes[d][0]] })),
    timeouts: { callMs: cfg.callTimeoutMs, taskMs: cfg.taskTimeoutMs, maxAttemptsPerModel: cfg.maxAttemptsPerModel, maxToolCalls: cfg.maxToolCalls, hedgeAfterMs: cfg.hedgeAfterMs, retryBackoffMs: cfg.retryBackoffMs },
    extraBodyKeys: Object.keys(cfg.extraBody),
    warnings: cfg.warnings,
  };
}
