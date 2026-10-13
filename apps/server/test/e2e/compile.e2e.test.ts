/**
 * End-to-end: real HTTP server + PostgreSQL + Docker compile sandbox.
 * Requires Docker and the compiler image (`npm run compiler:build`).
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DockerRunner } from '../../src/compile/docker-runner.js';
import { createTestContext, type TestContext } from '../helpers/context.js';

const image = process.env.COMPILE_IMAGE ?? 'oversells-texlive:latest';
const runner = new DockerRunner({
  image,
  timeoutMs: 60_000,
  memoryMb: 1024,
  cpus: 1,
  workdirMb: 512,
  maxOutputBytes: 200 * 1024 * 1024,
  socketPath: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
  dockerHost: process.env.DOCKER_HOST,
});
const check = await runner.check();
if (!check.ok) console.warn(`Skipping e2e compile tests: ${check.message}`);

describe.skipIf(!check.ok)('compile end-to-end (Docker sandbox)', () => {
  let ctx: TestContext;
  let base: string;

  beforeAll(async () => {
    ctx = await createTestContext(runner);
    await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => ctx?.close());

  const json = async (path: string, init?: RequestInit) => {
    const res = await fetch(base + path, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  async function compileAndPoll(projectId: string) {
    const started = await json(`/projects/${projectId}/compile`, { method: 'POST', body: '{}' });
    expect(started.status).toBe(202);
    let job = started.body.job;
    const deadline = Date.now() + 120_000;
    while (['queued', 'running'].includes(job.status)) {
      if (Date.now() > deadline) throw new Error('compile did not finish');
      await new Promise((r) => setTimeout(r, 500));
      job = (await json(`/projects/${projectId}/compile/${job.id}`)).body.job;
    }
    return job;
  }

  it.each(['xelatex', 'lualatex'] as const)(
    'creates a project, compiles the Uzbek template with %s and returns a PDF',
    async (compiler) => {
      const created = await json('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: `Darslik (${compiler})`, compiler }),
      });
      expect(created.status).toBe(201);
      const project = created.body.project;

      const job = await compileAndPoll(project.id);
      expect(job.status).toBe('success');
      expect(job.hasPdf).toBe(true);
      expect(job.entries.filter((e: { level: string }) => e.level === 'error')).toEqual([]);

      const pdf = await fetch(`${base}/projects/${project.id}/compile/${job.id}/output.pdf`);
      expect(pdf.status).toBe(200);
      const bytes = Buffer.from(await pdf.arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(bytes.length).toBeGreaterThan(20_000);

      // No "Missing character" in the log: Uzbek Latin (ʻ ʼ) and Cyrillic glyphs exist in the font.
      const log = await (await fetch(`${base}/projects/${project.id}/compile/${job.id}/output.log`)).text();
      expect(log).toContain('Output written on main.');
      expect(log).not.toMatch(/Missing character/);
    },
  );

  it('reports errors with file and line for a broken document', async () => {
    const project = (await json('/projects', { method: 'POST', body: JSON.stringify({ name: 'Xato', template: 'blank' }) })).body.project;
    await json(`/projects/${project.id}/files`, {
      method: 'POST',
      body: JSON.stringify({ path: 'bob/xato.tex', content: 'Matn.\n\\notacommand\n' }),
    });
    const detail = (await json(`/projects/${project.id}`)).body.project;
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    await json(`/projects/${project.id}/files/${main.id}/content`, {
      method: 'PUT',
      body: JSON.stringify({
        content: '\\documentclass{article}\n\\begin{document}\nSalom\n\\input{bob/xato}\n\\end{document}\n',
      }),
    });
    await json(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ compiler: 'pdflatex' }) });

    const job = await compileAndPoll(project.id);
    expect(job.status).toBe('failed');
    expect(job.entries[0]).toMatchObject({
      level: 'error',
      message: 'Undefined control sequence.',
      file: 'bob/xato.tex',
      line: 2,
    });
  });

  it('keeps the sandbox closed: no shell escape, no reading system files', async () => {
    const project = (await json('/projects', { method: 'POST', body: JSON.stringify({ name: 'Sandbox', template: 'blank' }) })).body.project;
    const detail = (await json(`/projects/${project.id}`)).body.project;
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    await json(`/projects/${project.id}/files/${main.id}/content`, {
      method: 'PUT',
      body: JSON.stringify({
        content: [
          '\\documentclass{article}',
          '\\begin{document}',
          '\\immediate\\write18{touch /work/pwned.tex}',
          '\\IfFileExists{pwned.tex}{SHELL-ESCAPE-WORKED}{no shell escape}',
          '\\input{/etc/passwd}',
          '\\end{document}',
        ].join('\n'),
      }),
    });
    await json(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ compiler: 'pdflatex' }) });
    const job = await compileAndPoll(project.id);
    const log = await (await fetch(`${base}/projects/${project.id}/compile/${job.id}/output.log`)).text();
    expect(log).toContain('runsystem(touch /work/pwned.tex)...disabled');
    expect(log).not.toContain('root:x:0:0');
    expect(job.entries.some((e: { message: string }) => /passwd/.test(e.message))).toBe(true);
  });
});
