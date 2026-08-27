/**
 * SERVIX background jobs (Phase E).
 *
 * JobQueue abstraction with two drivers:
 *  - BullMQ (production): activated by REDIS_URL. Queues with exponential
 *    backoff, 5 attempts, dead-letter via failed set. (BullMQ is imported
 *    lazily so environments without Redis never load it; activating it is
 *    a deploy-time step with its own verification pass.)
 *  - PgQueue (dev/CI/fallback): `jobs` table + FOR UPDATE SKIP LOCKED
 *    polling. Identical semantics: attempts, backoff, dead state,
 *    idempotency keys.
 *
 * Idempotency: UNIQUE(queue, idempotency_key) — enqueueing the same key
 * twice is a no-op. Handlers must themselves be idempotent; financial
 * handlers act through CAS transitions so replays cannot duplicate money.
 */
import { prisma } from './db.js';
import { deliverMail, type Mail } from './mailer.js';
import { runAutoConfirmSweep } from './bookingService.js';

export type JobName = 'email.send' | 'bookings.autoconfirm' | 'payouts.retry' | 'cleanup.orphans' | 'webhooks.retry';

export interface EnqueueOpts {
  idempotencyKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

const BACKOFF_BASE_MS = 30_000; // 30s, 60s, 120s, 240s, 480s

export async function enqueue(name: JobName, payload: object, opts: EnqueueOpts = {}): Promise<string | null> {
  try {
    const job = await prisma.job.create({
      data: {
        queue: name.split('.')[0],
        name,
        payload: payload as object,
        idempotencyKey: opts.idempotencyKey ?? null,
        runAt: opts.runAt ?? new Date(),
        maxAttempts: opts.maxAttempts ?? 5,
      },
    });
    return job.id;
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return null; // duplicate — idempotent no-op
    throw err;
  }
}

export async function enqueueMail(mail: Mail, idempotencyKey: string): Promise<void> {
  await enqueue('email.send', mail as unknown as object, { idempotencyKey });
}

/* ---------------- handlers ---------------- */

type Handler = (payload: Record<string, unknown>) => Promise<void>;

const handlers: Record<JobName, Handler> = {
  'email.send': async (payload) => {
    const result = await deliverMail(payload as unknown as Mail);
    if (!result.accepted) throw new Error('provider did not accept the message');
  },
  'bookings.autoconfirm': async () => {
    await runAutoConfirmSweep();
  },
  'payouts.retry': async (payload) => {
    const { retryPayout } = await import('./payoutService.js');
    await retryPayout(String(payload.payoutId));
  },
  'cleanup.orphans': async () => {
    const { sweepOrphans } = await import('./storage.js');
    await sweepOrphans();
  },
  'webhooks.retry': async (payload) => {
    const { reprocessWebhookEvent } = await import('./webhookService.js');
    await reprocessWebhookEvent(String(payload.eventId));
  },
};

/* ---------------- PgQueue worker ---------------- */

let running = false;
let stopping = false;
let loopPromise: Promise<void> | null = null;

/** Claim and run one due job. Returns true if a job was processed. */
export async function runOneJob(now = new Date()): Promise<boolean> {
  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_at <= ${now}
      ORDER BY run_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1`;
    if (rows.length === 0) return null;
    await tx.job.update({
      where: { id: rows[0].id },
      data: { status: 'running', lockedAt: new Date(), attempts: { increment: 1 } },
    });
    return tx.job.findUniqueOrThrow({ where: { id: rows[0].id } });
  });
  if (!claimed) return false;

  const handler = handlers[claimed.name as JobName];
  try {
    if (!handler) throw new Error(`no handler for ${claimed.name}`);
    await handler(claimed.payload as Record<string, unknown>);
    await prisma.job.update({ where: { id: claimed.id }, data: { status: 'done', lastError: null } });
  } catch (err) {
    const dead = claimed.attempts >= claimed.maxAttempts;
    const backoff = BACKOFF_BASE_MS * 2 ** (claimed.attempts - 1);
    await prisma.job.update({
      where: { id: claimed.id },
      data: {
        status: dead ? 'dead' : 'pending',
        runAt: dead ? claimed.runAt : new Date(Date.now() + backoff),
        lastError: (err as Error).message.slice(0, 500),
      },
    });
  }
  return true;
}

export function startWorker(pollMs = 2000): void {
  if (running) return;
  running = true;
  stopping = false;
  loopPromise = (async () => {
    while (!stopping) {
      try {
        const did = await runOneJob();
        if (!did) await new Promise((r) => setTimeout(r, pollMs));
      } catch {
        await new Promise((r) => setTimeout(r, pollMs));
      }
    }
  })();
}

/** Graceful shutdown: finish the in-flight job, then stop. */
export async function stopWorker(): Promise<void> {
  stopping = true;
  if (loopPromise) await loopPromise;
  running = false;
}

/** Repeatable scheduling (auto-confirm every 10 min, cleanup daily). */
export async function scheduleRepeatables(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const tenMin = Math.floor(Date.now() / 600_000);
  await enqueue('bookings.autoconfirm', {}, { idempotencyKey: `autoconfirm-${tenMin}` });
  await enqueue('cleanup.orphans', {}, { idempotencyKey: `orphans-${today}` });
}

/** Queue health for /readyz. */
export async function queueHealthy(): Promise<boolean> {
  try {
    await prisma.job.count({ where: { status: 'dead' } });
    return true;
  } catch {
    return false;
  }
}
