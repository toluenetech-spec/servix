/**
 * Metered usage (monthly counters) and the AI token quota.
 *
 * Periods are calendar months in UTC; counters live in `usage_periods` keyed by
 * (subject, metric, period_start). AI calls RESERVE an estimate atomically before the model runs
 * (`UPDATE … WHERE used + reserved < allowance` — a single statement, so concurrent requests cannot
 * both slip through) and SETTLE to the real token count afterwards. The last request before the
 * allowance is exhausted may overshoot by at most that single request; it is counted, never hidden.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import { PLAN_LABEL, nextPlanForLimit, type PlanSlug } from './catalog.js';
import type { Entitlements } from './index.js';

export type UsageSubject = { type: 'user' | 'org'; id: string };
export type UsageMetric = 'ai_tokens' | 'exports';

export const periodStart = (now = new Date()): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const nextPeriodStart = (now = new Date()): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

export type UsageLevel = 'ok' | 'warning' | 'critical' | 'exhausted';
export interface UsageMeter {
  metric: UsageMetric;
  used: number;
  reserved: number;
  allowed: number | null;
  remaining: number | null;
  percent: number | null;
  level: UsageLevel;
  requests: number;
  periodStart: string;
  resetAt: string;
}

export const WARN_AT = 0.75;
export const CRITICAL_AT = 0.9;

export function meterOf(metric: UsageMetric, used: number, reserved: number, allowed: number | null, requests = 0, now = new Date()): UsageMeter {
  const total = used + reserved;
  const remaining = allowed === null ? null : Math.max(0, allowed - total);
  const percent = allowed === null ? null : allowed === 0 ? 100 : Math.min(100, Math.round((total / allowed) * 1000) / 10);
  const level: UsageLevel = allowed === null ? 'ok' : total >= allowed ? 'exhausted' : total >= allowed * CRITICAL_AT ? 'critical' : total >= allowed * WARN_AT ? 'warning' : 'ok';
  return { metric, used, reserved, allowed, remaining, percent, level, requests, periodStart: periodStart(now).toISOString(), resetAt: nextPeriodStart(now).toISOString() };
}

async function ensureRow(subject: UsageSubject, metric: UsageMetric, start: Date): Promise<void> {
  await prisma.$executeRaw`INSERT INTO "usage_periods" ("id", "subject_type", "subject_id", "metric", "period_start", "used", "reserved", "requests", "updated_at")
    VALUES (${randomUUID()}, ${subject.type}, ${subject.id}, ${metric}, ${dateOnly(start)}::date, 0, 0, 0, NOW())
    ON CONFLICT ("subject_type", "subject_id", "metric", "period_start") DO NOTHING`;
}

export async function readMeter(subject: UsageSubject, metric: UsageMetric, allowed: number | null, now = new Date()): Promise<UsageMeter> {
  const row = await prisma.usagePeriod.findUnique({ where: { subjectType_subjectId_metric_periodStart: { subjectType: subject.type, subjectId: subject.id, metric, periodStart: periodStart(now) } } });
  return meterOf(metric, Number(row?.used ?? 0n), Number(row?.reserved ?? 0n), allowed, row?.requests ?? 0, now);
}

/** Atomic reservation. Returns the granted amount (0 when exhausted; may be smaller than `estimate` when little allowance is left). */
export async function reserve(subject: UsageSubject, metric: UsageMetric, estimate: number, allowed: number | null, now = new Date()): Promise<{ reserved: number; used: number; reservedTotal: number }> {
  const start = periodStart(now);
  const amount = Math.max(1, Math.floor(estimate));
  await ensureRow(subject, metric, start);
  // The row is locked (FOR UPDATE) while the grant is computed, so two concurrent requests are serialised
  // and the second one sees the first one's reservation.
  const cap = allowed === null ? null : BigInt(Math.max(0, Math.floor(allowed)));
  const rows = await prisma.$queryRaw<Array<{ used: bigint; reserved: bigint; grant: bigint }>>`
    WITH cur AS (
      SELECT "id", CASE WHEN ${cap}::bigint IS NULL THEN ${amount}::bigint ELSE LEAST(${amount}::bigint, GREATEST(${cap}::bigint - "used" - "reserved", 0)) END AS grant
      FROM "usage_periods"
      WHERE "subject_type" = ${subject.type} AND "subject_id" = ${subject.id} AND "metric" = ${metric} AND "period_start" = ${dateOnly(start)}::date
      FOR UPDATE
    )
    UPDATE "usage_periods" u SET "reserved" = u."reserved" + cur.grant, "updated_at" = NOW()
    FROM cur WHERE u."id" = cur."id" AND cur.grant > 0
    RETURNING u."used", u."reserved", cur.grant`;
  const row = rows[0];
  if (!row) {
    const current = await prisma.usagePeriod.findUnique({ where: { subjectType_subjectId_metric_periodStart: { subjectType: subject.type, subjectId: subject.id, metric, periodStart: start } }, select: { used: true, reserved: true } });
    return { reserved: 0, used: Number(current?.used ?? 0n), reservedTotal: Number(current?.reserved ?? 0n) };
  }
  return { reserved: Number(row.grant), used: Number(row.used), reservedTotal: Number(row.reserved) };
}

