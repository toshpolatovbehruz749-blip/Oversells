import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TESTLAR_STY } from '@oversells/shared';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FAKE_PNG, FakeRunner } from '../helpers/fake-runner.js';

describe('templates gallery', () => {
  let ctx: TestContext;
  let runner: FakeRunner;
  beforeEach(async () => {
    runner = new FakeRunner();
    ctx = await createTestContext(runner);
  });
  afterEach(() => ctx.close());

  it('lists the templates with Uzbek, Russian and English titles', async () => {
    const res = await ctx.client().inject('/api/templates');
    expect(res.statusCode).toBe(200);
    const templates = res.json().templates;
    expect(templates.map((t: { name: string }) => t.name)).toEqual([
      'textbook',
      'worksheet',
      'exam',
      'test',
      'olympiad',
      'lesson',
      'certificate',
      'diploma',
      'article',
      'blank',
    ]);
    for (const t of templates) {
      expect(t.compiler).toBe('xelatex');
      for (const lang of ['uz', 'ru', 'en']) {
        expect(t.title[lang]).toBeTruthy();
        expect(t.description[lang]).toBeTruthy();
      }
    }
    expect(templates[2].title.uz).toBe('Nazorat ishi');
  });

  it.each([
    ['textbook', ['bolimlar/kirish.tex', 'dizayn.sty', 'main.tex']],
    ['worksheet', ['dizayn.sty', 'main.tex']],
    ['exam', ['main.tex']],
    ['olympiad', ['dizayn.sty', 'main.tex']],
    ['lesson', ['main.tex']],
    ['certificate', ['main.tex']],
    ['diploma', ['main.tex']],
    ['article', ['adabiyotlar.bib', 'dizayn.sty', 'main.tex']],
    ['blank', ['main.tex']],
  ])('creates a project from %s without the template metadata', async (template, files) => {
    const res = await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: template, template } });
    expect(res.statusCode).toBe(201);
    const project = (await ctx.api.inject(`/api/projects/${res.json().project.id}`)).json().project;
    expect(project.files.map((f: { path: string }) => f.path)).toEqual(files);
    expect(project).toMatchObject({ compiler: 'xelatex', mainFile: 'main.tex', access: 'owner' });
  });

  it('rejects unknown templates', async () => {
    const res = await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'x', template: '../etc' } });
    expect(res.json().error.code).toBe('invalid_template');
  });

  it('generates previews by compiling the template, once, and caches them', async () => {
    const first = await ctx.client().inject('/api/templates/exam/preview.png');
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('image/png');
    expect(first.rawPayload.equals(FAKE_PNG)).toBe(true);
    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]).toMatchObject({ compiler: 'xelatex', mainFile: 'main.tex', preview: true });
    expect(runner.requests[0]!.files.map((f) => f.path)).toEqual(['main.tex']);

    await ctx.client().inject('/api/templates/exam/preview.png');
    expect(runner.requests).toHaveLength(1); // served from storage

    // Concurrent first requests share one compile.
    await Promise.all([1, 2, 3].map(() => ctx.client().inject('/api/templates/article/preview.png')));
    expect(runner.requests).toHaveLength(2);
  });

  it('returns 404 for unknown templates and failed previews', async () => {
    expect((await ctx.client().inject('/api/templates/nope/preview.png')).statusCode).toBe(404);
    runner.result = () => ({ status: 'failed', exitCode: 12, log: '', console: '', pdf: null, synctex: null, errorMessage: null });
    expect((await ctx.client().inject('/api/templates/blank/preview.png')).statusCode).toBe(404);
  });

  it('ships the same testlar.sty as the Test button writes', () => {
    expect(readFileSync(new URL('../../templates/test/testlar.sty', import.meta.url), 'utf8')).toBe(TESTLAR_STY);
  });
});
