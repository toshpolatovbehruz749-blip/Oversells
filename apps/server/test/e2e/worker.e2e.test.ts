/**
 * End-to-end in queue mode: the app (no Docker access) queues the job, a
 * CompileWorker with the real Docker sandbox compiles the textbook template,
 * and the app serves the PDF and the SyncTeX mapping.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DockerRunner } from '../../src/compile/docker-runner.js';
import { CompileProcessor } from '../../src/compile/processor.js';
import { PgNotifier } from '../../src/compile/notifier.js';
import { CompileWorker } from '../../src/compile/worker.js';
import { LocalDiskStorage } from '../../src/storage/local-disk-storage.js';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { testDatabaseUrl } from '../helpers/env.js';

const runner = new DockerRunner({
  image: process.env.COMPILE_IMAGE ?? 'oversells-texlive:latest',
  timeoutMs: 60_000,
  memoryMb: 1024,
  cpus: 1,
  workdirMb: 512,
  maxOutputBytes: 200 * 1024 * 1024,
  socketPath: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
  dockerHost: process.env.DOCKER_HOST,
});
const check = await runner.check();
const silent = { info() {}, warn() {}, error() {} };

describe.skipIf(!check.ok)('compile through the worker service (Docker sandbox)', () => {
  let ctx: TestContext;
  let worker: CompileWorker;
  let notifier: PgNotifier;

  beforeAll(async () => {
    ctx = await createTestContext(undefined, { COMPILE_MODE: 'queue' });
    notifier = new PgNotifier(testDatabaseUrl(), ctx.prisma, silent);
    await notifier.start();
    const processor = new CompileProcessor(ctx.prisma, new LocalDiskStorage(ctx.dataDir), runner, { keepOutputs: 5 });
    worker = new CompileWorker(
      ctx.prisma,
      processor,
      notifier,
      { concurrency: 2, heartbeatMs: 1000, staleMs: 30_000, maxAttempts: 3, pollMs: 2000 },
      silent,
    );
    await worker.start();
  });
  afterAll(async () => {
    await worker?.stop();
    await notifier?.close();
    await ctx?.close();
  });

  it('compiles the textbook template and maps the PDF back to the source', async () => {
    expect(ctx.services.runner).toBeNull();
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Darslik', template: 'textbook' } })).json().project;
    const res = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: { wait: true } });
    const job = res.json().job;
    expect(job).toMatchObject({ status: 'success', hasPdf: true, hasSynctex: true });
    const pdf = await ctx.api.inject(`/api/projects/${p.id}/compile/${job.id}/output.pdf`);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const rev = await ctx.api.inject(`/api/projects/${p.id}/compile/${job.id}/synctex/pdf?page=1&x=200&y=300`);
    expect(rev.json().source.file).toBe('bolimlar/kirish.tex');
    expect((await ctx.prisma.compileJob.findUniqueOrThrow({ where: { id: job.id } })).workerId).toBe(worker.id);
  });
});
