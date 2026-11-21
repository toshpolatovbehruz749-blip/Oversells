import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';

describe('projects API', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext(new FakeRunner());
  });
  afterEach(() => ctx.close());

  const create = (body: object) => ctx.api.inject({ method: 'POST', url: '/api/projects', payload: body });

  it('creates a project from the Uzbek textbook template', async () => {
    const res = await create({ name: '  Algebra 9-sinf  ' });
    expect(res.statusCode).toBe(201);
    const { project } = res.json();
    expect(project).toMatchObject({ name: 'Algebra 9-sinf', compiler: 'xelatex', mainFile: 'main.tex' });

    const detail = (await ctx.api.inject({ url: `/api/projects/${project.id}` })).json().project;
    expect(detail.files.map((f: { path: string }) => f.path)).toEqual(['bolimlar/kirish.tex', 'dizayn.sty', 'main.tex']);

    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    const content = await ctx.api.inject({ url: `/api/projects/${project.id}/files/${main.id}` });
    expect(content.body).toContain('\\babelprovide[import=uz-Latn, main]{uzbek}');
    expect(content.body).toContain('koʻrinishidagi'); // U+02BB survives storage
    expect(content.headers['content-type']).toBe('text/plain; charset=utf-8');
  });

  it('supports the blank template and an explicit compiler', async () => {
    const { project } = (await create({ name: 'Blank', template: 'blank', compiler: 'lualatex' })).json();
    expect(project.compiler).toBe('lualatex');
    const detail = (await ctx.api.inject({ url: `/api/projects/${project.id}` })).json().project;
    expect(detail.files).toHaveLength(1);
  });

  it.each([{ name: '' }, { name: '   ' }, { name: 'x'.repeat(201) }, {}, { name: 'ok', compiler: 'tex' }, { name: 'ok', template: 'nope' }])(
    'rejects invalid input %j',
    async (body) => {
      const res = await create(body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toMatch(/invalid_/);
    },
  );

  it('lists projects, most recently updated first', async () => {
    const a = (await create({ name: 'A' })).json().project;
    const b = (await create({ name: 'B' })).json().project;
    await ctx.api.inject({ method: 'PATCH', url: `/api/projects/${a.id}`, payload: { name: 'A2' } });
    const list = (await ctx.api.inject({ url: '/api/projects' })).json().projects;
    expect(list.map((p: { id: string }) => p.id)).toEqual([a.id, b.id]);
    expect(list[0].name).toBe('A2');
  });

  it('updates compiler and main file with validation', async () => {
    const { project } = (await create({ name: 'P' })).json();
    const url = `/api/projects/${project.id}`;
    expect((await ctx.api.inject({ method: 'PATCH', url, payload: { compiler: 'pdflatex' } })).json().project.compiler).toBe('pdflatex');
    expect((await ctx.api.inject({ method: 'PATCH', url, payload: { mainFile: 'bolimlar/kirish.tex' } })).json().project.mainFile).toBe('bolimlar/kirish.tex');

    const missing = await ctx.api.inject({ method: 'PATCH', url, payload: { mainFile: 'nope.tex' } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('invalid_main_file');
    const traversal = await ctx.api.inject({ method: 'PATCH', url, payload: { mainFile: '../x.tex' } });
    expect(traversal.json().error.code).toBe('invalid_path:traversal');
    const unknown = await ctx.api.inject({ method: 'PATCH', url, payload: { owner: 'me' } });
    expect(unknown.statusCode).toBe(400);
  });

  it('deletes a project with its files and outputs', async () => {
    const { project } = (await create({ name: 'Del' })).json();
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${project.id}/compile`, payload: { wait: true } });
    expect(await ctx.services.storage.exists(`projects/${project.id}`)).toBe(true);

    expect((await ctx.api.inject({ method: 'DELETE', url: `/api/projects/${project.id}` })).statusCode).toBe(204);
    expect((await ctx.api.inject({ url: `/api/projects/${project.id}` })).statusCode).toBe(404);
    expect(await ctx.services.storage.exists(`projects/${project.id}`)).toBe(false);
    expect(await ctx.prisma.projectFile.count({ where: { projectId: project.id } })).toBe(0);
    expect(await ctx.prisma.compileJob.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('returns 404 for unknown projects and routes', async () => {
    expect((await ctx.api.inject({ url: '/api/projects/doesnotexist' })).json()).toEqual({
      error: { code: 'not_found', message: 'Project not found' },
    });
    expect((await ctx.api.inject({ url: '/api/nope' })).statusCode).toBe(404);
  });

  it('downloads the project as a ZIP with all files', async () => {
    const { project } = (await create({ name: 'Geometriya' })).json();
    const res = await ctx.api.inject({ url: `/api/projects/${project.id}/download.zip` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('Geometriya.zip');
    const zip = res.rawPayload;
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(zip.includes(Buffer.from('bolimlar/kirish.tex'))).toBe(true);
    expect(zip.includes(Buffer.from('main.tex'))).toBe(true);
  });

  it('reports health including the compiler status', async () => {
    expect((await ctx.api.inject({ url: '/api/health' })).json()).toEqual({
      status: 'ok',
      compiler: { ok: true, message: 'fake' },
    });
  });
});
