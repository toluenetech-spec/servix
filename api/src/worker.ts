/**
 * SERVIX standalone worker process (Phase E).
 * Run with WORKER_MODE=external on the API and this process alongside:
 *   npx tsx src/worker.ts
 * Same PgQueue semantics as the inline worker; graceful shutdown lets the
 * in-flight job finish before exit.
 */
import 'dotenv/config';
import { prisma } from './lib/db.js';
import { scheduleRepeatables, startWorker, stopWorker } from './lib/jobs.js';

console.log('Servix worker starting…');
startWorker();
await scheduleRepeatables();
const timer = setInterval(() => {
  scheduleRepeatables().catch((err) => console.error('scheduleRepeatables failed', err));
}, 60_000);
console.log('Servix worker running (PgQueue driver).');

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — worker shutting down gracefully`);
  const deadline = setTimeout(() => {
    console.error('worker shutdown deadline exceeded — forcing exit');
    process.exit(1);
  }, 10_000);
  clearInterval(timer);
  await stopWorker();
  await prisma.$disconnect();
  clearTimeout(deadline);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
