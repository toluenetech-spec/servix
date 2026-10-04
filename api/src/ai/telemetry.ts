/**
 * Servix AI — internal telemetry.
 *
 * Records, per model attempt: department, alias, model id, duration, outcome,
 * fallback position, token usage and a coarse error code. Kept in a bounded
 * in-memory ring buffer (no schema change) and mirrored to the structured
 * logger. Prompts, answers, user ids and secrets are deliberately NOT stored.
 */
import type { Department, ModelAlias } from './config.js';
import type { AiErrorCode } from './provider.js';

export interface AttemptRecord {
  at: string;
  department: Department;
  alias: ModelAlias;
  model: string;
  durationMs: number;
  ok: boolean;
  /** 0 = primary model, 1 = first fallback, … */
  fallbackIndex: number;
  attempt: number;
  promptTokens: number;
  completionTokens: number;
  errorCode?: AiErrorCode | 'invalid_output' | 'deadline';
  /** Short, secret-scrubbed provider reason (e.g. "model_concurrency", "model not found") for the admin console. */
  detail?: string;
  toolCalls?: number;
}

export interface TaskRecord {
  at: string;
  department: Department;
  ok: boolean;
  durationMs: number;
  modelUsed: string | null;
  aliasUsed: ModelAlias | null;
  fallbackUsed: boolean;
  attempts: number;
  errorCode?: string;
}

type LogFn = (obj: Record<string, unknown>, msg: string) => void;
export interface TelemetryLogger { info: LogFn; warn: LogFn }

const RING = 1000;

export class AiTelemetry {
  private attempts: AttemptRecord[] = [];
  private tasks: TaskRecord[] = [];
  constructor(private logger: TelemetryLogger | null = null) {}

  setLogger(logger: TelemetryLogger | null) { this.logger = logger; }

  recordAttempt(r: Omit<AttemptRecord, 'at'>) {
    const rec = { at: new Date().toISOString(), ...r, ...(r.detail ? { detail: r.detail.replace(/\s+/g, ' ').slice(0, 200) } : {}) };
    this.attempts.push(rec); if (this.attempts.length > RING) this.attempts.shift();
    const line = { ai: { kind: 'attempt', ...rec } };
    if (rec.ok) this.logger?.info(line, 'ai model attempt'); else this.logger?.warn(line, 'ai model attempt failed');
  }

  recordTask(r: Omit<TaskRecord, 'at'>) {
    const rec = { at: new Date().toISOString(), ...r };
    this.tasks.push(rec); if (this.tasks.length > RING) this.tasks.shift();
    const line = { ai: { kind: 'task', ...rec } };
    if (rec.ok) this.logger?.info(line, 'ai task'); else this.logger?.warn(line, 'ai task failed');
  }

  recent(limit = 50) { return { attempts: this.attempts.slice(-limit), tasks: this.tasks.slice(-limit) }; }

  /** Aggregates for the admin console. */
  summary() {
    const byModel = new Map<string, { model: string; calls: number; ok: number; failed: number; totalMs: number; promptTokens: number; completionTokens: number; errors: Record<string, number>; lastError: { at: string; code: string; detail: string | null } | null; lastOkAt: string | null }>();
    for (const a of this.attempts) {
      const m = byModel.get(a.model) ?? { model: a.model, calls: 0, ok: 0, failed: 0, totalMs: 0, promptTokens: 0, completionTokens: 0, errors: {}, lastError: null, lastOkAt: null };
      m.calls++; if (a.ok) { m.ok++; m.lastOkAt = a.at; } else { m.failed++; if (a.errorCode) m.errors[a.errorCode] = (m.errors[a.errorCode] ?? 0) + 1; m.lastError = { at: a.at, code: a.errorCode ?? 'unknown', detail: a.detail ?? null }; }
      m.totalMs += a.durationMs; m.promptTokens += a.promptTokens; m.completionTokens += a.completionTokens;
      byModel.set(a.model, m);
    }
    const byDepartment = new Map<string, { department: string; tasks: number; ok: number; failed: number; fallbackUsed: number; totalMs: number }>();
    for (const t of this.tasks) {
      const d = byDepartment.get(t.department) ?? { department: t.department, tasks: 0, ok: 0, failed: 0, fallbackUsed: 0, totalMs: 0 };
      d.tasks++; if (t.ok) d.ok++; else d.failed++; if (t.fallbackUsed) d.fallbackUsed++; d.totalMs += t.durationMs;
      byDepartment.set(t.department, d);
    }
    return {
      window: { attempts: this.attempts.length, tasks: this.tasks.length, since: this.attempts[0]?.at ?? null },
      models: [...byModel.values()].map((m) => ({ ...m, avgMs: m.calls ? Math.round(m.totalMs / m.calls) : 0 })),
      departments: [...byDepartment.values()].map((d) => ({ ...d, avgMs: d.tasks ? Math.round(d.totalMs / d.tasks) : 0 })),
    };
  }

  reset() { this.attempts = []; this.tasks = []; }
}
