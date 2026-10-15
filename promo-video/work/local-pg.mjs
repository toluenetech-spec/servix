// Starts an isolated embedded PostgreSQL for screenshot capture (not production).
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'servix-promo-pg-'));
const pg = new EmbeddedPostgres({ databaseDir: join(dir, 'db'), port: 55480, user: 'postgres', password: 'promo', persistent: false,
  postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--locale=C', '--lc-messages=C', '--encoding=UTF8'], onLog: () => {}, onError: console.error });
await pg.initialise(); await pg.start();
const client = pg.getPgClient(); await client.connect();
const root = '/home/user/servix/api/prisma/migrations';
for (const name of (await readdir(root)).sort()) { if (name === 'migration_lock.toml') continue; await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8')); }
await client.end();
console.log('PG_READY postgresql://postgres:promo@127.0.0.1:55480/postgres');
process.on('SIGTERM', async () => { await pg.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);
