/**
 * SERVIX API server entry point (Phase E).
 *  - refuses to start in production with missing/weak configuration
 *  - bootstraps the admin account (idempotent, env-driven)
 *  - runs the background worker inline unless WORKER_MODE=external
 *  - schedules repeatable jobs (auto-confirm sweep, orphan cleanup)
 *  - graceful shutdown: HTTP close → finish in-flight job → DB disconnect
 */
import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig, validateProductionConfig } from './lib/config.js';
import { prisma } from './lib/db.js';
import { bootstrapAdmin } from './routes/auth.js';
import { scheduleRepeatables, startWorker, stopWorker } from './lib/jobs.js';
import { checkSchema, LATEST_MIGRATION } from './lib/schemaCheck.js';

const config = loadConfig();

/* Production refuses to boot with missing/weak configuration. */
const problems = validateProductionConfig();
if (problems.length > 0) {
  console.error('FATAL: production configuration is incomplete:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const app = await buildApp();

/* Schema gap detection: migrations are applied manually; a newer image must not crash on an older database.
   /healthz stays up, /readyz reports the pending migration, requests needing the new columns fail cleanly. */
let schemaOk = false;
try {
  const schema = await checkSchema(true);
  schemaOk = schema.ok;
  if (!schema.ok) app.log.error({ missing: schema.missing }, `DATABASE SCHEMA BEHIND: apply migration ${LATEST_MIGRATION} (api/docs/manual-subscriptions-upgrade.sql). The API is up but not ready until then.`);
} catch (err) {
  app.log.error(err, 'schema check failed (database unreachable?) — continuing so /healthz can report');
}

/* Idempotent admin bootstrap (server-side only). Skipped while the schema is behind; it re-runs on the next start. */
if (schemaOk) {
  try { await bootstrapAdmin(); } catch (err) { app.log.error(err, 'admin bootstrap failed — continuing'); }
}

/* Background worker: inline by default; external process in production. */
let repeatTimer: NodeJS.Timeout | null = null;
if (process.env.WORKER_MODE !== 'external') {
  startWorker();
  await scheduleRepeatables();
  repeatTimer = setInterval(() => {
    scheduleRepeatables().catch((err) => app.log.error(err, 'scheduleRepeatables failed'));
  }, 60_000);
  app.log.info('background worker started (inline mode)');
}

await app.listen({ port: config.port, host: config.host });
app.log.info(`OpenAPI docs at http://localhost:${config.port}/api/v1/docs`);

/* Graceful shutdown with a hard deadline. */
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`${signal} received — shutting down gracefully`);
  const deadline = setTimeout(() => {
    app.log.error('shutdown deadline exceeded — forcing exit');
    process.exit(1);
  }, 10_000);
  try {
    if (repeatTimer) clearInterval(repeatTimer);
    await app.close(); // stop accepting HTTP; finish in-flight requests
    await stopWorker(); // let the in-flight job finish
    await prisma.$disconnect();
    clearTimeout(deadline);
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
