/**
 * The compile worker service: runs queued compile jobs in the Docker sandbox
 * (the only process that needs the Docker socket) and renders the template
 * previews. Exposes /health and /metrics on WORKER_PORT.
 */
import path from 'node:path';
import { createServer } from 'node:http';
import { config as loadEnv } from 'dotenv';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { createPrisma } from './db.js';
import { createStorage, prepareStorage } from './storage/create.js';
import { DockerRunner } from './compile/docker-runner.js';
import { CompileProcessor } from './compile/processor.js';
import { PgNotifier } from './compile/notifier.js';
import { CompileWorker } from './compile/worker.js';
import { Semaphore } from './compile/compile-service.js';
import { TemplatePreviewService } from './templates/preview-service.js';
import { TemplateStore } from './projects/templates.js';
import { resolveTemplatesDir } from './app.js';
import { loggerOptions } from './logging.js';
import { registry } from './metrics.js';

loadEnv({ path: [path.resolve('.env'), path.resolve('../../.env')], quiet: true });

const config = loadConfig();
const log = pino(loggerOptions(config.LOG_LEVEL, 'worker'));
const prisma = createPrisma(config.DATABASE_URL);
const storage = createStorage(config);
await prepareStorage(storage, config);
const runner = new DockerRunner({
  image: config.COMPILE_IMAGE,
  timeoutMs: config.COMPILE_TIMEOUT_MS,
  memoryMb: config.COMPILE_MEMORY_MB,
  cpus: config.COMPILE_CPUS,
  workdirMb: config.COMPILE_WORKDIR_MB,
  maxOutputBytes: config.COMPILE_MAX_OUTPUT_BYTES,
  socketPath: config.DOCKER_SOCKET,
  dockerHost: config.DOCKER_HOST,
});

const check = await runner.check();
if (!check.ok) log.warn(`Compiler not ready: ${check.message}`);

const notifier = new PgNotifier(config.DATABASE_URL, prisma, log);
const worker = new CompileWorker(
  prisma,
  new CompileProcessor(prisma, storage, runner, { keepOutputs: config.COMPILE_KEEP_OUTPUTS }),
  notifier,
  {
    concurrency: config.COMPILE_CONCURRENCY,
    heartbeatMs: config.WORKER_HEARTBEAT_MS,
    staleMs: config.WORKER_STALE_MS,
    maxAttempts: config.WORKER_MAX_ATTEMPTS,
    pollMs: config.COMPILE_POLL_MS,
  },
  log,
);
await notifier.start();
await worker.start();

// Template previews are rendered here and read from storage by the apps.
if (check.ok && config.TEMPLATE_PREVIEWS_WARMUP) {
  const slots = new Semaphore(1);
  const withSlot = async <T>(fn: () => Promise<T>) => {
    const release = await slots.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
  const previews = new TemplatePreviewService(
    new TemplateStore(resolveTemplatesDir(config.TEMPLATES_DIR)),
    storage,
    runner,
    { withSlot },
    log,
  );
  void previews.warmUp();
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.url === '/health') {
      const ok = check.ok || (await runner.check()).ok;
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'compiler_unavailable', workerId: worker.id, activeJobs: worker.activeJobs }));
      return;
    }
    if (req.url === '/metrics' && config.METRICS_TOKEN) {
      if (req.headers.authorization !== `Bearer ${config.METRICS_TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200, { 'content-type': registry.contentType });
      res.end(await registry.metrics());
      return;
    }
    res.writeHead(404).end();
  })().catch(() => res.writeHead(500).end());
});
server.listen(config.WORKER_PORT, config.HOST, () => log.info(`Worker health/metrics on port ${config.WORKER_PORT}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info(`${signal} received, finishing running jobs`);
    void (async () => {
      server.close();
      await worker.stop();
      await notifier.close();
      await prisma.$disconnect();
      process.exit(0);
    })();
  });
}
