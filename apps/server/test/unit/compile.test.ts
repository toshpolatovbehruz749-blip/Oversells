import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Semaphore } from '../../src/compile/compile-service.js';
import { packFiles, unpackOutputs } from '../../src/compile/docker-runner.js';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FAKE_PDF, FakeRunner } from '../helpers/fake-runner.js';

const errorsLog = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/errors.log'),
  'utf8',
);

const tick = () => new Promise((r) => setTimeout(r, 10));
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met');
    await tick();
  }
}

describe('compile jobs', () => {
  let ctx: TestContext;
  let runner: FakeRunner;

  afterEach(async () => {
    runner?.release();
    await ctx?.close();
  });

  async function setup(env: Record<string, string> = {}) {
    runner = new FakeRunner();
    ctx = await createTestContext(runner, env);
  }
  async function newProject(name = 'P') {
    return (await ctx.app.inject({ method: 'POST', url: '/api/projects', payload: { name } })).json().project;
  }
  const compile = (id: string, wait = false) =>
    ctx.app.inject({ method: 'POST', url: `/api/projects/${id}/compile`, payload: { wait } });

  it('runs a job, stores the PDF and log, and exposes them', async () => {
    await setup();
    const p = await newProject();
    const res = await compile(p.id, true);
    expect(res.statusCode).toBe(200);
    const job = res.json().job;
    expect(job).toMatchObject({ status: 'success', compiler: 'xelatex', mainFile: 'main.tex', hasPdf: true, entries: [] });
    expect(job.durationMs).toBeGreaterThanOrEqual(0);

    // The runner received every project file with its content.
    const req = runner.requests[0]!;
    expect(req.files.map((f) => f.path).sort()).toEqual(['bolimlar/kirish.tex', 'main.tex']);
    expect(req.files.find((f) => f.path === 'main.tex')!.data.toString()).toContain('\\documentclass');

    const pdf = await ctx.app.inject({ url: `/api/projects/${p.id}/compile/${job.id}/output.pdf` });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.equals(FAKE_PDF)).toBe(true);
    const dl = await ctx.app.inject({ url: `/api/projects/${p.id}/compile/${job.id}/output.pdf?download=1` });
    expect(dl.headers['content-disposition']).toMatch(/^attachment; filename="P.pdf"/);

    const log = await ctx.app.inject({ url: `/api/projects/${p.id}/compile/${job.id}/output.log` });
    expect(log.body).toContain('This is a fake log');
    expect(log.body).toContain('Latexmk: fake');

    const latest = (await ctx.app.inject({ url: `/api/projects/${p.id}/compile/latest` })).json().job;
    expect(latest.id).toBe(job.id);
  });

  it('returns 202 immediately and can be polled', async () => {
    await setup();
    const p = await newProject();
    runner.hold = true;
    const res = await compile(p.id);
    expect(res.statusCode).toBe(202);
    const { job } = res.json();
    expect(job.status).toBe('queued');
    await until(() => runner.waiting === 1);
    expect((await ctx.app.inject({ url: `/api/projects/${p.id}/compile/${job.id}` })).json().job.status).toBe('running');
    runner.release();
    await ctx.services.compile.drain();
    expect((await ctx.app.inject({ url: `/api/projects/${p.id}/compile/${job.id}` })).json().job.status).toBe('success');
  });

  it('parses the log into entries and reports failures', async () => {
    await setup();
    const p = await newProject();
    runner.result = () => ({
      status: 'failed', exitCode: 12, log: errorsLog, console: '', pdf: null, synctex: null, errorMessage: null,
    });
    const job = (await compile(p.id, true)).json().job;
    expect(job.status).toBe('failed');
    expect(job.hasPdf).toBe(false);
    expect(job.entries[0]).toMatchObject({ level: 'error', file: 'bolimlar/ch1.tex', line: 3 });
    const pdf = await ctx.app.inject({ url: `/api/projects/${p.id}/compile/${job.id}/output.pdf` });
    expect(pdf.json().error.code).toBe('no_pdf');
  });

  it('records timeouts and runner crashes', async () => {
    await setup();
    const p = await newProject();
    runner.result = () => ({
      status: 'timeout', exitCode: null, log: null, console: '', pdf: null, synctex: null, errorMessage: 'Compilation exceeded 60 s',
    });
    expect((await compile(p.id, true)).json().job).toMatchObject({ status: 'timeout', errorMessage: 'Compilation exceeded 60 s' });

    runner.result = () => {
      throw new Error('docker exploded');
    };
    expect((await compile(p.id, true)).json().job).toMatchObject({ status: 'error', errorMessage: 'Internal error: docker exploded' });
  });

  it('fails fast when the main file is missing', async () => {
    await setup();
    const p = await newProject();
    const main = (await ctx.app.inject({ url: `/api/projects/${p.id}` })).json().project.files.find((f: { path: string }) => f.path === 'main.tex');
    await ctx.app.inject({ method: 'DELETE', url: `/api/projects/${p.id}/files/${main.id}` });
    const job = (await compile(p.id, true)).json().job;
    expect(job).toMatchObject({ status: 'failed', errorMessage: 'Main file main.tex not found' });
    expect(runner.requests).toHaveLength(0);
  });

  it('runs at most one job per project and joins concurrent requests', async () => {
    await setup();
    const p = await newProject();
    runner.hold = true;
    const [a, b] = await Promise.all([compile(p.id), compile(p.id)]);
    expect(a.json().job.id).toBe(b.json().job.id);
    await until(() => runner.waiting === 1);
    expect((await compile(p.id)).json().job.id).toBe(a.json().job.id);
    runner.release();
    await ctx.services.compile.drain();
    expect(runner.requests).toHaveLength(1);
    // After completion a new request starts a new job.
    const next = (await compile(p.id, true)).json().job;
    expect(next.id).not.toBe(a.json().job.id);
  });

  it('limits global concurrency', async () => {
    await setup({ COMPILE_CONCURRENCY: '2' });
    const projects = await Promise.all([newProject('a'), newProject('b'), newProject('c'), newProject('d')]);
    runner.hold = true;
    await Promise.all(projects.map((p) => compile(p.id)));
    await until(() => runner.waiting === 2);
    await tick();
    expect(runner.waiting).toBe(2);
    const statuses = await ctx.prisma.compileJob.groupBy({ by: ['status'], _count: true });
    expect(Object.fromEntries(statuses.map((s) => [s.status, s._count]))).toEqual({ running: 2, queued: 2 });
    runner.release();
    await until(() => runner.requests.length === 4);
    runner.release();
    await ctx.services.compile.drain();
    expect(runner.maxRunning).toBe(2);
    expect(await ctx.prisma.compileJob.count({ where: { status: 'success' } })).toBe(4);
  });

  it('keeps only the newest outputs', async () => {
    await setup({ COMPILE_KEEP_OUTPUTS: '2' });
    const p = await newProject();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await compile(p.id, true)).json().job.id);
    const jobs = await ctx.prisma.compileJob.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' } });
    expect(jobs.map((j) => j.pdfKey !== null)).toEqual([false, false, true, true]);
    expect(await ctx.services.storage.exists(`projects/${p.id}/output/${ids[0]}/output.pdf`)).toBe(false);
    expect(await ctx.services.storage.exists(`projects/${p.id}/output/${ids[3]}/output.pdf`)).toBe(true);
  });

  it('marks jobs interrupted by a restart as errors', async () => {
    await setup();
    const p = await newProject();
    await ctx.prisma.compileJob.create({ data: { projectId: p.id, compiler: 'xelatex', mainFile: 'main.tex', status: 'running' } });
    expect(await ctx.services.compile.recoverInterruptedJobs()).toBe(1);
    const job = (await ctx.app.inject({ url: `/api/projects/${p.id}/compile/latest` })).json().job;
    expect(job).toMatchObject({ status: 'error', errorMessage: 'Interrupted by a server restart' });
  });

  it('returns 404 for unknown projects and jobs', async () => {
    await setup();
    expect((await compile('missing', true)).statusCode).toBe(404);
    const p = await newProject();
    expect((await ctx.app.inject({ url: `/api/projects/${p.id}/compile/latest` })).json()).toEqual({ job: null });
    expect((await ctx.app.inject({ url: '/api/projects/missing/compile/latest' })).statusCode).toBe(404);
    expect((await ctx.app.inject({ url: `/api/projects/${p.id}/compile/nojob` })).statusCode).toBe(404);
  });
});

describe('Semaphore', () => {
  it('admits waiters in FIFO order', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    const r1 = await sem.acquire();
    const p2 = sem.acquire().then((r) => (order.push(2), r));
    const p3 = sem.acquire().then((r) => (order.push(3), r));
    expect(sem.running).toBe(1);
    r1();
    r1(); // double release is ignored
    (await p2)();
    (await p3)();
    expect(order).toEqual([2, 3]);
    expect(sem.running).toBe(0);
  });
});

describe('tar helpers', () => {
  it('round-trips files and ignores unexpected members', async () => {
    const archive = await packFiles([
      { path: 'main.pdf', data: Buffer.from('%PDF') },
      { path: 'main.log', data: Buffer.from('log') },
      { path: 'secret.txt', data: Buffer.from('nope') },
    ]);
    const out = await unpackOutputs(archive, ['main.pdf', 'main.log', 'main.synctex.gz']);
    expect([...out.keys()]).toEqual(['main.pdf', 'main.log']);
    expect(out.get('main.pdf')!.toString()).toBe('%PDF');
    expect((await unpackOutputs(Buffer.alloc(0), ['x'])).size).toBe(0);
  });
});
