import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';

describe('test variants from a question bank', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  it('writes test.tex and testlar.sty from the bank and makes test.tex the main file', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Test', template: 'test' } })).json().project;
    expect(p.mainFile).toBe('test.tex');
    const res = await ctx.api.inject({
      method: 'POST',
      url: `/api/projects/${p.id}/test`,
      payload: { bank: 'savollar.tex', title: 'Algebra', variants: 3, seed: 5 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.questions).toBe(10);
    expect(body.problems).toEqual([]);
    expect(body.key).toHaveLength(3);
    expect(body.project.mainFile).toBe('test.tex');
    const detail = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project;
    const test = detail.files.find((f: { path: string }) => f.path === 'test.tex');
    const tex = (await ctx.api.inject(`/api/projects/${p.id}/files/${test.id}`)).body;
    expect(tex).toContain('\\testvariant{Algebra}{C}');
    expect(tex).not.toContain('\\testvariant{Algebra}{D}');
    expect(detail.files.map((f: { path: string }) => f.path)).toContain('testlar.sty');

    // The same seed gives the same test.
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/test`, payload: { bank: 'savollar.tex', title: 'Algebra', variants: 3, seed: 5 } });
    expect((await ctx.api.inject(`/api/projects/${p.id}/files/${test.id}`)).body).toBe(tex);
  });

  it('reports a bank without usable questions, and needs write access', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Bo‘sh' } })).json().project;
    const res = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/test`, payload: { bank: 'main.tex' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('no_questions');
    expect((await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/test`, payload: { bank: 'yoq.tex' } })).statusCode).toBe(404);
    expect((await ctx.client().inject({ method: 'POST', url: `/api/projects/${p.id}/test`, payload: { bank: 'main.tex' } })).statusCode).toBe(404);
  });
});
