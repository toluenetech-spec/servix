// Standalone disposable LOCAL database test. Never reads DATABASE_URL.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'servix-manual-upgrade-'));
const cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55443,
  user: 'postgres', password: randomUUID(), persistent: false,
  postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--locale=C', '--lc-messages=C', '--encoding=UTF8'], onLog: () => {}, onError: () => {} });
let client;
try {
  await cluster.initialise(); await cluster.start();
  client = cluster.getPgClient(); await client.connect();
  await client.query('CREATE DATABASE neondb'); await client.end();
  client = cluster.getPgClient('neondb'); await client.connect();
  const dir = new URL('../../prisma/migrations/', import.meta.url);
  const names = (await readdir(dir)).filter(n => n.startsWith('202608')).sort();
  await client.query(`CREATE TABLE _prisma_migrations (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL,
    migration_name varchar(255) NOT NULL, started_at timestamptz DEFAULT now(), finished_at timestamptz,
    rolled_back_at timestamptz, applied_steps_count integer DEFAULT 0)`);
  for (const name of names) {
    const sql = await readFile(new URL(`${name}/migration.sql`, dir), 'utf8');
    await client.query(sql);
    await client.query('INSERT INTO _prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count) VALUES($1,$2,$3,now(),1)',
      [randomUUID(), createHash('sha256').update(sql).digest('hex'), name]);
  }
  const script = await readFile(new URL('../../docs/manual-auth-upgrade.sql', import.meta.url), 'utf8');
  await client.query('CREATE TABLE oauth_attempts (dummy integer)');
  await assert.rejects(client.query(script), { code: '42P07' });
  assert.equal((await client.query('SELECT count(*)::int AS n FROM _prisma_migrations')).rows[0].n, 5);
  assert.equal((await client.query("SELECT to_regclass('public.email_verification_otps') AS t")).rows[0].t, null);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='users' AND column_name='auth_version'")).rows[0].n, 0);
  console.log('PASS: a late DDL failure rolls back all three migrations');
  await client.query('DROP TABLE oauth_attempts');
  await client.query(script);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM _prisma_migrations')).rows[0].n, 8);
  console.log('PASS: all three migrations and their records apply together');
  await client.query(script);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM _prisma_migrations')).rows[0].n, 8);
  console.log('PASS: repeat execution with matching history is a no-op');
  await client.query("UPDATE _prisma_migrations SET checksum='wrong' WHERE migration_name=$1", [names[0]]);
  await assert.rejects(client.query(script));
  console.log('PASS: checksum mismatch is refused');
} finally {
  if (client) await client.end().catch(() => {});
  await cluster.stop(); await rm(directory, { recursive: true, force: true });
}
