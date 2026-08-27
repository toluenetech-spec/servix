/**
 * Audit log (Phase E). Every admin mutation and sensitive operation is
 * recorded here — written inside the SAME database transaction as the
 * mutation whenever one exists, so an action can never happen unaudited.
 */
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from './db.js';

type Tx = Prisma.TransactionClient | typeof prisma;

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: object;
  ip?: string;
}

export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      data: (entry.data ?? {}) as object,
      ip: entry.ip ?? null,
    },
  });
}
