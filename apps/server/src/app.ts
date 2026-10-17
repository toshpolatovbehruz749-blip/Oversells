import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { createPrisma } from './db.js';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { createStorage } from './storage/create.js';
import { S3Storage } from './storage/s3-storage.js';
import { CompileProcessor } from './compile/processor.js';
import { PgNotifier } from './compile/notifier.js';
import { RedisDocBus, type DocBus } from './collab/bus.js';
import { loggerOptions } from './logging.js';
import { addGaugeSource, metrics, registry } from './metrics.js';
import type { Storage } from './storage/storage.js';
import { TemplateStore } from './projects/templates.js';
import { ProjectService } from './projects/project-service.js';
import { FileService } from './files/file-service.js';
import { CompileService } from './compile/compile-service.js';
import { DockerRunner } from './compile/docker-runner.js';
import type { CompileRunner } from './compile/runner.js';
import { registerRoutes, type Services } from './routes.js';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { AuthService } from './auth/auth-service.js';
import { LogMailer, SmtpMailer, type Mailer } from './auth/mailer.js';
import { registerAuthHooks, registerAuthRoutes } from './auth/http.js';
import { AccessService } from './access/access-service.js';
import { ShareService } from './share/share-service.js';
import { TemplatePreviewService } from './templates/preview-service.js';
import websocket from '@fastify/websocket';
import { DocManager } from './collab/doc-manager.js';
import { registerCollabRoutes } from './collab/routes.js';
import { VersionService } from './versions/version-service.js';
import { CommentService } from './comments/comment-service.js';
import { SyncTexService } from './synctex/synctex-service.js';
import { AnthropicAiClient, type AiClient } from './ai/ai-client.js';
import { AiService } from './ai/ai-service.js';
import { registerAiRoutes } from './ai/routes.js';
import { QuotaService } from './admin/quotas.js';
import { AdminService } from './admin/admin-service.js';
import { registerAdminRoutes } from './admin/routes.js';
import { BackupService } from './backups/backup-service.js';
import { DesignService, builtInDesignPackages, resolveDesignsDir } from './designs/design-service.js';
import { registerDesignRoutes } from './designs/routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Finds the templates directory both in development (src/) and in the bundle (dist/). */
export function resolveTemplatesDir(configured?: string): string {
  const candidates = [configured, path.resolve(here, '../templates'), path.resolve(here, '../../templates')];
  for (const c of candidates) if (c && existsSync(path.join(c, 'textbook', 'template.json'))) return c;
  throw new Error('Templates directory not found; set TEMPLATES_DIR');
}

export interface BuildAppOptions {
  config: Config;
  prisma?: PrismaClient;
  storage?: Storage;
  runner?: CompileRunner;
  mailer?: Mailer;
  /** Replaces the Redis bus (tests); by default one is created when REDIS_URL is set. */
  bus?: DocBus | null;
  /** Replaces the Claude client (tests); only used when AI_ENABLED is true. */
  aiClient?: AiClient;
  logger?: boolean;
}

export interface BuiltApp {
  app: FastifyInstance;
  services: Services;
  prisma: PrismaClient;
  auth: AuthService;
}

