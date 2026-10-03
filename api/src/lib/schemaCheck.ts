/**
 * Schema readiness: the API image can be deployed before the owner has applied the latest additive
 * migration on the production database (migrations are never run at startup — see PRODUCTION_HARDENING).
 * Instead of crashing at boot or returning opaque 500s, we detect the gap, keep /healthz alive, report
 * `ready: false` on /readyz with the migration name, and log one clear line.
 */
import { prisma } from './db.js';

/** Markers of the newest migration that every request path depends on. Extend when a new migration lands. */
export const LATEST_MIGRATION = '20261004000000_subscriptions_entitlements';
const REQUIRED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'users', column: 'plan_slug' },
  { table: 'plans', column: 'limits' },
  { table: 'organizations', column: 'id' },
  { table: 'usage_periods', column: 'id' },
  { table: 'ai_usage_events', column: 'id' },
];

export type SchemaStatus = { ok: boolean; missing: string[]; pendingMigration: string | null; checkedAt: string };
let cached: { at: number; value: SchemaStatus } | null = null;

export async function checkSchema(force = false): Promise<SchemaStatus> {
  if (!force && cached && Date.now() - cached.at < 30_000 && cached.value.ok) return cached.value;
  let missing: string[] = [];
  try {
    const present = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
      `SELECT table_name::text, column_name::text FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
      REQUIRED_COLUMNS.map((c) => c.table),
    );
    const have = new Set(present.map((r) => `${r.table_name}.${r.column_name}`));
    missing = REQUIRED_COLUMNS.filter((c) => !have.has(`${c.table}.${c.column}`)).map((c) => `${c.table}.${c.column}`);
  } catch (err) {
    // Database unreachable: readiness already reports `database: false`; do not double-report.
    const value: SchemaStatus = { ok: false, missing: ['(database unreachable)'], pendingMigration: null, checkedAt: new Date().toISOString() };
    cached = { at: Date.now(), value };
    throw err;
  }
  const value: SchemaStatus = { ok: missing.length === 0, missing, pendingMigration: missing.length ? LATEST_MIGRATION : null, checkedAt: new Date().toISOString() };
  cached = { at: Date.now(), value };
  return value;
}
