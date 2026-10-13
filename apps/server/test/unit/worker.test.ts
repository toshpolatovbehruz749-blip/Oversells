import { afterEach, describe, expect, it } from 'vitest';
import { CompileProcessor } from '../../src/compile/processor.js';
import { CompileWorker, type CompileWorkerOptions } from '../../src/compile/worker.js';
import { PgNotifier } from '../../src/compile/notifier.js';
import { LocalDiskStorage } from '../../src/storage/local-disk-storage.js';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { testDatabaseUrl } from '../helpers/env.js';
import { FAKE_PDF, FakeRunner } from '../helpers/fake-runner.js';
import { until } from '../helpers/collab-client.js';

const silent = { info() {}, warn() {}, error() {} };
const OPTS: CompileWorkerOptions = { concurrency: 2, heartbeatMs: 200, staleMs: 1000, maxAttempts: 2, pollMs: 5000 };

/**
 * Queue mode: the app (no runner, no Docker) queues jobs in PostgreSQL and a
 * separate CompileWorker runs them, sharing storage and the database.
 */
describe('compile worker service (queue mode)', () => {
  let ctx: TestContext | undefined;
  const workers: CompileWorker[] = [];
  const notifiers: PgNotifier[] = [];
  afterEach(async () => {
    for (const w of workers.splice(0)) await w.stop();
    for (const n of notifiers.splice(0)) await n.close();
    await ctx?.close();
    ctx = undefined;
  });

  async function startWorker(runner: FakeRunner, opts: Partial<CompileWorkerOptions> = {}, notify = true) {
    const notifier = notify ? new PgNotifier(testDatabaseUrl(), ctx!.prisma, silent) : null;
    if (notifier) {
      notifiers.push(notifier);
      await notifier.start();
    }
    const processor = new CompileProcessor(ctx!.prisma, new LocalDiskStorage(ctx!.dataDir), runner, { keepOutputs: 5 });
    const worker = new CompileWorker(ctx!.prisma, processor, notifier, { ...OPTS, ...opts }, silent);
    workers.push(worker);
    await worker.start();
    return worker;
  }

  async function newProject() {
    return (await ctx!.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Navbat' } })).json().project.id as string;
  }

  it('the app queues, the worker compiles, and the app learns the result through NOTIFY', async () => {
    ctx = await createTestContext(undefined, { COMPILE_MODE: 'queue', COMPILE_POLL_MS: '60000' });
    expect(ctx.services.runner).toBeNull();
    // No worker yet: the compiler is reported as unavailable, readiness does not depend on it.
    expect((await ctx.api.inject('/api/health')).json().compiler.ok).toBe(false);
    const ready = await ctx.api.inject('/api/ready');
    expect(ready.statusCode).toBe(200);
    expect(ready.json().compiler).toEqual({ ok: false, message: 'No compile worker is running' });

    const runner = new FakeRunner();
    const worker = await startWorker(runner);
    expect((await ctx.api.inject('/api/health')).json().compiler).toEqual({ ok: true, message: '1 compile worker(s)' });

    const id = await newProject();
    const started = Date.now();
    const res = await ctx.api.inject({ method: 'POST', url: `/api/projects/${id}/compile`, payload: { wait: true } });
    // Polling is set to a minute, so finishing quickly proves the notification path.
    expect(Date.now() - started).toBeLessThan(10_000);
    const job = res.json().job;
    expect(job).toMatchObject({ status: 'success', hasPdf: true });
    const row = await ctx.prisma.compileJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ workerId: worker.id, attempts: 1 });
    expect(runner.requests[0]!.files.some((f) => f.path === 'main.tex')).toBe(true);
    const pdf = await ctx.api.inject(`/api/projects/${id}/compile/${job.id}/output.pdf`);
    expect(pdf.rawPayload.equals(FAKE_PDF)).toBe(true);
  });

  it('joins the active job and shares the queue between workers without running a job twice', async () => {
    ctx = await createTestContext(undefined, { COMPILE_MODE: 'queue', COMPILE_POLL_MS: '200' });
    const runner = new FakeRunner();
    runner.hold = true;
    const ids = await Promise.all([newProject(), newProject(), newProject(), newProject()]);

    // Two requests for one project: one job.
    const [a, b] = await Promise.all(
      [0, 1].map(() => ctx!.api.inject({ method: 'POST', url: `/api/projects/${ids[0]}/compile` })),
    );
    expect(a!.json().job.id).toBe(b!.json().job.id);
    for (const id of ids.slice(1)) await ctx.api.inject({ method: 'POST', url: `/api/projects/${id}/compile` });
    expect(await ctx.prisma.compileJob.count({ where: { status: 'queued' } })).toBe(4);

    const w1 = await startWorker(runner, { concurrency: 2, pollMs: 100 });
    const w2 = await startWorker(runner, { concurrency: 2, pollMs: 100 });
    await until(() => runner.waiting === 4, 5000, 'all four jobs taken');
    expect(w1.activeJobs).toBe(2);
    expect(w2.activeJobs).toBe(2);
    runner.release();
    await until(async () => (await ctx!.prisma.compileJob.count({ where: { status: 'success' } })) === 4, 5000, 'done');
    expect(runner.requests).toHaveLength(4);
    expect(new Set(runner.requests.map((r) => r.jobId)).size).toBe(4);
  });

  it('re-queues the jobs of a worker that stopped sending heartbeats, then gives up', async () => {
    ctx = await createTestContext(undefined, { COMPILE_MODE: 'queue', COMPILE_POLL_MS: '200' });
    const id = await newProject();
    const { job } = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${id}/compile` })).json();

    // A worker that crashed while running the job: running, with an old heartbeat.
    const lostAt = new Date(Date.now() - 60_000);
    await ctx.prisma.compileJob.update({
      where: { id: job.id },
      data: { status: 'running', workerId: 'gone', heartbeatAt: lostAt, startedAt: lostAt, attempts: 1 },
    });
    const runner = new FakeRunner();
    const worker = await startWorker(runner, { pollMs: 100 });
    await until(async () => (await ctx!.prisma.compileJob.findUnique({ where: { id: job.id } }))?.status === 'success', 5000, 'retried');
    expect((await ctx.prisma.compileJob.findUniqueOrThrow({ where: { id: job.id } })).attempts).toBe(2);
    expect(runner.requests).toHaveLength(1);

    // At the attempt limit, a lost job fails instead of looping forever.
    const second = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${id}/compile` })).json().job;
    await until(async () => (await ctx!.prisma.compileJob.findUnique({ where: { id: second.id } }))?.status === 'success', 5000, 'second');
    await ctx.prisma.compileJob.update({
      where: { id: second.id },
      data: { status: 'running', workerId: 'gone', heartbeatAt: lostAt, attempts: 2, finishedAt: null },
    });
    expect(await worker.reap()).toBe(1);
    expect(await ctx.prisma.compileJob.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      status: 'error',
      errorMessage: 'The compile worker stopped responding',
    });
  });

  it('keeps heartbeats of long jobs fresh so they are not taken over', async () => {
    ctx = await createTestContext(undefined, { COMPILE_MODE: 'queue', COMPILE_POLL_MS: '200' });
    const runner = new FakeRunner();
    runner.hold = true;
    const worker = await startWorker(runner, { pollMs: 100 });
    const id = await newProject();
    const { job } = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${id}/compile` })).json();
    await until(() => runner.waiting === 1, 5000, 'taken');
    await new Promise((r) => setTimeout(r, 1500)); // longer than staleMs
    expect(await worker.reap()).toBe(0);
    expect((await ctx.prisma.compileJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('running');
    runner.release();
    await until(async () => (await ctx!.prisma.compileJob.findUnique({ where: { id: job.id } }))?.status === 'success', 5000, 'done');
  });

  it('works without notifications by polling', async () => {
    ctx = await createTestContext(undefined, { COMPILE_MODE: 'queue', COMPILE_POLL_MS: '100' });
    await startWorker(new FakeRunner(), { pollMs: 100 }, false);
    const id = await newProject();
    const res = await ctx.api.inject({ method: 'POST', url: `/api/projects/${id}/compile`, payload: { wait: true } });
    expect(res.json().job.status).toBe('success');
  });
});
