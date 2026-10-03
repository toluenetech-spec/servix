/**
 * Plan-aware execution of AI tasks: entitlement check → token reservation → routed run → settlement → ledger.
 *
 *  - Which departments a plan may use, and how many tokens per month, come from the entitlement engine.
 *  - The allowance is reserved atomically BEFORE the provider is called (concurrent requests cannot both
 *    slip past the last tokens) and settled to the real usage afterwards.
 *  - Failed tasks are recorded (tokens the provider consumed on failed attempts are visible to admins) but
 *    are NOT charged to the account.
 *  - Pro+ accounts get priority routing: the parallel fallback starts earlier.
 *  - Anonymous calls (e.g. search intent on the public directory) are recorded without a user and never metered
 *    against a plan — the per-IP rate limit protects them.
 *
 * The router itself (model chains, fallback, hedging) is untouched; this layer only wraps `router.run`.
 */
import type { FastifyRequest } from 'fastify';
import { getAi } from './index.js';
import { aiFailureOf, type RunOptions, type TaskSpec, type TaskSuccess } from './router.js';
import { entitlementsFor, assertAiDepartment, canAccess, type Entitlements } from '../lib/entitlements/index.js';
import { reserveAiTokens, settleAiTokens, recordAiEvent, readMeter, type AiReservation, type UsageMeter } from '../lib/entitlements/usage.js';

export const PRIORITY_HEDGE_MS = 2_500;

export type MeteredSuccess<T> = TaskSuccess<T> & { quota: UsageMeter | null };

/** Exponential moving average of real token usage per department (in-process). Makes reservations track reality
 *  (tool round-trips, long answers) so bursts of concurrent requests cannot slip far past the allowance. */
const observedTokens = new Map<string, number>();
export const noteObservedTokens = (department: string, tokens: number): void => {
  if (tokens <= 0) return;
  const prev = observedTokens.get(department);
  observedTokens.set(department, prev === undefined ? tokens : Math.round(prev * 0.7 + tokens * 0.3));
};
export const resetObservedTokens = (): void => observedTokens.clear();

/** Prompt-size estimate (≈4 characters per token) + completion budget + tool overhead, or the observed average if higher. */
export function estimateTokens(task: TaskSpec<unknown>): number {
  const chars = task.messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
  const toolOverhead = task.tools ? 1_500 : 0;
  const structural = Math.ceil(chars / 4) + (task.maxTokens ?? 800) + toolOverhead;
  return Math.max(structural, observedTokens.get(task.department) ?? 0);
}

export async function runMetered<T>(req: FastifyRequest, task: TaskSpec<T>, opts: RunOptions = {}): Promise<MeteredSuccess<T>> {
  const router = getAi().router;
  const startedAt = Date.now();
  let ent: Entitlements | null = null;
  let reservation: AiReservation | null = null;

  if (req.auth) {
    ent = await entitlementsFor(req);
    assertAiDepartment(ent, task.department);
    reservation = await reserveAiTokens(ent, estimateTokens(task));
    if (canAccess(ent, 'priority_ai') && opts.hedgeAfterMs === undefined && router.config.hedgeAfterMs > PRIORITY_HEDGE_MS) opts = { ...opts, hedgeAfterMs: PRIORITY_HEDGE_MS };
  }

  try {
    const r = await router.run(task, opts);
    const tokens = r.usage.promptTokens + r.usage.completionTokens;
    noteObservedTokens(task.department, tokens);
    let quota: UsageMeter | null = null;
    if (ent && reservation) {
      await settleAiTokens(reservation, tokens);
      const cap = ent.organization?.aiTokenCap ?? null;
      quota = reservation.member && cap !== null
        ? await readMeter(reservation.member.subject, 'ai_tokens', cap)
        : await readMeter(reservation.subject, 'ai_tokens', ent.limits.monthly_ai_tokens);
    }
    await recordAiEvent({ userId: ent?.userId ?? null, organizationId: ent?.aiSubject.type === 'org' ? ent.aiSubject.id : null, plan: ent?.plan ?? 'free', department: task.department, alias: r.alias, model: r.model,
      promptTokens: r.usage.promptTokens, completionTokens: r.usage.completionTokens, ok: true, durationMs: r.durationMs, fallbackUsed: r.fallbackUsed, attempts: r.attempts, errorCode: null });
    return { ...r, quota };
  } catch (e) {
    const failure = aiFailureOf(e);
    if (reservation) await settleAiTokens(reservation, 0).catch(() => undefined);
    await recordAiEvent({ userId: ent?.userId ?? null, organizationId: ent?.aiSubject.type === 'org' ? ent.aiSubject.id : null, plan: ent?.plan ?? 'free', department: task.department, alias: null, model: null,
      promptTokens: failure?.usage.promptTokens ?? 0, completionTokens: failure?.usage.completionTokens ?? 0, ok: false, durationMs: failure?.durationMs ?? Date.now() - startedAt,
      fallbackUsed: failure?.fallbackUsed ?? false, attempts: failure?.attempts ?? 0, errorCode: failure?.errorCode ?? ((e as { code?: string }).code ?? 'error') });
    throw e;
  }
}
