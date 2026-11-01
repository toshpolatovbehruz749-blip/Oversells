import { afterEach, describe, expect, it } from 'vitest';
import { defaultCover } from '@oversells/shared';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';

describe('Muqova (cover) routes', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  const text = async (projectId: string, path: string) => {
    const d = (await ctx.api.inject(`/api/projects/${projectId}`)).json().project;
    const f = d.files.find((x: { path: string }) => x.path === path);
    return f ? (await ctx.api.inject(`/api/projects/${projectId}/files/${f.id}`)).body : null;
  };

  it('is there only with the page design flag', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Kitob' } })).json().project;
    expect((await ctx.api.inject(`/api/projects/${p.id}/cover`)).statusCode).toBe(404);
  });

  it('takes the page count from the last PDF, saves muqova.tex and compiles it on its own', async () => {
    const runner = new FakeRunner();
    runner.result = (req) => ({
      status: 'success',
      exitCode: 0,
      log: `Output written on ${req.mainFile.replace('.tex', '.xdv')} (3 pages).\nOutput written on main.pdf (212 pages, 100 bytes).`,
      console: '',
      pdf: Buffer.from(`%PDF-1.4 ${req.mainFile}`),
      synctex: null,
      errorMessage: null,
    });
    ctx = await createTestContext(runner, { PAGE_DESIGN_ENABLED: 'true' });
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Ona yurt' } })).json().project;

    // Before any compile: the defaults.
    let got = (await ctx.api.inject(`/api/projects/${p.id}/cover`)).json();
    expect(got).toMatchObject({ exists: false, pages: null, cover: { title: 'Ona yurt', pages: 160 } });
    expect((await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/cover/pdf` })).json().error.code).toBe('no_cover');

    const compile = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: {} });
    expect(compile.statusCode).toBeLessThan(300);
    for (let i = 0; i < 50 && (await ctx.api.inject(`/api/projects/${p.id}/compile/latest`)).json().job?.status !== 'success'; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    got = (await ctx.api.inject(`/api/projects/${p.id}/cover`)).json();
    expect(got.pages).toBe(212);
    expect(got.cover.pages).toBe(212);
    // 106 sheets × 0.09 mm + 0.5 mm.
    expect(got.geometry.spine).toBeCloseTo(10, 1);

    const bad = await ctx.api.inject({ method: 'PUT', url: `/api/projects/${p.id}/cover`, payload: { cover: { ...defaultCover('X'), isbn: '123' } } });
    expect(bad.json().error.code).toBe('invalid_cover');
    const saved = await ctx.api.inject({
      method: 'PUT',
      url: `/api/projects/${p.id}/cover`,
      payload: { cover: { ...got.cover, author: 'Muallif', isbn: '978-9943-01-234-9', binding: 'qattiq' } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().geometry.hinge).toBe(7);
    const tex = (await text(p.id, 'muqova.tex'))!;
    expect(tex).toContain('% oversells-muqova: ');
    expect(tex).toContain('Muallif');
    // Its own compile: muqova.tex is the main file of that job, the project keeps its own.
    const pdf = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/cover/pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body).toBe('%PDF-1.4 muqova.tex');
    expect(runner.requests.at(-1)!.mainFile).toBe('muqova.tex');
    expect(runner.requests.at(-1)!.files.map((f) => f.path)).toContain('main.tex');
    expect((await ctx.api.inject(`/api/projects/${p.id}`)).json().project.mainFile).toBe('main.tex');

    // A muqova.tex written by hand is not replaced silently.
    const d = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project;
    const f = d.files.find((x: { path: string }) => x.path === 'muqova.tex');
    await ctx.services.docs.setText(f.id, '\\documentclass{article}');
    const again = await ctx.api.inject({ method: 'PUT', url: `/api/projects/${p.id}/cover`, payload: { cover: got.cover } });
    expect(again.json().error.code).toBe('cover_unreadable');
  });
});
