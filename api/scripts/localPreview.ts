/**
 * LOCAL PREVIEW ONLY — never used in production and never touches Neon,
 * Brevo, Paystack, R2 or any live system.
 *
 * Boots a throwaway loopback PostgreSQL (embedded-postgres, dev dependency),
 * applies every repo migration, seeds the public catalogue with the repo seed
 * script, creates three local test accounts and starts the real Servix API on
 * 127.0.0.1:8080 with sandbox payments and console email.
 *
 *   cd api && npx tsx scripts/localPreview.ts
 *   # then in the repo root:  VITE_API_URL=/ npm run dev
 *
 * Data lives in api/.local-preview/ (git-ignored). Delete it to start fresh.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(API, '.local-preview');
const PG_PORT = Number(process.env.PREVIEW_PG_PORT ?? 55447);
const previewOrigin = process.env.PREVIEW_ORIGIN ?? (process.env.E2B_SANDBOX_ID ? `https://5173-${process.env.E2B_SANDBOX_ID}.e2b.app` : 'http://localhost:5173');
const dbDir = join(ROOT, 'pgdata');
const fresh = !existsSync(join(dbDir, 'PG_VERSION'));
await mkdir(ROOT, { recursive: true });

const secretFile = join(ROOT, 'jwt-secret');
if (!existsSync(secretFile)) await writeFile(secretFile, randomBytes(48).toString('hex'), { mode: 0o600 });
const jwtSecret = (await readFile(secretFile, 'utf8')).trim();

const DB_PASSWORD = 'local-preview-only';
const PREVIEW_PASSWORD = 'ServixPreview2026!';
Object.assign(process.env, {
  NODE_ENV: 'development', PORT: '8080', HOST: '127.0.0.1',
  DATABASE_URL: `postgresql://postgres:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/postgres`,
  AUTH_JWT_SECRET: jwtSecret,
  CORS_ORIGINS: `${previewOrigin},http://localhost:5173,http://127.0.0.1:5173`,
  APP_BASE_URL: previewOrigin, API_BASE_URL: previewOrigin,
  EMAIL_MODE: 'console', AUTH_MFA_ENABLED: 'false', EMAIL_VERIFICATION_OTP: 'false', AUTH_OAUTH_ENABLED: 'false',
  COMMUNITY_ENABLED: 'true', // local preview only; the committed default stays false
  PAYMENT_MODE: 'sandbox',
  ADMIN_EMAIL: 'admin@servix.local', ADMIN_PASSWORD: PREVIEW_PASSWORD,
  SERVIX_REVIEW_KEY: 'local-preview-review-key',
});

const cluster = new EmbeddedPostgres({
  databaseDir: dbDir, port: PG_PORT, user: 'postgres', password: DB_PASSWORD, persistent: true,
  postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--locale=C', '--lc-messages=C', '--encoding=UTF8'],
  onLog: () => {}, onError: (m) => console.error(String(m)),
});
if (fresh) await cluster.initialise();
try { await cluster.start(); } catch (e) { console.warn('[preview] postgres start:', (e as Error).message); }

const client = cluster.getPgClient(); await client.connect();
try {
  await client.query('CREATE TABLE IF NOT EXISTS _preview_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  const done = new Set((await client.query('SELECT name FROM _preview_migrations')).rows.map((r: { name: string }) => r.name));
  const root = join(API, 'prisma/migrations');
  for (const name of (await readdir(root)).sort()) {
    if (name === 'migration_lock.toml' || done.has(name)) continue;
    console.log(`[preview] applying migration ${name}`);
    await client.query('BEGIN');
    await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
    await client.query('INSERT INTO _preview_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
  }
} finally { await client.end(); }

if (fresh) {
  console.log('[preview] seeding public catalogue (repo seed script)');
  const r = spawnSync('npx', ['tsx', 'prisma/seed.ts'], { cwd: API, env: process.env, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('catalogue seed failed');
  const { prisma } = await import('../src/lib/db.js');
  const { hashPassword } = await import('../src/lib/password.js');
  const passwordHash = await hashPassword(PREVIEW_PASSWORD);
  await prisma.user.create({ data: { email: 'customer@servix.local', fullName: 'Preview Customer', role: 'customer', status: 'active', emailVerifiedAt: new Date(), passwordHash } });
  const pro = await prisma.user.create({ data: { email: 'pro@servix.local', fullName: 'Adaeze Okafor', role: 'professional', status: 'active', emailVerifiedAt: new Date(), passwordHash } });
  // Attach the professional test account to a seeded public profile so it has real gigs/portfolio to manage.
  await prisma.professionalProfile.update({ where: { slug: 'adaeze-okafor' }, data: { userId: pro.id } });
  console.log('[preview] local test accounts created (customer@servix.local, pro@servix.local, admin@servix.local)');
}

process.on('SIGTERM', () => { cluster.stop().catch(() => {}); });
process.on('SIGINT', () => { cluster.stop().catch(() => {}); });
await import('../src/server.js');
console.log(`[preview] API ready; frontend origin ${previewOrigin}`);
