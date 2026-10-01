/**
 * In-app notifications.
 *  - Every row is created by a real platform event (booking, payment, payout,
 *    application decision, connection, chat) or an explicit admin broadcast.
 *  - Written inside the caller's transaction whenever one exists so a
 *    notification can never describe something that did not happen.
 *  - Never contains secrets, codes or payment credentials. Text only.
 */
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from './db.js';

type Tx = Prisma.TransactionClient | typeof prisma;

export interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  broadcastId?: string | null;
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

export async function notify(tx: Tx, input: NotificationInput): Promise<void> {
  await tx.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: clip(input.title.trim(), 120),
      body: clip(input.body.trim(), 2000),
      link: input.link ?? null,
      broadcastId: input.broadcastId ?? null,
    },
  });
}

/** Best-effort variant for places outside a transaction; never breaks the main flow. */
export async function notifySafely(input: NotificationInput): Promise<void> {
  try { await notify(prisma, input); } catch (err) { console.error('notification failed', err); }
}

/**
 * Collapse repeated chat notifications: if the recipient already has an
 * unread notification for this thread, do not add another.
 */
export async function notifyChatOnce(tx: Tx, userId: string, threadId: string, senderName: string): Promise<void> {
  const link = `/dashboard/messages?thread=${encodeURIComponent(threadId)}`;
  const existing = await tx.notification.findFirst({ where: { userId, type: 'chat.message', link, readAt: null }, select: { id: true } });
  if (existing) return;
  await notify(tx, { userId, type: 'chat.message', title: `New message from ${senderName}`, body: 'Open Messages to read and reply.', link });
}

/** Resolve the account that owns a professional profile (null for seeded/unclaimed profiles). */
export async function professionalUserId(tx: Tx, professionalId: string): Promise<string | null> {
  const profile = await tx.professionalProfile.findUnique({ where: { id: professionalId }, select: { userId: true } });
  return profile?.userId ?? null;
}

/**
 * Admin broadcast fan-out in fixed-size batches. Returns the recipient count.
 * Only active (non-deleted) accounts receive broadcasts.
 */
export async function broadcast(adminId: string, audience: 'all' | 'customers' | 'professionals' | 'user', input: { title: string; body: string; link?: string | null; userId?: string }): Promise<{ id: string; recipientCount: number }> {
  const where: Prisma.UserWhereInput = { deletedAt: null, status: { in: ['active', 'pending_verification'] } };
  if (audience === 'customers') where.role = 'customer';
  if (audience === 'professionals') where.role = 'professional';
  if (audience === 'user') where.id = input.userId ?? '';
  const record = await prisma.notificationBroadcast.create({ data: { adminId, audience, title: clip(input.title.trim(), 120), body: clip(input.body.trim(), 2000), link: input.link ?? null } });
  let cursor: string | undefined; let total = 0;
  for (;;) {
    const users = await prisma.user.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (!users.length) break;
    await prisma.notification.createMany({ data: users.map(u => ({ userId: u.id, type: 'admin.broadcast', title: record.title, body: record.body, link: record.link, broadcastId: record.id })) });
    total += users.length; cursor = users[users.length - 1]!.id;
    if (users.length < 500) break;
  }
  await prisma.notificationBroadcast.update({ where: { id: record.id }, data: { recipientCount: total } });
  return { id: record.id, recipientCount: total };
}
