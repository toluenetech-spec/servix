/**
 * Realtime layer for Messages (community chat).
 *
 * In-process event bus: Servix runs a single API instance with its inline worker (no Redis by
 * design), so a per-user subscriber map is enough to fan out chat events to every open tab or
 * app session of a user. If the API is ever scaled to several replicas this must move to
 * PostgreSQL LISTEN/NOTIFY — the publish/subscribe surface below stays the same.
 *
 * Ephemeral state (never persisted): who currently holds an open event stream (presence),
 * when they were last seen, and typing signals.
 *
 * Persisted (additive, optional): per-thread "delivered" watermarks `chat_threads.delivered_at_a`
 * / `delivered_at_b` (migration 20261107000000_chat_delivery, api/docs/manual-chat-upgrade.sql).
 * They are read and written with raw SQL guarded by a column check, so the API keeps working
 * (ticks degrade to sent/seen) until the owner applies the SQL — no startup migration, no crash.
 */
import { prisma } from './db.js';

/** Wire shape of a chat message (see `shapeMessage` in routes/community.ts). */
export type ChatMessagePayload = { id: string; body: string; senderId: string; createdAt: Date | string; clientId?: string; [extra: string]: unknown };

export type ChatEvent =
  | { type: 'hello'; online: string[]; lastSeen: Record<string, string> }
  | { type: 'message'; threadId: string; message: ChatMessagePayload }
  | { type: 'message_update'; threadId: string; message: ChatMessagePayload }
  | { type: 'typing'; threadId: string; userId: string; typing: boolean }
  | { type: 'read'; threadId: string; userId: string; at: string }
  | { type: 'delivered'; threadId: string; userId: string; at: string }
  | { type: 'presence'; userId: string; online: boolean; lastSeen: string | null }
  | { type: 'connection'; connectionId: string; status: string }
  | { type: 'thread'; threadId: string };

type Subscriber = (event: ChatEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();
const lastSeen = new Map<string, Date>();
export const MAX_STREAMS_PER_USER = 6;

export function streamsFor(userId: string): number {
  return subscribers.get(userId)?.size ?? 0;
}

export function isOnline(userId: string): boolean {
  return streamsFor(userId) > 0;
}

export function lastSeenAt(userId: string): Date | null {
  return isOnline(userId) ? null : (lastSeen.get(userId) ?? null);
}

export function subscribe(userId: string, fn: Subscriber): () => void {
  let set = subscribers.get(userId);
  if (!set) { set = new Set(); subscribers.set(userId, set); }
  set.add(fn);
  return () => {
    const s = subscribers.get(userId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) { subscribers.delete(userId); lastSeen.set(userId, new Date()); }
  };
}

export function publish(userId: string, event: ChatEvent): void {
  const set = subscribers.get(userId);
  if (!set) return;
  for (const fn of set) {
    try { fn(event); } catch { /* a broken subscriber must never affect the others */ }
  }
}

export function publishMany(userIds: Iterable<string>, event: ChatEvent): void {
  for (const id of new Set(userIds)) publish(id, event);
}

/* ---------------- delivered watermarks (optional columns) ---------------- */

let deliveryColumnsChecked = 0;
let deliveryColumnsPresent = false;
const CHECK_TTL_MS = 60_000;

export async function deliveryColumnsAvailable(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && deliveryColumnsPresent) return true;
  if (!force && now - deliveryColumnsChecked < CHECK_TTL_MS) return deliveryColumnsPresent;
  deliveryColumnsChecked = now;
  try {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'chat_threads'
        AND column_name IN ('delivered_at_a', 'delivered_at_b')`;
    deliveryColumnsPresent = rows.length === 2;
  } catch {
    deliveryColumnsPresent = false;
  }
  return deliveryColumnsPresent;
}

/** For tests: forget the cached column check. */
export function resetDeliveryColumnCache(): void { deliveryColumnsChecked = 0; deliveryColumnsPresent = false; }

export type DeliveryMarks = { deliveredAtA: Date | null; deliveredAtB: Date | null };

/** Delivered watermarks for a set of threads (empty map when the columns are not there yet). */
export async function deliveryMarks(threadIds: string[]): Promise<Map<string, DeliveryMarks>> {
  const out = new Map<string, DeliveryMarks>();
  if (!threadIds.length || !(await deliveryColumnsAvailable())) return out;
  const rows = await prisma.$queryRaw<Array<{ id: string; delivered_at_a: Date | null; delivered_at_b: Date | null }>>`
    SELECT id, delivered_at_a, delivered_at_b FROM chat_threads WHERE id = ANY(${threadIds}::text[])`;
  for (const r of rows) out.set(r.id, { deliveredAtA: r.delivered_at_a, deliveredAtB: r.delivered_at_b });
  return out;
}

/** Record that `userId` has received everything in the thread up to now. Returns the timestamp or null when unsupported. */
export async function markDelivered(threadId: string, userId: string, side: 'a' | 'b'): Promise<Date | null> {
  if (!(await deliveryColumnsAvailable())) return null;
  const at = new Date();
  if (side === 'a') {
    await prisma.$executeRaw`UPDATE chat_threads SET delivered_at_a = ${at} WHERE id = ${threadId} AND participant_a_id = ${userId} AND (delivered_at_a IS NULL OR delivered_at_a < ${at})`;
  } else {
    await prisma.$executeRaw`UPDATE chat_threads SET delivered_at_b = ${at} WHERE id = ${threadId} AND participant_b_id = ${userId} AND (delivered_at_b IS NULL OR delivered_at_b < ${at})`;
  }
  return at;
}

/* ---------------- SSE helpers ---------------- */

export function sseFrame(event: ChatEvent | Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
