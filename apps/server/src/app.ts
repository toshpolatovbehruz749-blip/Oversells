import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { createPrisma } from './db.js';
import { LocalDiskStorage } from './storage/local-disk-storage.js';
import type { Storage } from './storage/storage.js';
import { TemplateStore } from './projects/templates.js';
import { ProjectService } from './projects/project-service.js';
import { FileService } from './files/file-service.js';
import { CompileService } from './compile/compile-service.js';
import { DockerRunner } from './compile/docker-runner.js';
import type { CompileRunner } from './compile/runner.js';
import { registerRoutes, type Services } from './routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Finds the templates directory both in development (src/) and in the bundle (dist/). */
export function resolveTemplatesDir(configured?: string): string {
  const candidates = [configured, path.resolve(here, '../templates'), path.resolve(here, '../../templates')];
  for (const c of candidates) if (c && existsSync(path.join(c, 'uzbek-textbook'))) return c;
  throw new Error('Templates directory not found; set TEMPLATES_DIR');
}

export interface BuildAppOptions {
  config: Config;
  prisma?: PrismaClient;
  storage?: Storage;
  runner?: CompileRunner;
  logger?: boolean;
}

export interface BuiltApp {
  app: FastifyInstance;
  services: Services;
  prisma: PrismaClient;
}

export async function buildApp(opts: BuildAppOptions): Promise<BuiltApp> {
  const { config } = opts;
  const prisma = opts.prisma ?? createPrisma(config.DATABASE_URL);
  const storage = opts.storage ?? new LocalDiskStorage(config.DATA_DIR);
  const runner =
    opts.runner ??
    new DockerRunner({
      image: config.COMPILE_IMAGE,
      timeoutMs: config.COMPILE_TIMEOUT_MS,
      memoryMb: config.COMPILE_MEMORY_MB,
      cpus: config.COMPILE_CPUS,
      workdirMb: config.COMPILE_WORKDIR_MB,
      maxOutputBytes: config.COMPILE_MAX_OUTPUT_BYTES,
      socketPath: config.DOCKER_SOCKET,
      dockerHost: config.DOCKER_HOST,
    });

  const templates = new TemplateStore(resolveTemplatesDir(config.TEMPLATES_DIR));
  const services: Services = {
    projects: new ProjectService(prisma, storage, templates),
    files: new FileService(prisma, storage, {
      maxUploadBytes: config.MAX_UPLOAD_BYTES,
      maxTextFileBytes: config.MAX_TEXT_FILE_BYTES,
      maxProjectBytes: config.MAX_PROJECT_BYTES,
      maxFilesPerProject: config.MAX_FILES_PER_PROJECT,
    }),
    compile: new CompileService(prisma, storage, runner, {
      concurrency: config.COMPILE_CONCURRENCY,
      keepOutputs: config.COMPILE_KEEP_OUTPUTS,
    }),
    runner,
    storage,
    maxTextFileBytes: config.MAX_TEXT_FILE_BYTES,
    maxUploadBytes: config.MAX_UPLOAD_BYTES,
  };

  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.LOG_LEVEL },
    bodyLimit: 1024 * 1024,
  });

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
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: 'invalid_request', message: e.message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Internal server error' } });
  });

  await registerRoutes(app, services);

  const webDist = config.WEB_DIST_DIR;
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: path.resolve(webDist), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } });
      }
      return reply.sendFile('index.html'); // SPA fallback
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } }),
    );
  }

  app.addHook('onClose', async () => {
    await services.compile.drain();
    if (!opts.prisma) await prisma.$disconnect();
  });

  return { app, services, prisma };
}
