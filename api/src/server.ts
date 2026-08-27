import { buildApp } from './app.js';
import { loadConfig } from './lib/config.js';
import { runAutoConfirmSweep } from './lib/bookingService.js';

const config = loadConfig();
const app = await buildApp();

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`OpenAPI docs at http://localhost:${config.port}/api/v1/docs`);
  // 3-day auto-confirmation sweep (delivered → completed unless disputed).
  setInterval(async () => {
    try {
      const n = await runAutoConfirmSweep();
      if (n > 0) app.log.info(`auto-confirm sweep completed ${n} booking(s)`);
    } catch (err) {
      app.log.error(err, 'auto-confirm sweep failed');
    }
  }, 10 * 60 * 1000).unref();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
