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

/**
 * Optional additive migrations: only their own feature answers 503 SCHEMA_PENDING while they are missing, so
 * they never flip /readyz to ready:false. They are still reported (`optionalPending`) so the owner sees them.
 */
const OPTIONAL_TABLES: Array<{ table: string; migration: string; script: string }> = [
  { table: 'ai_feedback', migration: '20261004120000_ai_feedback', script: 'api/docs/manual-ai-feedback.sql' },
];

export type SchemaStatus = {
  ok: boolean; missing: string[]; pendingMigration: string | null; checkedAt: string;
  optionalPending: Array<{ table: string; migration: string; script: string }>;
};
let cached: { at: number; value: SchemaStatus } | null = null;

export async function checkSchema(force = false): Promise<SchemaStatus> {
  if (!force && cached && Date.now() - cached.at < 30_000 && cached.value.ok) return cached.value;
  let missing: string[] = [];
  let optionalPending: SchemaStatus['optionalPending'] = [];
  try {
    const present = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
      `SELECT table_name::text, column_name::text FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
      [...REQUIRED_COLUMNS.map((c) => c.table), ...OPTIONAL_TABLES.map((t) => t.table)],
    );
    const have = new Set(present.map((r) => `${r.table_name}.${r.column_name}`));
    const tables = new Set(present.map((r) => r.table_name));
    missing = REQUIRED_COLUMNS.filter((c) => !have.has(`${c.table}.${c.column}`)).map((c) => `${c.table}.${c.column}`);
    optionalPending = OPTIONAL_TABLES.filter((t) => !tables.has(t.table));
  } catch (err) {
    // Database unreachable: readiness already reports `database: false`; do not double-report.
    const value: SchemaStatus = { ok: false, missing: ['(database unreachable)'], pendingMigration: null, checkedAt: new Date().toISOString(), optionalPending: [] };
    cached = { at: Date.now(), value };
    throw err;
  }
  const value: SchemaStatus = { ok: missing.length === 0, missing, pendingMigration: missing.length ? LATEST_MIGRATION : null, checkedAt: new Date().toISOString(), optionalPending };
  cached = { at: Date.now(), value };
  return value;
}
