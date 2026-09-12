/**
 * Minimal migration runner — applies each prisma/migrations/<name>/migration.sql
 * in order and records it in _prisma_migrations (the same table Prisma uses).
 * Interchangeable with `prisma migrate deploy`; exists for environments that
 * block binaries.prisma.sh.
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://servix:servix@127.0.0.1:5432/servix',
});
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS _prisma_migrations (
    id                  varchar(36)  PRIMARY KEY,
    checksum            varchar(64)  NOT NULL,
    finished_at         timestamptz,
    migration_name      varchar(255) NOT NULL,
    logs                text,
    rolled_back_at      timestamptz,
    started_at          timestamptz  NOT NULL DEFAULT now(),
    applied_steps_count integer      NOT NULL DEFAULT 0
  )
`);

const applied = new Set(
  (await client.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows.map(
    (r: { migration_name: string }) => r.migration_name,
  ),
);

const migrations = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const name of migrations) {
  if (applied.has(name)) {
    console.log(`skip   ${name}`);
    continue;
  }
  const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  console.log(`apply  ${name}`);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), 1)`,
      [randomUUID(), checksum, name],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`FAILED ${name}:`, (err as Error).message);
    process.exit(1);
  }
}

console.log('migrations complete');
await client.end();
