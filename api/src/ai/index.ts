/**
 * Servix AI — runtime entry point.
 *
 * Lazily builds ONE router from configuration. Tests (and future providers)
 * can swap the provider or config with `configureAi()`. Nothing here is
 * exported to the frontend; the browser only ever sees `/api/v1/ai/*` results.
 */
import { describeRouting, loadAiConfig, type AiConfig } from './config.js';
import { FailoverProvider, OpenAICompatibleProvider, type AiProvider } from './provider.js';
import { AiRouter } from './router.js';
import { AiTelemetry, type TelemetryLogger } from './telemetry.js';

export interface AiRuntime { config: AiConfig; provider: AiProvider; router: AiRouter; telemetry: AiTelemetry }

let runtime: AiRuntime | null = null;
let overrides: { provider?: AiProvider; config?: AiConfig } = {};

export function getAi(): AiRuntime {
  if (runtime) return runtime;
  const config = overrides.config ?? loadAiConfig();
  const primary = new OpenAICompatibleProvider({ name: config.provider.name, baseUrl: config.provider.baseUrl, apiKey: config.provider.apiKey, extraBody: config.extraBody });
  const provider = overrides.provider ?? (config.backup
    ? new FailoverProvider(primary, new OpenAICompatibleProvider({ name: config.backup.name, baseUrl: config.backup.baseUrl, apiKey: config.backup.apiKey }), new Set([config.models.backup]))
    : primary);
  const telemetry = new AiTelemetry();
  runtime = { config, provider, router: new AiRouter(config, provider, telemetry), telemetry };
  return runtime;
}

export function aiEnabled(): boolean { return getAi().config.enabled; }

/** Test / future-provider hook. Resets the cached runtime. */
export function configureAi(next: { provider?: AiProvider; config?: AiConfig } | null): void {
  overrides = next ?? {};
  runtime = null;
}

export function attachAiLogger(logger: TelemetryLogger): void { getAi().telemetry.setLogger(logger); }

export function aiStatus() { const ai = getAi(); return { ...describeRouting(ai.config), telemetry: ai.telemetry.summary() }; }