export async function buildApp(opts: BuildAppOptions): Promise<BuiltApp> {
  const { config } = opts;
  const prisma = opts.prisma ?? createPrisma(config.DATABASE_URL);
  const storage = opts.storage ?? createStorage(config);
  // Queue mode: the app never talks to Docker; the worker service runs the jobs.
  const runner =
    opts.runner ??
    (config.COMPILE_MODE === 'queue'
      ? null
      : new DockerRunner({
      image: config.COMPILE_IMAGE,
      timeoutMs: config.COMPILE_TIMEOUT_MS,
      memoryMb: config.COMPILE_MEMORY_MB,
      cpus: config.COMPILE_CPUS,
      workdirMb: config.COMPILE_WORKDIR_MB,
      maxOutputBytes: config.COMPILE_MAX_OUTPUT_BYTES,
        socketPath: config.DOCKER_SOCKET,
        dockerHost: config.DOCKER_HOST,
      }));

  const app = Fastify({
    logger: opts.logger === false ? false : loggerOptions(config.LOG_LEVEL, 'app'),
    bodyLimit: 1024 * 1024,
    logController: new LogController({ disableRequestLogging: config.NODE_ENV === 'production' }),
    trustProxy: config.TRUST_PROXY,
    // Behind our own reverse proxy an incoming X-Request-Id is kept, so logs can be correlated.
    requestIdHeader: config.TRUST_PROXY ? 'x-request-id' : false,
    genReqId: () => randomUUID(),
  });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unmatched';
    metrics.httpSeconds.observe({ method: req.method, route, status_code: String(reply.statusCode) }, reply.elapsedTime / 1000);
  });

  const bus =
    opts.bus !== undefined
      ? opts.bus
      : config.REDIS_URL
        ? new RedisDocBus({ url: config.REDIS_URL, prefix: config.REDIS_PREFIX }, app.log)
        : null;
  const rateLimitRedis = config.REDIS_URL
    ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000 })
    : null;
  rateLimitRedis?.on('error', (err) => app.log.warn({ err }, 'Redis (rate limit) connection error'));
  const notifier = config.COMPILE_MODE === 'queue' ? new PgNotifier(config.DATABASE_URL, prisma, app.log) : null;

  const mailer =
    opts.mailer ??
    (config.SMTP_HOST
      ? new SmtpMailer({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE,
          user: config.SMTP_USER,
          pass: config.SMTP_PASS,
          from: config.MAIL_FROM,
        })
      : new LogMailer(app.log));
  const auth = new AuthService(prisma, mailer, {
    appUrl: config.APP_URL,
    sessionTtlDays: config.SESSION_TTL_DAYS,
    passwordResetTtlMinutes: config.PASSWORD_RESET_TTL_MINUTES,
    adminEmails: config.ADMIN_EMAILS,
  });
  const promoted = await auth.syncAdmins();
  if (promoted) app.log.info({ promoted }, 'Admin role given to ADMIN_EMAILS accounts');
  const quotas = new QuotaService(prisma, {
    maxProjects: config.MAX_PROJECTS_PER_USER,
    storageQuotaBytes: config.USER_STORAGE_QUOTA_BYTES,
  });

  const designsDir = resolveDesignsDir(here, config.DESIGNS_DIR);
  const templates = new TemplateStore(resolveTemplatesDir(config.TEMPLATES_DIR), builtInDesignPackages(designsDir));
  // Versions hook into document activity; created after the DocManager.
  let versions: VersionService | null = null;
  const versionJobs = new Set<Promise<unknown>>();
  const autoVersion = (projectId: string, always: boolean) => {
    const v = versions;
    if (!v) return;
    const job = (always ? v.snapshot(projectId, 'auto', null, null) : v.maybeAuto(projectId))
      .catch((err: Error) => app.log.warn({ err, projectId }, 'Automatic version failed'))
      .finally(() => versionJobs.delete(job));
    versionJobs.add(job);
  };
  const docs = new DocManager(
    prisma,
    storage,
    {
      persistDebounceMs: config.COLLAB_PERSIST_DEBOUNCE_MS,
      storageDebounceMs: config.COLLAB_STORAGE_DEBOUNCE_MS,
      compactAfter: config.COLLAB_COMPACT_AFTER,
      unloadAfterMs: config.COLLAB_UNLOAD_AFTER_MS,
    },
    app.log,
    { onActivity: (id) => autoVersion(id, false), onIdle: (id) => autoVersion(id, true) },
    bus,
  );
  versions = new VersionService(prisma, storage, docs, { autoIntervalMs: config.AUTO_VERSION_INTERVAL_MS });
  const compile = new CompileService(prisma, {
    mode: runner ? 'inline' : 'queue',
    concurrency: config.COMPILE_CONCURRENCY,
    processor: runner ? new CompileProcessor(prisma, storage, runner, { keepOutputs: config.COMPILE_KEEP_OUTPUTS }) : undefined,
    notifier: notifier ?? undefined,
    pollMs: config.COMPILE_POLL_MS,
    storage,
    beforeCompile: (projectId) => docs.flushProject(projectId),
  });
  await notifier?.start();
  let aiClient: AiClient | null = null;
  if (config.AI_ENABLED) {
    if (opts.aiClient) aiClient = opts.aiClient;
    else if (config.ANTHROPIC_API_KEY) {
      aiClient = new AnthropicAiClient({
        apiKey: config.ANTHROPIC_API_KEY,
        model: config.AI_MODEL,
        timeoutMs: config.AI_TIMEOUT_MS,
        baseURL: config.ANTHROPIC_BASE_URL,
      });
    } else app.log.warn('AI_ENABLED is true but ANTHROPIC_API_KEY is not set; AI assistance stays off');
  }
  const ai = new AiService(prisma, compile, docs, { client: aiClient, dailyLimit: config.AI_DAILY_LIMIT });

  const designs = new DesignService(prisma, compile, storage, designsDir, app.log);

  const projects = new ProjectService(prisma, storage, templates);
  const services: Services = {
    projects,
    backups: new BackupService(
      prisma,
      storage,
      projects,
      { maxProjectBytes: config.MAX_PROJECT_BYTES, maxFilesPerProject: config.MAX_FILES_PER_PROJECT },
      { dir: config.BACKUP_DIR || undefined, keepDays: config.BACKUP_KEEP_DAYS },
    ),
    files: new FileService(prisma, storage, {
      maxUploadBytes: config.MAX_UPLOAD_BYTES,
      maxTextFileBytes: config.MAX_TEXT_FILE_BYTES,
      maxProjectBytes: config.MAX_PROJECT_BYTES,
      maxFilesPerProject: config.MAX_FILES_PER_PROJECT,
    }, docs, quotas),
    compile,
    runner,
    storage,
    access: new AccessService(prisma),
    shares: new ShareService(prisma),
    templates,
    previews: new TemplatePreviewService(templates, storage, runner, compile, app.log),
    compilerStatus: async () => ({ ok: false, message: 'starting' }),
    docs,
    versions,
    comments: new CommentService(prisma, docs),
    synctex: new SyncTexService(prisma, storage),
    quotas,
    designs,
    prisma,
    maxTextFileBytes: config.MAX_TEXT_FILE_BYTES,
    maxUploadBytes: config.MAX_UPLOAD_BYTES,
  };

  const authHttp = {
    cookieSecure: config.COOKIE_SECURE,
    rateLimit: { max: config.AUTH_RATE_LIMIT_MAX, timeWindow: config.AUTH_RATE_LIMIT_WINDOW_MS },
  };
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    ...(rateLimitRedis ? { redis: rateLimitRedis, nameSpace: `${config.REDIS_PREFIX}rl:`, skipOnError: true } : {}),
  });
  // A whole document travels in one sync message: leave room for the biggest text file.
  await app.register(websocket, {
    options: { maxPayload: Math.max(16 * 1024 * 1024, config.MAX_TEXT_FILE_BYTES * 2 + 1024 * 1024) },
  });
  registerAuthHooks(app, auth, authHttp);

  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 50, fields: 10, parts: 60 },
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    const e = err as { code?: string; statusCode?: number; message: string };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'file_too_large', message: 'Request is too large' } });
    }
    if (e.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many attempts, try again later' } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: 'invalid_request', message: e.message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Internal server error' } });
  });

  await registerAuthRoutes(app, auth, authHttp);
  await registerRoutes(app, services);
  await registerAiRoutes(app, ai, services.access);
  await registerDesignRoutes(app, { designs, access: services.access, files: services.files, docs, prisma });
  await registerAdminRoutes(
    app,
    new AdminService(prisma, quotas, docs, { enabled: ai.enabled, dailyLimit: config.AI_DAILY_LIMIT }),
  );
  await registerCollabRoutes(app, { docs, access: services.access, prisma, appUrl: config.APP_URL });

  const webDist = config.WEB_DIST_DIR;
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: path.resolve(webDist) });
    app.setNotFoundHandler((req, reply) => {
      const pathname = req.url.split('?')[0]!;
      // API routes and missing assets (anything with an extension) are real 404s.
      if (pathname.startsWith('/api/') || req.method !== 'GET' || /\.[A-Za-z0-9]+$/.test(pathname)) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } });
      }
      return reply.sendFile('index.html'); // SPA fallback
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } }),
    );
  }

  // --- operations: readiness and metrics ------------------------------------------

  /** Readiness: the dependencies needed to serve requests (the compiler is reported, not required). */
  app.get('/api/ready', async (_req, reply) => {
    const checks: Record<string, { ok: boolean; message?: string }> = {};
    const check = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        checks[name] = { ok: true };
      } catch (err) {
        checks[name] = { ok: false, message: (err as Error).message };
      }
    };
    await Promise.all([
      check('database', () => prisma.$queryRaw`SELECT 1`),
      ...(bus ? [check('redis', () => bus.ping())] : []),
      ...(storage instanceof S3Storage ? [check('storage', () => storage.check())] : []),
    ]);
    const ready = Object.values(checks).every((c) => c.ok);
    reply.code(ready ? 200 : 503);
    return { status: ready ? 'ready' : 'not_ready', checks, compiler: await compilerStatus() };
  });

  const compilerStatus = async () => {
    if (runner) return runner.check();
    const alive = await prisma.compileWorker.count({
      where: { heartbeatAt: { gte: new Date(Date.now() - config.WORKER_STALE_MS) } },
    });
    return { ok: alive > 0, message: alive > 0 ? `${alive} compile worker(s)` : 'No compile worker is running' };
  };
  services.compilerStatus = compilerStatus;

  const removeSources = [
    addGaugeSource(metrics.compileQueue, async () => {
      const rows = await prisma.compileJob.groupBy({ by: ['status'], where: { status: { in: ['queued', 'running'] } }, _count: true });
      return ['queued', 'running'].map((status) => ({
        labels: { status },
        value: rows.find((r) => r.status === status)?._count ?? 0,
      }));
    }),
    addGaugeSource(metrics.collabConnections, () => [{ value: docs.connectionCount }]),
    addGaugeSource(metrics.collabDocuments, () => [{ value: docs.size }]),
  ];

  // Prometheus metrics, only with METRICS_TOKEN (Authorization: Bearer <token>).
  app.get('/metrics', async (req, reply) => {
    const token = config.METRICS_TOKEN;
    if (!token) return reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } });
    if (req.headers.authorization !== `Bearer ${token}`) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Metrics token required' } });
    }
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  app.addHook('onClose', async () => {
    for (const remove of removeSources) remove();
    await services.compile.drain();
    await docs.shutdown();
    await Promise.allSettled([...versionJobs]);
    await notifier?.close();
    await bus?.close();
    rateLimitRedis?.disconnect();
    if (!opts.prisma) await prisma.$disconnect();
  });

  return { app, services, prisma, auth };
}