/** Releases a reservation and books the real amount (0 when the task failed and is not charged). */
export async function settle(subject: UsageSubject, metric: UsageMetric, reserved: number, actual: number, countRequest = true, now = new Date()): Promise<void> {
  const start = periodStart(now);
  await prisma.$executeRaw`UPDATE "usage_periods" SET "reserved" = GREATEST("reserved" - ${Math.floor(reserved)}::bigint, 0), "used" = "used" + ${Math.max(0, Math.floor(actual))}::bigint,
      "requests" = "requests" + ${countRequest ? 1 : 0}, "updated_at" = NOW()
    WHERE "subject_type" = ${subject.type} AND "subject_id" = ${subject.id} AND "metric" = ${metric} AND "period_start" = ${dateOnly(start)}::date`;
}

/** Simple monthly counter (exports): consumes one unit or throws PLAN_LIMIT. Atomic. */
export async function consumeMonthly(subject: UsageSubject, metric: UsageMetric, allowed: number | null, plan: PlanSlug, limitKey: 'monthly_exports', now = new Date()): Promise<UsageMeter> {
  const r = await reserve(subject, metric, 1, allowed, now);
  if (allowed !== null && r.reserved === 0) {
    const upgradeTo = nextPlanForLimit(limitKey, plan);
    throw new ApiError(403, 'PLAN_LIMIT', `You have used all ${allowed} exports included in your ${PLAN_LABEL[plan]} plan this month. Your allowance resets on ${nextPeriodStart(now).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`, undefined,
      { kind: 'limit', limit: limitKey, plan, upgradeTo, upgradeToLabel: upgradeTo ? PLAN_LABEL[upgradeTo] : null, used: allowed, allowed, resetAt: nextPeriodStart(now).toISOString() });
  }
  await settle(subject, metric, r.reserved, 1, true, now);
  return readMeter(subject, metric, allowed, now);
}

/* ------------------------------------------------------------------ AI quota */

export interface AiReservation {
  subject: UsageSubject;
  reserved: number;
  /** Secondary per-member reservation inside a team pool (when a member cap is configured). */
  member?: { subject: UsageSubject; reserved: number };
}

