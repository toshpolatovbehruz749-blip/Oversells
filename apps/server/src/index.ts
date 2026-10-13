import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';

// .env next to the server or at the repository root (for `npm run dev`).
loadEnv({ path: [path.resolve('.env'), path.resolve('../../.env')], quiet: true });

const config = loadConfig();
const { app, services } = await buildApp({ config });

const recovered = await services.compile.recoverInterruptedJobs();
if (recovered > 0) app.log.warn(`Marked ${recovered} interrupted compile job(s) as failed`);

if (config.COMPILE_CHECK_IMAGE) {
  const check = await services.runner.check();
  if (check.ok) app.log.info('Compiler ready');
  else app.log.warn(`Compiler not ready: ${check.message}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
