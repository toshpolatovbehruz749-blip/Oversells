import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FAKE_PNG, FakeRunner } from '../helpers/fake-runner.js';

/** multipart/form-data body with one file. */
function multipart(name: string, data: Buffer) {
  const boundary = '----oversells-test';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('Word import and Word/EPUB export', () => {
  let ctx: TestContext;
  let runner: FakeRunner;
  afterEach(() => ctx?.close());

  it('imports a .docx as a new project with its pictures', async () => {
    runner = new FakeRunner();
    ctx = await createTestContext(runner);
    const res = await ctx.api.inject({ method: 'POST', url: '/api/projects/import-docx', ...multipart('Algebra darsligi.docx', Buffer.from('PK\x03\x04 fake docx')) });
    expect(res.statusCode).toBe(201);
    const project = res.json().project;
    expect(project.name).toBe('Algebra darsligi');
    const req = runner.requests.at(-1)!;
    expect(req.convert).toBe('docx-to-latex');
    expect(req.files.map((f) => f.path)).toEqual(['input.docx']);

    const detail = (await ctx.api.inject(`/api/projects/${project.id}`)).json().project;
    expect(detail.files.map((f: { path: string }) => f.path).sort()).toEqual(['main.tex', 'media/rasm.png']);
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    expect((await ctx.api.inject(`/api/projects/${project.id}/files/${main.id}`)).body).toContain('Word matni.');
    const png = detail.files.find((f: { path: string }) => f.path === 'media/rasm.png');
    expect((await ctx.api.inject(`/api/projects/${project.id}/files/${png.id}`)).rawPayload.equals(FAKE_PNG)).toBe(true);
  });

  it('rejects other files and reports failed conversions', async () => {
    runner = new FakeRunner();
    ctx = await createTestContext(runner);
    const notDocx = await ctx.api.inject({ method: 'POST', url: '/api/projects/import-docx', ...multipart('a.pdf', Buffer.from('%PDF')) });
    expect(notDocx.json().error.code).toBe('not_docx');
    runner.convertResult = () => ({ status: 'failed', exitCode: 1, log: null, console: 'bad', pdf: null, synctex: null, outputs: [], errorMessage: 'x' });
    const failed = await ctx.api.inject({ method: 'POST', url: '/api/projects/import-docx', ...multipart('a.docx', Buffer.from('PK broken')) });
    expect(failed.statusCode).toBe(422);
    expect(failed.json().error.code).toBe('convert_failed');
    // No half-made project is left behind.
    expect((await ctx.api.inject('/api/projects')).json().projects).toHaveLength(0);
    expect((await ctx.client().inject({ method: 'POST', url: '/api/projects/import-docx', ...multipart('a.docx', Buffer.from('PK')) })).statusCode).toBe(401);
  });

  it('exports a project as Word and EPUB', async () => {
    runner = new FakeRunner();
    ctx = await createTestContext(runner);
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Kitob' } })).json().project;
    for (const [format, type] of [
      ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['epub', 'application/epub+zip'],
    ] as const) {
      const res = await ctx.api.inject(`/api/projects/${p.id}/export/${format}`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe(type);
      expect(res.headers['content-disposition']).toContain(`Kitob.${format}`);
      expect(res.body).toBe('PK fake');
      const req = runner.requests.at(-1)!;
      expect(req.convert).toBe(format === 'docx' ? 'latex-to-docx' : 'latex-to-epub');
      expect(req.mainFile).toBe('main.tex');
      expect(req.files.map((f) => f.path)).toContain('main.tex');
    }
    expect((await ctx.api.inject(`/api/projects/${p.id}/export/pdf`)).statusCode).toBe(400);
    expect((await ctx.client().inject(`/api/projects/${p.id}/export/docx`)).statusCode).toBe(404);
  });
});