export function aiQuotaExceededError(ent: Entitlements, meter: UsageMeter, scope: 'plan' | 'member'): ApiError {
  const resetAt = new Date(meter.resetAt);
  const resetLabel = resetAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const upgradeTo = scope === 'plan' ? nextPlanForLimit('monthly_ai_tokens', ent.plan) : null;
  const message = scope === 'member'
    ? `You have used your personal Servix AI allowance for this month inside your team. A team admin can raise your cap, or it resets on ${resetLabel}.`
    : `You have used all ${(meter.allowed ?? 0).toLocaleString('en-NG')} Servix AI tokens in your ${PLAN_LABEL[ent.plan]} plan this month. Your allowance resets on ${resetLabel}${upgradeTo ? `, or upgrade to ${PLAN_LABEL[upgradeTo]} for more` : ''}.`;
  return new ApiError(403, 'AI_QUOTA_EXCEEDED', message, undefined,
    { kind: 'ai_quota', plan: ent.plan, upgradeTo, upgradeToLabel: upgradeTo ? PLAN_LABEL[upgradeTo] : null, used: meter.used, allowed: meter.allowed, resetAt: meter.resetAt, scope });
}

/** Reserve AI tokens for a task; throws AI_QUOTA_EXCEEDED when nothing is left. */
export async function reserveAiTokens(ent: Entitlements, estimate: number, now = new Date()): Promise<AiReservation> {
  const allowed = ent.limits.monthly_ai_tokens;
  const subject = ent.aiSubject;
  const r = await reserve(subject, 'ai_tokens', estimate, allowed, now);
  if (allowed !== null && r.reserved === 0) throw aiQuotaExceededError(ent, await readMeter(subject, 'ai_tokens', allowed, now), 'plan');
  const reservation: AiReservation = { subject, reserved: r.reserved };
  if (subject.type === 'org') {
    // Members' personal usage is always tracked inside the pool (so admins can see it); a cap is enforced only when set.
    const cap = ent.organization?.aiTokenCap ?? null;
    const memberSubject: UsageSubject = { type: 'user', id: ent.userId };
    const m = await reserve(memberSubject, 'ai_tokens', estimate, cap, now);
    if (cap !== null && m.reserved === 0) {
      await settle(subject, 'ai_tokens', r.reserved, 0, false, now);
      throw aiQuotaExceededError(ent, await readMeter(memberSubject, 'ai_tokens', cap, now), 'member');
    }
    reservation.member = { subject: memberSubject, reserved: m.reserved };
  }
  return reservation;
}

export async function settleAiTokens(reservation: AiReservation, actualTokens: number, now = new Date()): Promise<void> {
  await settle(reservation.subject, 'ai_tokens', reservation.reserved, actualTokens, true, now);
  if (reservation.member) await settle(reservation.member.subject, 'ai_tokens', reservation.member.reserved, actualTokens, true, now);
}

/** Current AI meter for an account (pool + optional member cap). */
export async function aiMeters(ent: Entitlements, now = new Date()): Promise<{ pool: UsageMeter; member: UsageMeter | null }> {
  const pool = await readMeter(ent.aiSubject, 'ai_tokens', ent.limits.monthly_ai_tokens, now);
  const member = ent.aiSubject.type === 'org' ? await readMeter({ type: 'user', id: ent.userId }, 'ai_tokens', ent.organization?.aiTokenCap ?? null, now) : null;
  return { pool, member };
}

/** Record one AI task in the ledger. Never throws; never stores prompts, answers or secrets. */
export async function recordAiEvent(input: {
  userId: string | null; organizationId: string | null; plan: PlanSlug; department: string; alias: string | null; model: string | null;
  promptTokens: number; completionTokens: number; ok: boolean; durationMs: number; fallbackUsed: boolean; attempts: number; errorCode: string | null;
}): Promise<void> {
  try {
    await prisma.aiUsageEvent.create({ data: {
      userId: input.userId, organizationId: input.organizationId, planSlug: input.plan, department: input.department, modelAlias: input.alias, model: input.model,
      promptTokens: input.promptTokens, completionTokens: input.completionTokens, totalTokens: input.promptTokens + input.completionTokens,
      ok: input.ok, durationMs: Math.max(0, Math.round(input.durationMs)), fallbackUsed: input.fallbackUsed, attempts: Math.max(1, input.attempts), errorCode: input.errorCode,
    } });
  } catch {
    /* Ledger failures must never break the user's request. */
  }
}
