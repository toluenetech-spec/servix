/** Verifies `docs/manual-subscriptions-upgrade.sql` (the guarded Neon SQL Editor script) against an isolated
 *  local PostgreSQL that mimics production: database `neondb`, the 13 earlier migrations applied and recorded
 *  with their real checksums, legacy plan rows and a professional on the old "professional" plan.
 *  Opt-in: RUN_LOCAL_ENTITLEMENT_TESTS=1 (same switch as entitlements-local). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const enabled = process.env.RUN_LOCAL_ENTITLEMENT_TESTS === '1';
const NEW = '20261004000000_subscriptions_entitlements';

describe.skipIf(!enabled)('manual-subscriptions-upgrade.sql (Neon script)', () => {
  let cluster: EmbeddedPostgres; let directory: string; let script: string;
  const connect = async (database: string) => { const c = new pg.Client({ host: '127.0.0.1', port: 55459, user: 'postgres', password: 'pw', database }); await c.connect(); return c; };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-manual-sql-'));
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55459, user: 'postgres', password: 'pw', persistent: false, postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--locale=C', '--lc-messages=C', '--encoding=UTF8'], onLog: () => {}, onError: console.error });
    await cluster.initialise(); await cluster.start();
    await cluster.createDatabase('neondb');
    script = await readFile(join(import.meta.dirname, '../docs/manual-subscriptions-upgrade.sql'), 'utf8');
    const client = await connect('neondb');
    try {
      await client.query(`CREATE TABLE _prisma_migrations (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)`);
      const root = join(import.meta.dirname, '../prisma/migrations');
      for (const name of (await readdir(root)).sort()) {
        if (name === 'migration_lock.toml' || name === NEW) continue;
        const sql = await readFile(join(root, name, 'migration.sql'), 'utf8');
        await client.query(sql);
        await client.query(`INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count) VALUES (gen_random_uuid()::text, $1, $2, now(), 1)`, [createHash('sha256').update(sql).digest('hex'), name]);
      }
      // Live-like data before the upgrade.
      await client.query(`INSERT INTO plans (id, slug, name, price, position, features) VALUES ('p-free', 'free', 'Free', 0, 0, '[]'), ('p-pro', 'professional', 'Servix Pro', 15000, 1, '[]'), ('p-biz', 'business', 'Business', 40000, 2, '[]')`);
      await client.query(`INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at) VALUES ('legacy-user', 'legacy@example.test', 'x', 'Legacy Pro', 'professional', 'active', now(), now())`);
      await client.query(`INSERT INTO professional_profiles (id, user_id, slug, name, title, plan_slug, plan_expires_at, created_at, updated_at) VALUES ('legacy-pro', 'legacy-user', 'legacy-pro', 'Legacy Pro', 'Designer', 'professional', now() + interval '20 days', now(), now())`);
    } finally { await client.end(); }
  }, 180_000);

  afterAll(async () => { if (cluster) await cluster.stop().catch(() => {}); if (directory) await rm(directory, { recursive: true, force: true }); });

  it('refuses to run against a database that is not neondb', async () => {
    const client = await connect('postgres');
    try { await expect(client.query(script)).rejects.toThrow(/Wrong database/); } finally { await client.end(); }
  });

  it('applies the migration once, records it with the Prisma checksum, migrates legacy plans and is idempotent', async () => {
    const client = await connect('neondb');
    try {
      await client.query(script);
      const expected = createHash('sha256').update(await readFile(join(import.meta.dirname, '../prisma/migrations', NEW, 'migration.sql'), 'utf8')).digest('hex');
      const rec = await client.query(`SELECT checksum, applied_steps_count, finished_at FROM _prisma_migrations WHERE migration_name = $1`, [NEW]);
      expect(rec.rowCount).toBe(1); expect(rec.rows[0].checksum).toBe(expected); expect(rec.rows[0].applied_steps_count).toBe(1); expect(rec.rows[0].finished_at).not.toBeNull();
      expect((await client.query(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`)).rows[0].n).toBe(14);
      const plans = await client.query(`SELECT slug, price::int AS price FROM plans WHERE is_active ORDER BY position`);
      expect(plans.rows.map((r) => r.slug)).toEqual(['free', 'go', 'pro', 'team', 'enterprise']);
      expect(plans.rows.find((r) => r.slug === 'team')?.price).toBe(35000);
      expect((await client.query(`SELECT count(*)::int AS n FROM plans WHERE slug IN ('professional', 'business')`)).rows[0].n).toBe(0);
      const u = await client.query(`SELECT plan_slug, plan_expires_at FROM users WHERE id = 'legacy-user'`);
      expect(u.rows[0].plan_slug).toBe('pro'); expect(u.rows[0].plan_expires_at).not.toBeNull();
      expect((await client.query(`SELECT plan_slug FROM professional_profiles WHERE id = 'legacy-pro'`)).rows[0].plan_slug).toBe('pro');
      // Second run: skipped, nothing changes.
      await client.query(script);
      expect((await client.query(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = $1`, [NEW])).rows[0].n).toBe(1);
      expect((await client.query(`SELECT count(*)::int AS n FROM plans`)).rows[0].n).toBe(5);
    } finally { await client.end(); }
  }, 60_000);
});
